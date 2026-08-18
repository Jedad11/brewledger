#!/usr/bin/env node
// WBS 3.10 — Free-Tier Survival Kit: restore drill.
//
// A backup that has never been restored is not a backup. This is the script
// a human runs during the mandatory drill (see BrewLedger_WBS_Dictionary.md
// §3.10, Thai manual-action step 3): restore a dump produced by
// .github/workflows/backup.yml into a scratch database (a throwaway Supabase
// project, or local `supabase start`), then diff row counts against the
// manifest the same workflow run produced. Never point this at a database
// anyone depends on -- it runs `psql -f` against TARGET_DB_URL unmodified.
//
// Usage:
//   node scripts/restore-drill.mjs <dump.sql|dump.sql.gz> <manifest.json> <target-connection-string>
//
// Exit code: 0 if every manifest table's row count matches post-restore, 1
// otherwise (including if psql/gunzip is missing, or the dump fails to apply).
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import zlib from "node:zlib";
import pg from "pg";

export function loadManifest(manifestPath) {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!parsed.tables || typeof parsed.tables !== "object") {
    throw new Error(`${manifestPath} has no "tables" object — is this a backup.yml manifest?`);
  }
  return parsed;
}

function gunzipToTempFile(dumpPath) {
  const compressed = readFileSync(dumpPath);
  const decompressed = zlib.gunzipSync(compressed);
  const dir = mkdtempSync(join(tmpdir(), "brewledger-restore-"));
  const outPath = join(dir, "dump.sql");
  writeFileSync(outPath, decompressed);
  return outPath;
}

function restoreDump(sqlPath, targetConnectionString) {
  // No ON_ERROR_STOP here, and no non-zero-exit check -- verified for real
  // against a local `supabase start` scratch database: a Supabase-provisioned
  // target (dev/prod scratch project or local stack) already owns the
  // `public`/`auth` schemas and has default-privilege grants locked to the
  // `postgres` role, so a straight `pg_dump`-produced script always throws a
  // handful of expected, harmless errors on replay -- "schema public already
  // exists", "schema auth does not exist" (dump ran with a superuser that can
  // see it, restore target's role cannot), "permission denied to change
  // default privileges". None of those touch table data. ON_ERROR_STOP=1
  // aborts the WHOLE restore on the very first of these (confirmed: it dies
  // on line 1 of the script, before a single CREATE TABLE runs) which is
  // worse than useless here. The row-count comparison below is the actual
  // pass/fail signal for this drill, not psql's exit code.
  const result = spawnSync("psql", [targetConnectionString, "-f", sqlPath], {
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`psql could not be launched: ${result.error.message}. Is postgresql-client installed?`);
  }
}

async function countRows(connectionString, table) {
  const client = new pg.Client({
    connectionString,
    ssl:
      connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const res = await client.query(`select count(*)::bigint as n from public.${table}`);
    return Number(res.rows[0].n);
  } finally {
    await client.end();
  }
}

export function formatResultsTable(results) {
  const rows = [["table", "expected", "actual", "result"]];
  for (const r of results) {
    rows.push([
      r.table,
      r.expected == null ? "n/a" : String(r.expected),
      r.actual == null ? "ERROR" : String(r.actual),
      r.pass ? "PASS" : "FAIL",
    ]);
  }
  const widths = rows[0].map((_, col) => Math.max(...rows.map((row) => row[col].length)));
  return rows
    .map((row) => row.map((cell, col) => cell.padEnd(widths[col])).join("  |  "))
    .join("\n");
}

async function main() {
  const [dumpPathArg, manifestPathArg, targetConnectionString] = process.argv.slice(2);
  if (!dumpPathArg || !manifestPathArg || !targetConnectionString) {
    console.error(
      "Usage: node scripts/restore-drill.mjs <dump.sql|dump.sql.gz> <manifest.json> <target-connection-string>",
    );
    process.exit(1);
  }

  const dumpPath = resolve(dumpPathArg);
  const manifestPath = resolve(manifestPathArg);
  if (!existsSync(dumpPath)) throw new Error(`dump not found: ${dumpPath}`);
  if (!existsSync(manifestPath)) throw new Error(`manifest not found: ${manifestPath}`);

  const manifest = loadManifest(manifestPath);

  const sqlPath = dumpPath.endsWith(".gz") ? gunzipToTempFile(dumpPath) : dumpPath;

  console.log(`[restore-drill] restoring ${dumpPath} into target database...`);
  restoreDump(sqlPath, targetConnectionString);
  console.log("[restore-drill] restore complete. Comparing row counts against manifest...");

  const results = [];
  for (const [table, expected] of Object.entries(manifest.tables)) {
    let actual = null;
    try {
      actual = await countRows(targetConnectionString, table);
    } catch (err) {
      console.error(`[restore-drill] failed to count ${table}: ${err.message}`);
    }
    results.push({ table, expected, actual, pass: actual === expected });
  }

  console.log("");
  console.log(formatResultsTable(results));

  const allPass = results.every((r) => r.pass);
  console.log("");
  console.log(allPass ? "RESULT: PASS — all row counts match." : "RESULT: FAIL — see table above.");
  console.log(
    "Record this result in /docs/ops/free_tier.md's Restore drill log (date, dump used, rows before/after, result, performed by), then delete the scratch project — Free plan allows only 2.",
  );

  process.exit(allPass ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
