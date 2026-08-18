#!/usr/bin/env node
// WBS 3.10 — Free-Tier Survival Kit: daily quota monitor.
//
// Supabase Free hard-caps at 500 MB database, 1 GB storage, and quietly stops
// serving at 402 once you cross it -- there is no graceful degradation. This
// script queries current usage directly over the Postgres connection (no
// PostgREST/service-role HTTP round-trip needed -- SUPABASE_DB_URL already
// bypasses RLS via the postgres superuser role Supabase issues for
// migrations/backups), compares it to the limits below, and posts a summary
// to ALERT_WEBHOOK_URL on every run so the team sees the trend, not only the
// breach.
//
// Usage:
//   SUPABASE_DB_URL=postgres://... node scripts/check-quota.mjs
//
// Env overrides (all optional):
//   WARN_THRESHOLD_PCT      default 70
//   ALERT_THRESHOLD_PCT     default 85
//   DB_SIZE_LIMIT_BYTES     default 500 * 1024 * 1024   (Supabase Free)
//   STORAGE_LIMIT_BYTES     default 1024 * 1024 * 1024  (Supabase Free, whole project)
//   QUOTA_HISTORY_PATH      default ./quota-history.json (persisted across
//                           workflow runs via actions/cache so the 7-day
//                           growth-rate projection has something to diff)
//   ALERT_WEBHOOK_URL       Discord-compatible webhook (POST {content})
//
// Exit code: 0 normally, 1 if any tracked quota is at/above ALERT_THRESHOLD_PCT
// (so the workflow run itself goes red -- a second, redundant "loud" signal
// on top of the webhook post).
import pg from "pg";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ---- thresholds (easily overridable for the mandatory alert-firing drill) --
// `envNumber` treats an unset OR empty-string env var as "use the default" —
// GitHub Actions passes unfilled workflow_dispatch text inputs through as
// "", not undefined, so `?? default` alone would silently coerce to 0.
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
const WARN_THRESHOLD_PCT = envNumber("WARN_THRESHOLD_PCT", 70);
const ALERT_THRESHOLD_PCT = envNumber("ALERT_THRESHOLD_PCT", 85);
const DB_SIZE_LIMIT_BYTES = envNumber("DB_SIZE_LIMIT_BYTES", 500 * 1024 * 1024);
const STORAGE_LIMIT_BYTES = envNumber("STORAGE_LIMIT_BYTES", 1024 * 1024 * 1024);
const HISTORY_LOOKBACK_DAYS = 7;
const HISTORY_RETENTION_DAYS = 30;

const LARGEST_TABLES = [
  "orders",
  "order_items",
  "payments",
  "stock_ledger",
  "purchase_invoices",
  "daily_financials",
];

const STORAGE_BUCKETS = ["bills", "menu-images"];

function historyPath() {
  return resolve(process.env.QUOTA_HISTORY_PATH ?? "./quota-history.json");
}

export function loadHistory(path) {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(path, history) {
  const cutoff = Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const pruned = history.filter(
    (entry) => new Date(entry.at).getTime() >= cutoff,
  );
  writeFileSync(path, JSON.stringify(pruned, null, 2));
  return pruned;
}

export function projectDaysRemaining(history, key, currentBytes, limitBytes) {
  const cutoff = Date.now() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const inWindow = history
    .filter((e) => new Date(e.at).getTime() >= cutoff && e[key] != null)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  if (inWindow.length === 0) return null;

  const earliest = inWindow[0];
  const elapsedMs = Date.now() - new Date(earliest.at).getTime();
  const elapsedDays = elapsedMs / (24 * 60 * 60 * 1000);
  if (elapsedDays < 0.5) return null; // not enough spread to trust a rate

  const bytesPerDay = (currentBytes - earliest[key]) / elapsedDays;
  if (bytesPerDay <= 0) return Infinity; // flat or shrinking — not heading toward the limit
  const remainingBytes = limitBytes - currentBytes;
  if (remainingBytes <= 0) return 0;
  return remainingBytes / bytesPerDay;
}

function pctOf(value, limit) {
  return (value / limit) * 100;
}

function severity(pct) {
  if (pct >= ALERT_THRESHOLD_PCT) return "ALERT";
  if (pct >= WARN_THRESHOLD_PCT) return "warn";
  return "ok";
}

function fmtBytes(n) {
  if (n == null) return "—";
  const mb = n / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function fmtDays(d) {
  if (d == null) return "not enough history yet";
  if (d === Infinity) return "not growing";
  if (d < 1) return "< 1 day";
  return `~${Math.round(d)} days`;
}

async function queryMetrics(connectionString) {
  const client = new pg.Client({
    connectionString,
    ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
      ? false
      : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const dbSizeRes = await client.query(
      "select pg_database_size(current_database()) as bytes",
    );
    const dbSizeBytes = Number(dbSizeRes.rows[0].bytes);

    const storageBytesByBucket = {};
    for (const bucket of STORAGE_BUCKETS) {
      try {
        const res = await client.query(
          `select coalesce(sum((metadata->>'size')::bigint), 0) as bytes
           from storage.objects where bucket_id = $1`,
          [bucket],
        );
        storageBytesByBucket[bucket] = Number(res.rows[0].bytes);
      } catch {
        storageBytesByBucket[bucket] = null; // storage schema not reachable (e.g. no storage extension locally)
      }
    }

    const rowCounts = {};
    for (const table of LARGEST_TABLES) {
      try {
        const res = await client.query(
          `select count(*)::bigint as n from public.${table}`,
        );
        rowCounts[table] = Number(res.rows[0].n);
      } catch {
        rowCounts[table] = null; // table not present in this environment
      }
    }

    return { dbSizeBytes, storageBytesByBucket, rowCounts };
  } finally {
    await client.end();
  }
}

export function formatSummary({ dbSizeBytes, storageBytesByBucket, rowCounts, history }) {
  const lines = [];
  lines.push(`*Brew Ledger — daily quota report* (${new Date().toISOString()})`);
  lines.push("");

  const dbPct = pctOf(dbSizeBytes, DB_SIZE_LIMIT_BYTES);
  const dbDays = projectDaysRemaining(history, "dbSizeBytes", dbSizeBytes, DB_SIZE_LIMIT_BYTES);
  lines.push(
    `Database size: ${fmtBytes(dbSizeBytes)} / ${fmtBytes(DB_SIZE_LIMIT_BYTES)} ` +
      `(${dbPct.toFixed(1)}%, ${severity(dbPct)}) — projection: ${fmtDays(dbDays)} remaining`,
  );

  for (const bucket of STORAGE_BUCKETS) {
    const bytes = storageBytesByBucket[bucket];
    if (bytes == null) {
      lines.push(`Storage bucket "${bucket}": unavailable`);
      continue;
    }
    const pct = pctOf(bytes, STORAGE_LIMIT_BYTES);
    const days = projectDaysRemaining(
      history,
      `storage:${bucket}`,
      bytes,
      STORAGE_LIMIT_BYTES,
    );
    lines.push(
      `Storage bucket "${bucket}": ${fmtBytes(bytes)} / ${fmtBytes(STORAGE_LIMIT_BYTES)} ` +
        `(${pct.toFixed(1)}%, ${severity(pct)}) — projection: ${fmtDays(days)} remaining`,
    );
  }

  lines.push("");
  lines.push("Row counts (largest tables):");
  for (const table of LARGEST_TABLES) {
    const n = rowCounts[table];
    lines.push(`  ${table}: ${n == null ? "n/a" : n.toLocaleString()}`);
  }

  const maxPct = Math.max(
    dbPct,
    ...STORAGE_BUCKETS.map((b) =>
      storageBytesByBucket[b] == null ? 0 : pctOf(storageBytesByBucket[b], STORAGE_LIMIT_BYTES),
    ),
  );
  lines.push("");
  lines.push(`Overall status: ${severity(maxPct)} (worst quota at ${maxPct.toFixed(1)}%)`);

  return lines.join("\n");
}

async function postToWebhook(url, text) {
  if (!url) {
    console.log("[check-quota] ALERT_WEBHOOK_URL not set — skipping webhook post.");
    return;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: text }),
  });
  if (!res.ok) {
    console.error(`[check-quota] webhook POST failed: ${res.status} ${res.statusText}`);
  }
}

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("[check-quota] SUPABASE_DB_URL is not set.");
    process.exit(1);
  }

  const path = historyPath();
  const history = loadHistory(path);

  const { dbSizeBytes, storageBytesByBucket, rowCounts } = await queryMetrics(connectionString);

  const summary = formatSummary({ dbSizeBytes, storageBytesByBucket, rowCounts, history });
  console.log(summary);

  await postToWebhook(process.env.ALERT_WEBHOOK_URL, summary);

  const entry = { at: new Date().toISOString(), dbSizeBytes, rowCounts };
  for (const bucket of STORAGE_BUCKETS) {
    entry[`storage:${bucket}`] = storageBytesByBucket[bucket];
  }
  saveHistory(path, [...history, entry]);

  const dbPct = pctOf(dbSizeBytes, DB_SIZE_LIMIT_BYTES);
  const storagePcts = STORAGE_BUCKETS.map((b) =>
    storageBytesByBucket[b] == null ? 0 : pctOf(storageBytesByBucket[b], STORAGE_LIMIT_BYTES),
  );
  const worst = Math.max(dbPct, ...storagePcts);
  if (worst >= ALERT_THRESHOLD_PCT) {
    console.error(`[check-quota] ALERT: a quota is at ${worst.toFixed(1)}% (threshold ${ALERT_THRESHOLD_PCT}%).`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
