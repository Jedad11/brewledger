#!/usr/bin/env node
// WBS 5.7 §8 — static analysis rule per the WBS dictionary's own Claude Code
// prompt: "fail the build if any file outside lifecycle.ts contains an
// update to orders.status ... a direct update is a data corruption bug, not
// a shortcut." transition_order() (packages/db/migrations/
// 0032_order_status_history.sql) is the ONLY permitted way to change
// orders.status; every side effect (stock deduction/reversal, slot release,
// notification, history row) lives inside that one guarded function.
//
// Correction from docs/db/wbs_5_7_lifecycle_design.md §8 vs. the WBS
// prompt's literal wording: the regex must EXCLUDE
// packages/db/migrations/ and supabase/migrations/, where transition_order's
// own body legitimately contains `update orders ... set status = ...` — the
// prompt's scope was always "application code", not the migration that
// defines the guard itself. Scoped to apps/, supabase/functions/, worker/ —
// excluding _shared/orders/lifecycle.ts (typed OrderStatus literals, not a
// bypass) and test directories/files (fixture helpers legitimately build a
// mock order row with a given status — see worker/tests/expireOrders.test.ts's
// insertOrder({ status: "ACCEPTED" }) — not a production write path).
//
// Usage: node scripts/scan-order-status-bypass.mjs [dir ...]
//   Defaults to apps, supabase/functions, worker.
// Exit code: 0 if no bypass pattern is found, 1 otherwise (hits printed).
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const DEFAULT_DIRS = ["apps", "supabase/functions", "worker"];
const SKIP_DIR_NAMES = new Set([
  "node_modules", ".next", "dist", "build",
  "_tests", "tests", "__tests__",
]);
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

// Relative to REPO_ROOT. The only file where the WBS prompt itself permits
// this pattern outside the migrations that define transition_order().
const ALLOWED_FILES = new Set([
  "supabase/functions/_shared/orders/lifecycle.ts",
]);

function isTestFile(fileName) {
  return /\.(test|spec)\.[jt]sx?$/.test(fileName);
}

// Two independent patterns, matching the WBS prompt's own regex:
//   /update.*orders.*status|status:\s*'(ACCEPTED|PREPARING|READY|COLLECTED|
//   CANCELLED|REFUNDED|EXPIRED)'/
// Applied against the whole file (dotAll, bounded) rather than line-by-line
// so a multi-line `update orders\n   set status = ...` template string is
// still caught.
const DIRECT_UPDATE_PATTERN = /update[\s\S]{0,200}\borders\b[\s\S]{0,200}\bstatus\b\s*=/i;
// Colon, not equals: this targets a JS/TS object-literal write such as
// supabase-js's `.update({ status: 'ACCEPTED' })`, not a SQL `WHERE status =
// 'PENDING_PAYMENT'` read (the sweep's own idempotency-guard filter, e.g.
// worker/src/handlers/expireOrders.ts) or the SET half of an UPDATE, which
// DIRECT_UPDATE_PATTERN above already covers.
const STATUS_LITERAL_PATTERN =
  /\bstatus\s*:\s*['"](ACCEPTED|PREPARING|READY|COLLECTED|CANCELLED|REFUNDED|EXPIRED)['"]/;

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

export function scanForOrderStatusBypass(dirs) {
  const hits = [];
  for (const dir of dirs) {
    const abs = resolve(REPO_ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const file of listFilesRecursive(abs)) {
      const ext = file.slice(file.lastIndexOf("."));
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      if (isTestFile(file)) continue;
      const relPath = relative(REPO_ROOT, file);
      if (ALLOWED_FILES.has(relPath)) continue;

      const contents = readFileSync(file, "utf8");
      if (DIRECT_UPDATE_PATTERN.test(contents)) {
        hits.push({ file: relPath, pattern: "direct UPDATE of orders.status" });
      }
      if (STATUS_LITERAL_PATTERN.test(contents)) {
        hits.push({ file: relPath, pattern: "orders status literal assignment" });
      }
    }
  }
  return hits;
}

function main() {
  const dirs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DIRS;
  const hits = scanForOrderStatusBypass(dirs);
  if (hits.length === 0) {
    console.log(`scan-order-status-bypass: clean (${dirs.join(", ")})`);
    process.exit(0);
  }
  console.error("Order status must change through transitionOrder(). See WBS 5.7.");
  for (const { file, pattern } of hits) {
    console.error(`  ${file}: ${pattern}`);
  }
  process.exit(1);
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}
