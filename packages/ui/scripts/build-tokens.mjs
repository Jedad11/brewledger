#!/usr/bin/env node
// WBS 2.2 — token pipeline. Parses the delivered CSS custom properties with
// a real CSS AST (postcss) and emits packages/ui/src/tokens.css and
// packages/ui/tailwind-preset.ts. Never hand-transcribe a token value here —
// add a source file to SOURCE_FILES instead. See docs/ui/design_system_port_design.md §1.
//
// Idempotent: file in, file out. Re-run after any change to a source CSS
// file; never hand-edit tokens.css or tailwind-preset.ts.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const UI_ROOT = resolve(__dirname, "..");

// Fixed read order: later files may reference earlier ones via var(), never
// the reverse. brewledger-tokens.css is the project layer and is read last.
const SOURCE_FILES = [
  "design/_ds/brewledger-design-system-07c182af-9b93-4f42-a3da-2adf1d189891/tokens/colors.css",
  "design/_ds/brewledger-design-system-07c182af-9b93-4f42-a3da-2adf1d189891/tokens/typography.css",
  "design/_ds/brewledger-design-system-07c182af-9b93-4f42-a3da-2adf1d189891/tokens/spacing.css",
  "design/_ds/brewledger-design-system-07c182af-9b93-4f42-a3da-2adf1d189891/tokens/effects.css",
  "design/brewledger-tokens.css",
].map((p) => resolve(REPO_ROOT, p));

// spacing.css sets `font-size:62.5%` on :root — the rem basis for every rem
// value in every other file (1.6rem = 16px only because of this line). We
// convert every rem token to its px equivalent when emitting the Tailwind
// preset (self-contained, doesn't depend on a global root font-size neither
// app might set identically) while tokens.css keeps the rem values verbatim
// AND re-declares this same font-size:62.5% rule, so tokens.css is correct
// standalone too.
const REM_BASE_PERCENT = 62.5;
const REM_BASE_PX = 16 * (REM_BASE_PERCENT / 100); // 10px

function remToPx(value) {
  const m = /^(-?[\d.]+)rem$/.exec(value.trim());
  if (!m) return null;
  return `${parseFloat(m[1]) * REM_BASE_PX}px`;
}

function readSource(file) {
  return readFileSync(file, "utf8");
}

/** @returns {Map<string, {rawValue: string, sourceFile: string, sourceLine: number}>} */
function collectTokens() {
  const tokens = new Map();
  const imports = [];

  for (const file of SOURCE_FILES) {
    const css = readSource(file);
    const root = postcss.parse(css, { from: file });
    const relFile = relative(REPO_ROOT, file).replace(/\\/g, "/");

    root.walkAtRules("import", (atRule) => {
      const raw = atRule.params;
      if (!imports.includes(raw)) imports.push(raw);
    });

    root.walkRules((rule) => {
      if (rule.selector.trim() !== ":root") return;

      rule.walkDecls((decl) => {
        if (!decl.prop.startsWith("--")) return;

        const name = decl.prop;
        const line = decl.source?.start?.line ?? 0;

        if (tokens.has(name)) {
          throw new Error(
            `build-tokens: duplicate custom property ${name} — first seen at ` +
              `${tokens.get(name).sourceFile}:${tokens.get(name).sourceLine}, ` +
              `redefined at ${relFile}:${line}. brewledger-tokens.css does not ` +
              `currently redefine any base-DS token; this is either a real ` +
              `conflict or a rename in the base DS that needs a decision, not ` +
              `a silent pick.`,
          );
        }

        tokens.set(name, { rawValue: decl.value.trim(), sourceFile: relFile, sourceLine: line });
      });
    });
  }

  return { tokens, imports };
}

function resolveVarChain(rawValue, tokens, seen = new Set()) {
  const m = /^var\((--[\w-]+)\)$/.exec(rawValue.trim());
  if (!m) return rawValue;
  const ref = m[1];
  if (seen.has(ref)) {
    throw new Error(`build-tokens: circular var() reference involving ${ref}`);
  }
  const target = tokens.get(ref);
  if (!target) {
    throw new Error(`build-tokens: token references undefined ${ref}`);
  }
  seen.add(ref);
  return resolveVarChain(target.rawValue, tokens, seen);
}

function emitTokensCss(tokens, imports) {
  const lines = [];
  lines.push("/* GENERATED FILE — do not hand-edit.");
  lines.push(" * Produced by packages/ui/scripts/build-tokens.mjs from:");
  for (const f of SOURCE_FILES) {
    lines.push(` *   ${relative(REPO_ROOT, f).replace(/\\/g, "/")}`);
  }
  lines.push(" * Change the source CSS and re-run `pnpm --filter @brewledger/ui build:tokens`.");
  lines.push(" */");
  for (const raw of imports) {
    lines.push(`@import ${raw};`);
  }
  lines.push(":root{");
  lines.push(`  font-size: ${REM_BASE_PERCENT}%; /* rem basis: 1rem = ${REM_BASE_PX}px */`);
  for (const [name, { rawValue, sourceFile, sourceLine }] of tokens) {
    lines.push(`  ${name}: ${rawValue}; /* source: ${sourceFile}:${sourceLine} */`);
  }
  lines.push("}");
  lines.push("");
  return lines.join("\n");
}

function toCamel(name) {
  return name
    .replace(/^--/, "")
    .split("-")
    .map((part, i) => (i === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("");
}

const STATUS_KEYS = [
  "unpaid",
  "accepted",
  "making",
  "ready",
  "collected",
  "cancelled",
  "refunded",
  "expired",
];

function buildPresetObject(tokens) {
  const get = (name) => {
    const t = tokens.get(name);
    if (!t) throw new Error(`build-tokens: missing token ${name} while building preset`);
    return resolveVarChain(t.rawValue, tokens);
  };

  const sizeOrRem = (name) => {
    const raw = get(name);
    return remToPx(raw) ?? raw;
  };

  const colorNames = [
    "green-ledger",
    "green-brew",
    "green-cask",
    "green-sage",
    "green-mist",
    "gold",
    "gold-light",
    "gold-lightest",
    "parchment",
    "ceramic",
    "neutral-cool",
    "white",
    "black",
    "text-black",
    "text-black-soft",
    "text-white",
    "text-white-soft",
    "rewards-slate",
    "red",
    "red-tint",
    "yellow",
    "green-mist-tint",
    "input-border",
    "hairline",
    "surface-page",
    "surface-card",
    "surface-utility",
    "brand-heading",
    "brand-cta",
    "brand-band",
    "overlay-black-06",
    "overlay-black-24",
    "overlay-black-60",
    "overlay-white-10",
    "overlay-white-60",
    "overlay-white-90",
  ];
  const colors = {};
  for (const n of colorNames) colors[toCamel(`--${n}`)] = get(`--${n}`);
  colors.revenue = get("--c-revenue");
  colors.cost = get("--c-cost");
  colors.profit = get("--c-profit");
  colors.warning = get("--c-warning");
  colors.unknown = get("--c-unknown");
  colors.negative = get("--c-negative");

  const fontSize = {};
  for (let i = 1; i <= 10; i++) fontSize[`text-${i}`] = sizeOrRem(`--text-${i}`);

  const spacing = {};
  for (let i = 1; i <= 9; i++) spacing[`space-${i}`] = sizeOrRem(`--space-${i}`);
  for (const g of ["sm", "md", "lg"]) spacing[`gutter-${g}`] = sizeOrRem(`--gutter-${g}`);
  for (const c of ["sm", "md", "lg", "xl"]) spacing[`col-${c}`] = get(`--col-${c}`); // already px

  const borderRadius = {
    card: get("--radius-card"),
    pill: get("--radius-pill"),
    circle: get("--radius-circle"),
    input: get("--radius-input"),
  };

  const boxShadow = {
    card: get("--shadow-card"),
    nav: get("--shadow-nav"),
    "fab-base": get("--shadow-fab-base"),
    "fab-ambient": get("--shadow-fab-ambient"),
    "fab-ambient-active": get("--shadow-fab-ambient-active"),
  };

  const transitionTimingFunction = {
    standard: get("--ease-standard"),
    spring: get("--ease-spring"),
  };

  const transitionDuration = {
    fast: get("--duration-fast"),
    standard: get("--duration-standard"),
    slow: get("--duration-slow"),
  };

  const lineHeight = {
    normal: get("--lh-normal"),
    compact: get("--lh-compact"),
    "thai-body": get("--lh-thai-body"),
    "thai-head": get("--lh-thai-head"),
  };

  const fontFamily = {
    // --font-thai leads with Noto Sans Thai; Manrope alone (--font-sans)
    // carries no Thai glyphs and must never be the default sans stack for
    // either app. See docs/ui/design_system_port_design.md §1.2.
    sans: splitFontStack(get("--font-thai")),
    serif: splitFontStack(get("--font-serif")),
    script: splitFontStack(get("--font-script")),
  };

  const orderStatus = {};
  for (const key of STATUS_KEYS) {
    orderStatus[key] = { bg: get(`--st-${key}-bg`), fg: get(`--st-${key}-fg`) };
  }

  return {
    colors,
    fontFamily,
    fontSize,
    lineHeight,
    letterSpacing: {
      normal: get("--tracking-normal"),
      loose: get("--tracking-loose"),
      looser: get("--tracking-looser"),
    },
    spacing,
    borderRadius,
    boxShadow,
    transitionTimingFunction,
    transitionDuration,
    tapTarget: { min: get("--tap-min"), wet: get("--tap-wet") },
    orderStatus,
    pressScale: get("--press-scale"),
  };
}

function splitFontStack(value) {
  // Values look like: 'Noto Sans Thai','Manrope',"Helvetica Neue",Helvetica,Arial,sans-serif
  // postcss-value-parser would work but this is a single-level comma split
  // with no nested functions in a font stack — safe here, unlike shadow/
  // gradient values elsewhere in these files.
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function emitPresetTs(preset) {
  const json = JSON.stringify(preset, null, 2);
  return `// GENERATED FILE — do not hand-edit.
// Produced by packages/ui/scripts/build-tokens.mjs. Change the source CSS in
// /design and re-run \`pnpm --filter @brewledger/ui build:tokens\`.
//
// Consumed as a Tailwind v4 theme extension by both apps' root CSS entry
// point (see packages/ui/README.md). tapTarget and orderStatus are
// BrewLedger-specific extensions with no stock Tailwind theme key — kept out
// of \`colors\` deliberately so \`bg-unpaid-bg\` can't be written as an
// arbitrary utility divorced from OrderStatusBadge/StatusButton.

export interface BrewLedgerThemeExtend {
  colors: Record<string, string>;
  fontFamily: Record<string, string[]>;
  fontSize: Record<string, string>;
  lineHeight: Record<string, string>;
  letterSpacing: Record<string, string>;
  spacing: Record<string, string>;
  borderRadius: Record<string, string>;
  boxShadow: Record<string, string>;
  transitionTimingFunction: Record<string, string>;
  transitionDuration: Record<string, string>;
  tapTarget: { min: string; wet: string };
  orderStatus: Record<string, { bg: string; fg: string }>;
  pressScale: string;
}

export const brewLedgerThemeExtend: BrewLedgerThemeExtend = ${json} as const;

export default brewLedgerThemeExtend;
`;
}

function emitMeta(tokens) {
  const meta = {};
  for (const [name, v] of tokens) meta[name] = v;
  return JSON.stringify(meta, null, 2) + "\n";
}

function main() {
  const { tokens, imports } = collectTokens();

  const tokensCss = emitTokensCss(tokens, imports);
  writeFileSync(join(UI_ROOT, "src", "tokens.css"), tokensCss, "utf8");

  const preset = buildPresetObject(tokens);
  writeFileSync(join(UI_ROOT, "tailwind-preset.ts"), emitPresetTs(preset), "utf8");

  writeFileSync(join(UI_ROOT, "src", "tokens.generated.meta.json"), emitMeta(tokens), "utf8");

  console.log(`build-tokens: emitted ${tokens.size} custom properties.`);
}

main();
