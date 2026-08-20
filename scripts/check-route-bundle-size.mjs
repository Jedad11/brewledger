#!/usr/bin/env node
// WBS 5.1 §5 — CI check on the /s/[slug] route's OWN client JS budget
// (100 KB gzipped, the WBS acceptance line for this entry).
//
// "This route's client bundle" means the JS this route adds on top of the
// framework runtime every route already pays for — the React/Next.js
// runtime chunks alone gzip to ~130 KB in this app (measured against the
// pre-existing "/" coming-soon page, which imports no app code at all), so
// a 100 KB *total* first-load budget is not achievable by any route and is
// not what the WBS line means. This script therefore diffs the target
// route's chunk set against a baseline route's chunk set (default "/") and
// sums the gzipped size of only the chunks exclusive to the target — the
// same "shared by all" vs. "this route's own" split Next.js's own build
// output table has always reported, just computed from Next 16's
// `.next/diagnostics/route-bundle-stats.json` (emitted by every
// `next build`, no bundle-analyzer dependency needed) instead of parsed
// from stdout.
//
// Usage:
//   node scripts/check-route-bundle-size.mjs [nextDir] [route] [budgetBytes] [baselineRoute]
//     nextDir        default apps/shop/.next
//     route          default /s/[slug]
//     budgetBytes    default 102400 (100 KB)
//     baselineRoute  default /
//
// Exit code: 0 under budget, 1 over budget or if the stats file is missing
// (run `next build` first — this is not itself a build step).
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_BUDGET_BYTES = 100 * 1024;
const DEFAULT_BASELINE_ROUTE = "/";

export function loadRouteBundleStats(statsPath) {
  return JSON.parse(readFileSync(statsPath, "utf8"));
}

function findRoute(stats, route) {
  const entry = stats.find((s) => s.route === route);
  if (!entry) {
    throw new Error(`route "${route}" not found in route-bundle-stats.json`);
  }
  return entry;
}

/**
 * chunkPaths in route-bundle-stats.json are recorded relative to the Next
 * app root (e.g. ".next/static/chunks/x.js"), not relative to nextDir
 * itself — join against nextDir's parent to land on the real file.
 */
function gzipBytesOf(nextDir, chunkPath) {
  return gzipSync(readFileSync(join(nextDir, "..", chunkPath))).length;
}

/** Sum of the gzipped size of chunks `route` references that `baselineRoute` does not. */
export function computeRouteOwnGzipBytes(nextDir, route, baselineRoute, stats) {
  const target = findRoute(stats, route);
  const baseline = findRoute(stats, baselineRoute);
  const baselineChunks = new Set(baseline.firstLoadChunkPaths);
  const exclusiveChunks = target.firstLoadChunkPaths.filter((p) => !baselineChunks.has(p));
  return exclusiveChunks.reduce((total, chunkPath) => total + gzipBytesOf(nextDir, chunkPath), 0);
}

function main() {
  const [, , nextDirArg, routeArg, budgetArg, baselineArg] = process.argv;
  const nextDir = resolve(nextDirArg ?? join(REPO_ROOT, "apps/shop/.next"));
  const route = routeArg ?? "/s/[slug]";
  const budgetBytes = Number(budgetArg ?? DEFAULT_BUDGET_BYTES);
  const baselineRoute = baselineArg ?? DEFAULT_BASELINE_ROUTE;

  const statsPath = join(nextDir, "diagnostics/route-bundle-stats.json");
  if (!existsSync(statsPath)) {
    console.error(`check-route-bundle-size: ${statsPath} not found — run \`next build\` first.`);
    process.exit(1);
  }

  const stats = loadRouteBundleStats(statsPath);
  const gzipBytes = computeRouteOwnGzipBytes(nextDir, route, baselineRoute, stats);

  if (gzipBytes > budgetBytes) {
    console.error(
      `check-route-bundle-size: FAILED — ${route}'s own JS (over baseline "${baselineRoute}") is ${gzipBytes} bytes gzipped, over the ${budgetBytes}-byte budget.`,
    );
    process.exit(1);
  }

  console.log(
    `check-route-bundle-size: OK — ${route}'s own JS (over baseline "${baselineRoute}") is ${gzipBytes} bytes gzipped (budget ${budgetBytes}).`,
  );
  process.exit(0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
