// WBS 6.6 -- Unit Cost Update Engine: pure-function tests for
// trailingMedianCost/driftRatio (packages/costing/src/cost.ts). No DB
// dependency here by design -- see cost.ts's own header comment on scope.
// Mirrors units.test.ts's style (one describe per function, one scenario
// per it, worked-example anchors named for what they prove).
import { describe, expect, it } from "vitest";
import { trailingMedianCost, driftRatio, type IngredientCostHistoryRow } from "./cost";

function row(newCostSatang: number, changedAt = "2026-01-01T00:00:00.000Z"): IngredientCostHistoryRow {
  return { newCostSatang, changedAt };
}

describe("trailingMedianCost", () => {
  it("empty array -> null, never 0 (no history in the window is not a free ingredient)", () => {
    expect(trailingMedianCost([])).toBeNull();
  });

  it("odd-length array -> the middle value once sorted", () => {
    // Deliberately supplied out of order -- see the dedicated "does not
    // assume pre-sorted input" case below for why that matters; this one
    // just pins the odd-count formula itself.
    expect(trailingMedianCost([row(30), row(10), row(20)])).toBe(20);
  });

  it("even-length array -> the average of the two middle values once sorted", () => {
    expect(trailingMedianCost([row(10), row(20), row(30), row(40)])).toBe(25);
  });

  it("single-row array -> that row's own cost", () => {
    expect(trailingMedianCost([row(45)])).toBe(45);
  });

  it("does not assume pre-sorted input -- rows arriving in an arbitrary order still yield the correct median", () => {
    // Same 4 values as the even-length case above, shuffled into a
    // deliberately non-monotonic order (a caller reading straight off
    // ingredient_cost_history's changed_at desc index, for instance, would
    // hand rows newest-first, not cost-sorted).
    const shuffled = [row(40), row(10), row(30), row(20)];
    expect(trailingMedianCost(shuffled)).toBe(25);

    const shuffledOdd = [row(30), row(20), row(10)];
    expect(trailingMedianCost(shuffledOdd)).toBe(20);
  });
});

describe("driftRatio", () => {
  it("baseline null -> null (no history to compare against, not a fabricated 0% or 100% drift)", () => {
    expect(driftRatio(150, null)).toBeNull();
  });

  it("baseline 0 -> null (guards the division-by-zero case rather than returning Infinity/NaN)", () => {
    expect(driftRatio(150, 0)).toBeNull();
  });

  it("current=150, baseline=100 -> 0.5 (the canonical 50% increase this entry's own worked example uses)", () => {
    expect(driftRatio(150, 100)).toBe(0.5);
  });

  it("current below baseline -> a correctly signed negative ratio, not an absolute value", () => {
    expect(driftRatio(50, 100)).toBe(-0.5);
  });

  it("current equal to baseline -> exactly 0, no drift", () => {
    expect(driftRatio(100, 100)).toBe(0);
  });
});
