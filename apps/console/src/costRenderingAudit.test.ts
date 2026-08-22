// WBS 6.9 -- UI audit test (Acceptance #3 / Claude Code Prompt point 5):
// "No UI anywhere renders a null cost as 0, 0.00, or ฿0" and "Margin
// percentage is null whenever cost is null, never 100%".
//
// MoneyValue itself already renders `null` as "—" (packages/ui/src/
// components/MoneyValue.tsx, covered by its own unit tests) and MetricCard
// composes MoneyValue rather than reimplementing that branch. The failure
// mode this audit actually guards against is upstream of both: a call site
// coercing a nullable cost/margin/profit value with `?? 0` / `|| 0` (or
// hand-rolling `.toFixed(...)` instead of going through MoneyValue at all)
// BEFORE it ever reaches MoneyValue, so the null-safe component never gets
// a chance to render its own "—".
//
// MANIFEST, required by the WBS 6.9 prompt so "a newly added [cost-
// rendering component] that is not in the manifest fails the test": every
// entry below is every source file under apps/console/src that renders a
// MoneyValue/MetricCard with role="cost" or role="profit" as of this
// writing (grepped directly, not from memory -- see the WBS 6.9 engineering
// notes for the exact command). role="revenue" and role="plain" are
// deliberately NOT audited here -- RL-2 is specifically about COST/PROFIT/
// MARGIN figures; revenue (today's sales total, an order's total_satang) is
// never null-for-unknown-cost-reasons in this schema.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(__dirname);

const MANIFEST = [
  "app/console/(app)/DashboardClient.tsx",
  "app/console/(app)/reports/overview/OverviewClient.tsx",
  "app/console/(app)/reports/pnl/PnlClient.tsx",
  "app/console/(app)/reports/profit-per-dish/ProfitPerDishClient.tsx",
  "app/console/(app)/expenses/capture/PurchaseCaptureForm.tsx",
  "app/console/(app)/expenses/[id]/review/ConfirmedInvoiceView.tsx",
  "app/console/(app)/expenses/[id]/review/ReviewForm.tsx",
];

// Any `<MoneyValue ...>` or `<MetricCard ...>` JSX tag (self-closing or
// not) carrying role="cost" or role="profit", captured whole so the
// `value={...}` expression inside it can be inspected regardless of prop
// order.
const COST_OR_PROFIT_TAG = /<(MoneyValue|MetricCard)\b[^>]*\brole=(?:\{role[^}]*\}|["'](cost|profit)["'])[^>]*\/?>/g;

const FORBIDDEN_COERCION = /\?\?\s*0\b|\|\|\s*0\b|\.toFixed\(/;

function findCostOrProfitTags(source: string): string[] {
  return [...source.matchAll(COST_OR_PROFIT_TAG)].map((m) => m[0]);
}

function allSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...allSourceFiles(full));
    } else if (/\.(tsx)$/.test(entry) && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

// PLAIN-TEXT SITES, added in the WBS 6.9 post-review fix round: three real
// cost/profit-rendering call sites that render through a hand-rolled
// formatter or a pre-formatted string prop instead of a
// `<MoneyValue>`/`<MetricCard>` JSX tag, so COST_OR_PROFIT_TAG above cannot
// see them -- neither for inclusion, nor for the catch-all "nothing exists
// outside the manifest" check, since that check uses the same regex. None
// were buggy when found (qa_engineer's independent review), but none were
// protected by this file either. Each entry is checked against the full
// source text of its file (not just one JSX tag) so a regression anywhere
// in the formatter's definition OR at any of its call sites is caught.
type FormatterSite = { file: string; formatterName: string };

const FORMATTER_SITES: FormatterSite[] = [
  // RevenueProfitChart.tsx's tooltipMoneyText already null-guards
  // (`entry.value != null ? ... : "—"`) and has its own dedicated unit
  // test (RevenueProfitChart.test.ts) -- included here so a future
  // regression at this call site fails THIS audit too, not only that one
  // test file.
  { file: "app/console/(app)/reports/overview/RevenueProfitChart.tsx", formatterName: "tooltipMoneyText" },
  // ProfitPerDishClient.tsx's formatBahtPlain renders the insight
  // sentence's profit figure (Thai prose interpolation -- can't use
  // MoneyValue JSX without changing the rendered copy, since MoneyValue
  // always prints a "฿" prefix and state_matrix.md's exact sentence does
  // not want one). Made explicitly null-safe in this fix round.
  { file: "app/console/(app)/reports/profit-per-dish/ProfitPerDishClient.tsx", formatterName: "formatBahtPlain" },
];

function findLinesMentioning(source: string, needle: string): string[] {
  return source.split("\n").filter((line) => line.includes(needle));
}

describe("cost/margin/profit plain-text audit (WBS 6.9 post-review fix round)", () => {
  const NULL_GUARD = /!=\s*null|!==\s*null|==\s*null|===\s*null|\?\./;

  it.each(FORMATTER_SITES)("$file: $formatterName is null-safe at every call site", ({ file, formatterName }) => {
    const source = readFileSync(path.join(SRC_ROOT, file), "utf8");
    const lines = findLinesMentioning(source, formatterName);
    expect(lines.length, `expected ${formatterName} to appear in ${file}`).toBeGreaterThan(0);

    const defIndex = source.search(new RegExp(`function\\s+${formatterName}\\s*\\(`));
    expect(defIndex, `expected a \`function ${formatterName}(...)\` definition in ${file}`).toBeGreaterThanOrEqual(0);
    const bodyEnd = source.indexOf("\n}", defIndex);
    const body = source.slice(defIndex, bodyEnd > 0 ? bodyEnd : undefined);
    expect(
      NULL_GUARD.test(body),
      `${formatterName} in ${file} has no visible null/undefined guard (expected one of != null / === null / ?. in its body) -- it must actively check for the unknown-cost case, not just happen to avoid it: ${body}`,
    ).toBe(true);
    expect(
      FORBIDDEN_COERCION.test(body),
      `${formatterName}'s own body in ${file} coerces its nullable input to 0 before formatting: ${body}`,
    ).toBe(false);

    for (const line of lines) {
      expect(
        FORBIDDEN_COERCION.test(line),
        `${file} coerces a null cost/profit value to 0 on or around a ${formatterName} call: ${line}`,
      ).toBe(false);
    }
  });

  it("inventory/page.tsx: costLabel is only ever set inside a current_unit_cost_satang !== null guard", () => {
    const source = readFileSync(path.join(SRC_ROOT, "app/console/(app)/inventory/page.tsx"), "utf8");
    expect(source).toMatch(/let costLabel: string \| null = null;/);
    expect(source).toMatch(/if \(row\.current_unit_cost_satang !== null\)/);
    const costLines = findLinesMentioning(source, "costLabel");
    for (const line of costLines) {
      expect(
        FORBIDDEN_COERCION.test(line),
        `inventory/page.tsx coerces costLabel away from null: ${line}`,
      ).toBe(false);
    }
  });

  it("inventory/IngredientListClient.tsx: costLabel renders through ?? \"—\", never coerced", () => {
    const source = readFileSync(
      path.join(SRC_ROOT, "app/console/(app)/inventory/IngredientListClient.tsx"),
      "utf8",
    );
    expect(source).toMatch(/item\.costLabel \?\? "—"/);
    const costLines = findLinesMentioning(source, "costLabel");
    for (const line of costLines) {
      expect(
        FORBIDDEN_COERCION.test(line),
        `IngredientListClient.tsx coerces costLabel away from null: ${line}`,
      ).toBe(false);
    }
  });
});

describe("cost/margin/profit UI audit (WBS 6.9, RL-2)", () => {
  it.each(MANIFEST)("%s: no null-coercion before MoneyValue/MetricCard", (relPath) => {
    const source = readFileSync(path.join(SRC_ROOT, relPath), "utf8");
    const tags = findCostOrProfitTags(source);
    expect(tags.length, `expected at least one cost/profit MoneyValue/MetricCard in ${relPath}`).toBeGreaterThan(0);
    for (const tag of tags) {
      expect(
        FORBIDDEN_COERCION.test(tag),
        `${relPath} contains a cost/profit render that coerces null away before MoneyValue: ${tag}`,
      ).toBe(false);
    }
  });

  it("REQUIRED: no cost/profit-rendering component exists outside the manifest above", () => {
    const manifestSet = new Set(MANIFEST.map((p) => path.resolve(SRC_ROOT, p)));
    const offenders: string[] = [];

    for (const file of allSourceFiles(SRC_ROOT)) {
      if (manifestSet.has(path.resolve(file))) continue;
      const source = readFileSync(file, "utf8");
      if (findCostOrProfitTags(source).length > 0) {
        offenders.push(path.relative(SRC_ROOT, file));
      }
    }

    expect(
      offenders,
      `found cost/profit-rendering component(s) not listed in this test's MANIFEST -- add them to MANIFEST in costRenderingAudit.test.ts and audit them for null-coercion: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
