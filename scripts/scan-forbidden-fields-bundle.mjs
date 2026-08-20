#!/usr/bin/env node
// WBS 5.1 HIGH finding C (redline_reviewer audit of commit 0f3b4ce) —
// scan-forbidden-fields.mjs only ever scanned committed *.json snapshot
// fixtures; it never looked at the actual built apps/shop client bundle
// that ships to a browser. A DTO field can be clean in every snapshot
// fixture and still leak into the real bundle. This is the CI gate against
// that gap, run against the real .js/.css apps/shop's `next build` emits.
//
// Deliberately its own script rather than widening scan-forbidden-fields.mjs
// in place: that module's exported scanForForbiddenFields() is depended on,
// unchanged, by forbidden_field_scan.test.ts and this repo's own committed
// snapshot-fixture scan — both call it 2-arg, matching a plain
// `contents.includes(substring)` check. That check is provably too naive
// for a full built bundle: verified by hand against this app's real build
// output before writing this script, "margin"/"profit"/"payload"/"stock"
// all appear dozens of times as UNAVOIDABLE vendor/framework noise —
// React's internal Fiber update-queue field name `payload`, the DOM
// `marginTop`/`marginBottom` CSSStyleDeclaration properties React's
// Offscreen/Suspense internals and Next's error overlay both set inline,
// @supabase/auth-js's own "session ... expired with margin of 90000s" log
// message, and packages/ui's sanctioned `--c-profit` design-token name
// (present in the one global stylesheet every route ships, whether or not
// that route ever renders a profit figure — CSS custom properties are
// never tree-shaken). A literal "fail on any substring anywhere" scan
// against that reality would be permanently red from the day it's added,
// which teaches everyone to ignore or bypass it — worse than no check.
//
// The fix is a shape check, not a bigger exemption list: an actual leaked
// DB/API field name reaches the bundle as a serialized JSON key or string
// value — quoted, e.g. `"cost_satang":1800` or `"total_cost_snapshot_satang"`
// — because that's how this app's own public DTOs and Next's RSC/hydration
// payloads represent data. Vendor/framework internals use the SAME words as
// unquoted JS identifiers (`.payload`, `marginTop=`, object keys like
// `payload:null`) or unquoted CSS tokens (`margin:0`, `--c-profit:`) — never
// wrapped in matching quote marks. So: a hit only counts when the forbidden
// substring's enclosing identifier-shaped token is directly wrapped in a
// matching `"`, `'`, or backtick pair. This is still a strict, literal
// scan — it does not special-case any particular vendor file, chunk hash,
// or dependency version, so it keeps working unmodified across dependency
// bumps, and it still fails hard on a genuinely new quoted occurrence
// (which is exactly the shape a real leak would take).
//
// Two still-necessary exemptions, both matched against the FULL enclosing
// token (never the bare substring, so neither exempts anything broader):
//   - "out_of_stock" (EXACT_QUOTED_TOKEN_ALLOWLIST) — a legitimately quoted,
//     snake_case-shaped string (PublicMenuItem.availability's own sanctioned
//     enum value) the shape check alone can't distinguish from a real leak
//     of the "stock" substring.
//   - marginTop/marginBottom/etc. (QUOTED_TOKEN_ALLOWLIST_PATTERNS) — React's
//     Offscreen/Activity internals do `t.hasOwnProperty("marginTop")` /
//     `t["marginBottom"]`, which IS a quoted token but names a CSS/DOM style
//     property, not a data value — the same "quoted identifier reference"
//     shape a real leak has, but a different word class entirely (every
//     real money field here is snake_case or the bare word itself, never a
//     camelCase CSS-property compound).
//
// Usage:
//   node scripts/scan-forbidden-fields-bundle.mjs [dir] [forbidden-fields-json]
//   (both optional; default to apps/shop's built static output and
//   docs/design/forbidden_fields.json)
//
// Exit code: 0 if no .js/.css chunk contains a quoted forbidden token, 1 if
// at least one hit is found (hits are printed to stderr) or if the bundle
// directory is missing (e.g. `next build` for apps/shop hasn't run yet).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadForbiddenSubstrings } from "./scan-forbidden-fields.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BUNDLE_EXTENSIONS = [".js", ".css"];
const IDENT_CHAR = /[A-Za-z0-9_]/;
const QUOTE_CHARS = new Set(['"', "'", "`"]);

const EXACT_QUOTED_TOKEN_ALLOWLIST = new Set([
  "out_of_stock", // PublicMenuItem.availability — sanctioned, see header comment.
]);

// React's Offscreen/Activity internals do `t.hasOwnProperty("marginTop")` /
// `t["marginBottom"]` — genuinely quoted, but a CSS/DOM style property name
// check, not a data value. Every real money field in this codebase is
// snake_case (`_satang` suffixed, or the bare words "margin"/"profit"/
// "stock"/"cogs" themselves) — never a camelCase compound like this, so
// this pattern can't collide with an actual leak.
const QUOTED_TOKEN_ALLOWLIST_PATTERNS = [/^margin(Top|Bottom|Left|Right|Block|Inline)(Start|End)?$/];

function isAllowlistedToken(token) {
  return EXACT_QUOTED_TOKEN_ALLOWLIST.has(token) || QUOTED_TOKEN_ALLOWLIST_PATTERNS.some((p) => p.test(token));
}

function listFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

/** The maximal `[A-Za-z0-9_]+` run containing the character at `index`. */
function enclosingToken(contents, index) {
  let start = index;
  while (start > 0 && IDENT_CHAR.test(contents[start - 1])) start--;
  let end = index;
  while (end < contents.length && IDENT_CHAR.test(contents[end])) end++;
  return { text: contents.slice(start, end), start, end };
}

function isQuoted(contents, start, end) {
  const before = contents[start - 1];
  const after = contents[end];
  return QUOTE_CHARS.has(before) && before === after;
}

/**
 * Returns [{ file, substring, token }] for every quoted-token occurrence of
 * a forbidden substring. See the header comment for why "quoted" is the bar
 * (not bare substring presence, unlike scanForForbiddenFields).
 */
export function scanBundleForForbiddenFields(bundleDir, forbiddenSubstrings) {
  const hits = [];
  const files = listFilesRecursive(bundleDir).filter((f) => BUNDLE_EXTENSIONS.some((ext) => f.endsWith(ext)));
  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    for (const substring of forbiddenSubstrings) {
      let from = 0;
      let idx;
      while ((idx = contents.indexOf(substring, from)) !== -1) {
        from = idx + substring.length;
        const { text: token, start, end } = enclosingToken(contents, idx);
        if (!isQuoted(contents, start, end)) continue;
        if (isAllowlistedToken(token)) continue;
        hits.push({ file, substring, token });
      }
    }
  }
  return hits;
}

function main() {
  const [, , dirArg, forbiddenFieldsArg] = process.argv;
  const bundleDir = resolve(dirArg ?? join(REPO_ROOT, "apps/shop/.next/static"));
  const forbiddenFieldsPath = resolve(forbiddenFieldsArg ?? join(REPO_ROOT, "docs/design/forbidden_fields.json"));

  if (!existsSync(bundleDir)) {
    console.error(
      `scan-forbidden-fields-bundle: ${bundleDir} not found — run \`next build\` for apps/shop first.`,
    );
    process.exit(1);
  }

  const forbiddenSubstrings = loadForbiddenSubstrings(forbiddenFieldsPath);
  const hits = scanBundleForForbiddenFields(bundleDir, forbiddenSubstrings);

  if (hits.length > 0) {
    console.error(`Forbidden-field bundle scan FAILED — ${hits.length} hit(s):`);
    for (const hit of hits) {
      console.error(`  ${hit.file}: contains forbidden substring "${hit.substring}" (quoted token "${hit.token}")`);
    }
    process.exit(1);
  }

  console.log(
    `Forbidden-field bundle scan clean — 0 quoted-token hits across ${bundleDir} (${BUNDLE_EXTENSIONS.join(", ")}) against ${forbiddenSubstrings.length} forbidden substrings.`,
  );
  process.exit(0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
