#!/usr/bin/env node
// Guards against the WBS 6.5 incident: two independently-authored migrations
// (WBS 5.10's 0036_order_lookup_rate_limit.sql and WBS 6.5's own
// 0036_ingredient_master_conversions.sql) both claimed version "0036".
// Supabase CLI keys applied migrations by that numeric prefix in
// supabase_migrations.schema_migrations, so only one "0036" could ever be
// recorded -- the second migration merged clean, typechecked clean, and was
// then silently never applied to any database. Two people/sessions picking
// the same next number independently is exactly the kind of thing git does
// not conflict on (different filenames) and CI would not otherwise catch.
//
// Checks, purely from the filesystem (no live Postgres needed, so this runs
// in CI where no Supabase stack exists):
//   1. No two migration files in the same directory share a numeric prefix.
//   2. packages/db/migrations/ and supabase/migrations/ mirror each other
//      exactly (same filenames) -- CLAUDE.md and every migration commit
//      message describe this mirroring as the standing convention.
//
// Usage: node scripts/check-migration-numbers.mjs
// Exit code: 0 if clean, 1 otherwise (problems printed).

import { readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIRS = ["packages/db/migrations", "supabase/migrations"];

function migrationFiles(dir) {
  const abs = resolve(REPO_ROOT, dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs).filter((f) => f.endsWith(".sql")).sort();
}

function findDuplicatePrefixes(files) {
  const byPrefix = new Map();
  for (const file of files) {
    const prefix = file.split("_")[0];
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(file);
  }
  return [...byPrefix.entries()].filter(([, names]) => names.length > 1);
}

export function checkMigrationNumbers() {
  const problems = [];
  const [dbFiles, supabaseFiles] = DIRS.map(migrationFiles);

  for (const [dir, files] of [[DIRS[0], dbFiles], [DIRS[1], supabaseFiles]]) {
    for (const [prefix, names] of findDuplicatePrefixes(files)) {
      problems.push(
        `${dir}: version "${prefix}" claimed by ${names.length} files: ${names.join(", ")}`,
      );
    }
  }

  const dbSet = new Set(dbFiles);
  const supabaseSet = new Set(supabaseFiles);
  const onlyInDb = dbFiles.filter((f) => !supabaseSet.has(f));
  const onlyInSupabase = supabaseFiles.filter((f) => !dbSet.has(f));
  for (const f of onlyInDb) {
    problems.push(`${DIRS[0]}/${f} has no mirror in ${DIRS[1]}/`);
  }
  for (const f of onlyInSupabase) {
    problems.push(`${DIRS[1]}/${f} has no mirror in ${DIRS[0]}/`);
  }

  return problems;
}

function main() {
  const problems = checkMigrationNumbers();
  if (problems.length === 0) {
    console.log(`check-migration-numbers: clean (${DIRS.join(", ")})`);
    process.exit(0);
  }
  console.error("check-migration-numbers: problems found —");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main();
}
