#!/usr/bin/env node
// WBS 2.2 §4 — widens the RL-2 forbidden-nag-phrase check (documented in
// CLAUDE.md as "forbidden in apps/console", previously only ever run as a
// manual `grep -rn ... apps/console/`, never as a committed script) to also
// cover packages/ui/src/** — the component that must never nag
// (RecipeBlock) now physically lives in that package, and a scan scoped
// only to the app that *uses* it would never catch a violation introduced
// in the package that *defines* it.
//
// Usage: node scripts/scan-forbidden-copy.mjs [dir ...]
//   Defaults to apps/console and packages/ui/src.
// Exit code: 0 if no forbidden phrase is found, 1 otherwise (hits printed).

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

// RL-2: no screen may nag a merchant into entering a recipe.
export const FORBIDDEN_PHRASES = [
  "ยังไม่ได้ใส่",
  "ควรใส่",
  "กรุณาใส่",
  "ไม่ครบ",
  "ยังขาด",
];

const DEFAULT_DIRS = ["apps/console", "packages/ui/src"];
const SKIP_DIR_NAMES = new Set(["node_modules", ".next", "dist", "build"]);
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".md"]);

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

export function scanForForbiddenCopy(dirs) {
  const hits = [];
  for (const dir of dirs) {
    const abs = resolve(REPO_ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const file of listFilesRecursive(abs)) {
      const ext = file.slice(file.lastIndexOf("."));
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      const contents = readFileSync(file, "utf8");
      for (const phrase of FORBIDDEN_PHRASES) {
        if (contents.includes(phrase)) hits.push({ file, phrase });
      }
    }
  }
  return hits;
}

function main() {
  const dirs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DIRS;
  const hits = scanForForbiddenCopy(dirs);
  if (hits.length === 0) {
    console.log(`scan-forbidden-copy: clean (${dirs.join(", ")})`);
    process.exit(0);
  }
  console.error("scan-forbidden-copy: forbidden nag phrase found —");
  for (const { file, phrase } of hits) {
    console.error(`  ${file}: "${phrase}"`);
  }
  process.exit(1);
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}
