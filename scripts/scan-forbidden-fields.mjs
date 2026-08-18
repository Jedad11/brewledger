#!/usr/bin/env node
// WBS 3.7 §7 test contract — "Forbidden-field CI scan".
//
// Greps every committed public-* response snapshot file (default:
// supabase/functions/_tests/__snapshots__/*.json) for any substring listed
// in docs/design/forbidden_fields.json. This is deliberately a check
// against the ACTUAL COMMITTED RESPONSE BYTES, not a re-check of
// packages/shared/src/serializers/public.ts's source — a future edit to a
// DTO builder that reintroduces `booked_count` or `margin` would still be
// caught here even if the serializer's own code review missed it, as long
// as someone (re-)commits a snapshot fixture containing the leaked field.
// It does NOT catch a leak that never gets committed to a snapshot fixture
// at all — that gap is why this scan is one layer of several (RLS, the
// import boundary, the anti-spread lint rule, .strict() Zod schemas), not
// the only one.
//
// Usage:
//   node scripts/scan-forbidden-fields.mjs [dir] [forbidden-fields-json]
//   (both optional; default to the WBS 3.7 snapshot dir and the design's
//   docs/design/forbidden_fields.json)
//
// Exit code: 0 if no snapshot file contains any forbidden substring, 1 if
// at least one hit is found (hits are printed to stderr) or if either input
// path is missing.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function loadForbiddenSubstrings(forbiddenFieldsPath) {
  const raw = readFileSync(forbiddenFieldsPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.forbidden_substrings)) {
    throw new Error(`${forbiddenFieldsPath} has no "forbidden_substrings" array`);
  }
  return parsed.forbidden_substrings;
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

/**
 * Returns an array of { file, substring } for every (file, forbidden
 * substring) pair found. An empty array means the scan is clean.
 */
export function scanForForbiddenFields(snapshotDir, forbiddenSubstrings) {
  const hits = [];
  const files = listFilesRecursive(snapshotDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const contents = readFileSync(file, "utf8");
    for (const substring of forbiddenSubstrings) {
      if (contents.includes(substring)) {
        hits.push({ file, substring });
      }
    }
  }
  return hits;
}

function main() {
  const [, , dirArg, forbiddenFieldsArg] = process.argv;
  const snapshotDir = resolve(dirArg ?? join(REPO_ROOT, "supabase/functions/_tests/__snapshots__"));
  const forbiddenFieldsPath = resolve(forbiddenFieldsArg ?? join(REPO_ROOT, "docs/design/forbidden_fields.json"));

  const forbiddenSubstrings = loadForbiddenSubstrings(forbiddenFieldsPath);
  const hits = scanForForbiddenFields(snapshotDir, forbiddenSubstrings);

  if (hits.length > 0) {
    console.error(`Forbidden-field scan FAILED — ${hits.length} hit(s):`);
    for (const hit of hits) {
      console.error(`  ${hit.file}: contains forbidden substring "${hit.substring}"`);
    }
    process.exit(1);
  }

  console.log(`Forbidden-field scan clean — 0 hits across ${snapshotDir} against ${forbiddenSubstrings.length} forbidden substrings.`);
  process.exit(0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
