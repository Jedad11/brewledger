#!/usr/bin/env node
// WBS 4.1 §5 / RL-3 / F01 structural boundary check — "Structural: apps/shop
// contains no auth code (fails build otherwise)."
//
// Customer Web issues no account of any kind. This scans apps/shop for the
// three concrete signals the WBS's own Claude Code prompt names:
//   1. any import of @supabase/auth-helpers (any subpath)
//   2. any call to signIn(...) / signUp(...) / getSession(...)
//   3. any route path containing a login/signup/auth segment
//
// This is a STRUCTURAL check, deliberately narrower than a full "no auth
// code at all" audit — it exists to catch a regression matching the exact
// shapes named in the WBS, not to be the only defence. RL-3's real
// enforcement is RLS (WBS 3.6) plus the import-boundary lint rule
// (pnpm lint:boundary) that blocks apps/shop from importing apps/console or
// packages/costing at all. See CLAUDE.md's RL-3 section.
//
// Widened 2026-08-19 (redline_reviewer finding): the WBS text names only
// signIn/signUp/getSession, but this project's own console code calls
// supabase.auth.signInWithOtp(...) and supabase.auth.verifyOtp(...) —
// neither matched the old exact-identifier regex ("signIn" immediately
// followed by "With" failed \s*\(). The call-detector below now matches (1)
// any `.auth.<methodName>(` call — covers signInWithOtp, verifyOtp, and any
// future Supabase Auth method by shape, not by name — plus (2), kept as a
// belt-and-suspenders match for the exact WBS-named identifiers even without
// a `.auth.` prefix, signIn*/signUp*/getSession with an optional suffix
// (still catches a bare signInWithOtp(...) called without the .auth.
// prefix, e.g. via a destructured import).
//
// Usage: node scripts/check-shop-has-no-auth.mjs [shopDir]
//   Defaults to apps/shop.
// Exit code: 0 if no hit is found, 1 otherwise (hits printed to stderr).
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DEFAULT_SHOP_DIR = "apps/shop";
const SKIP_DIR_NAMES = new Set(["node_modules", ".next", "dist", "build", ".git"]);
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const AUTH_HELPERS_IMPORT_RE = /["']@supabase\/auth-helpers[^"']*["']/;
const AUTH_CALL_RE = /\.auth\.\w+\s*\(|\b(signIn\w*|signUp\w*|getSession)\s*\(/;
// Any path segment that is (or contains) "login", "signup", or "auth" — a
// Next.js app-router folder name is the route segment itself, so this is
// checked against path segments, not file contents.
const AUTH_ROUTE_SEGMENT_RE = /(login|signup|auth)/i;

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

/**
 * Returns an array of hits: { type: 'import' | 'call' | 'route', file, detail }.
 * An empty array means the scan is clean.
 */
export function scanShopForAuthCode(shopDir) {
  const hits = [];
  const abs = resolve(shopDir);
  if (!existsSync(abs)) return hits;

  for (const file of listFilesRecursive(abs)) {
    const relPath = relative(abs, file);
    const segments = relPath.split(sep);

    // 3. route path check — evaluated against every path segment, including
    // the filename itself (covers both `app/login/page.tsx` style folders
    // and a hypothetical flat `login.tsx`).
    for (const segment of segments) {
      if (AUTH_ROUTE_SEGMENT_RE.test(segment)) {
        hits.push({ type: "route", file: relPath, detail: segment });
        break; // one hit per file for the route check is enough
      }
    }

    const ext = file.slice(file.lastIndexOf("."));
    if (!CODE_EXTENSIONS.has(ext)) continue;
    const contents = readFileSync(file, "utf8");

    // 1. @supabase/auth-helpers import
    const importMatch = contents.match(AUTH_HELPERS_IMPORT_RE);
    if (importMatch) {
      hits.push({ type: "import", file: relPath, detail: importMatch[0] });
    }

    // 2. signIn / signUp / getSession calls
    const callMatch = contents.match(AUTH_CALL_RE);
    if (callMatch) {
      hits.push({ type: "call", file: relPath, detail: callMatch[0] });
    }
  }

  return hits;
}

function main() {
  const shopDirArg = process.argv[2] ?? join(REPO_ROOT, DEFAULT_SHOP_DIR);
  const hits = scanShopForAuthCode(shopDirArg);

  if (hits.length === 0) {
    console.log(`check-shop-has-no-auth: clean (${shopDirArg})`);
    process.exit(0);
  }

  console.error(
    `check-shop-has-no-auth: FAILED — ${hits.length} hit(s). Customer Web ` +
      "must carry zero authentication code (RL-3 / F01):",
  );
  for (const hit of hits) {
    console.error(`  [${hit.type}] ${hit.file}: ${hit.detail}`);
  }
  process.exit(1);
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? "")) {
  main();
}
