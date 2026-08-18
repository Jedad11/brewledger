#!/usr/bin/env node
// WBS 2.1 — wires the delivered design-system adherence lint into the repo
// pipeline. oxlint's config parser rejects any unrecognized top-level field,
// and the delivered config carries a `x-omelette` metadata block (component/
// token catalogue used by the design tool that generated it, not by oxlint
// itself). /design/ is a read-only delivered artefact (see CLAUDE.md), so
// instead of editing the file in place, this script derives a stripped copy
// at run time and points oxlint at that copy. The rule content — every
// `rules` and `overrides` entry — is untouched; only the field oxlint cannot
// parse is removed.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const SOURCE_CONFIG = path.join(
  repoRoot,
  "design",
  "_ds",
  "brewledger-design-system-07c182af-9b93-4f42-a3da-2adf1d189891",
  "_adherence.oxlintrc.json",
);

const GENERATED_DIR = path.join(repoRoot, "node_modules", ".cache", "brewledger-adherence");
const GENERATED_CONFIG = path.join(GENERATED_DIR, "_adherence.oxlintrc.json");

// Targets: any workspace where generated frontend code could use the
// delivered design-system React components. packages/ui does not exist yet
// (WBS 2.2) — oxlint is a no-op there today and starts checking automatically
// once that package is scaffolded.
const TARGETS = ["apps/console", "apps/shop", "packages/ui"];

function main() {
  const raw = JSON.parse(readFileSync(SOURCE_CONFIG, "utf8"));
  const { "x-omelette": _omitted, ...oxlintConfig } = raw;

  mkdirSync(GENERATED_DIR, { recursive: true });
  writeFileSync(GENERATED_CONFIG, JSON.stringify(oxlintConfig, null, 2));

  const existingTargets = TARGETS.filter((t) => {
    try {
      readFileSync(path.join(repoRoot, t, "package.json"));
      return true;
    } catch {
      return false;
    }
  });

  if (existingTargets.length === 0) {
    console.log("[lint:adherence] no target workspace exists yet — skipping (nothing to check).");
    return;
  }

  const result = spawnSync(
    "npx",
    ["oxlint", "-c", GENERATED_CONFIG, ...existingTargets],
    { stdio: "inherit", cwd: repoRoot, shell: process.platform === "win32" },
  );

  process.exit(result.status ?? 1);
}

main();
