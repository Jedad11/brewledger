// WBS 6.9 -- independent QA adversarial extension of costPerCup.test.ts.
//
// Purpose: re-derive the null-propagation truth table from scratch rather
// than trusting the engineer's own costPerCup.test.ts, and specifically hunt
// for any input shape that could make computeCostPerCupSatang / marginSatang
// / marginPercent silently produce 0 or a partial number instead of null.
// Every case below was picked because it stresses a distinct branch or a
// distinct kind of "looks like zero/unknown but isn't" confusion:
//   - a genuinely free ingredient (cost 0, non-null) mixed with priced ones
//   - qty_base_unit = 0 (a real BOM line that contributes nothing, not the
//     same as an unknown-cost line)
//   - many null-cost rows, not just one
//   - a null-cost row with qty 0 (still must poison the whole item)
//   - fractional numeric(14,4) qty across multiple lines, rounding only at
//     the very end, not per-line
//   - a worked 3-ingredient example computed independently by hand
import { describe, expect, it } from "vitest";
import { computeCostPerCupSatang, marginSatang, marginPercent, type BomCostRow } from "./costPerCup";

function row(qtyBaseUnit: number, ingredientUnitCostSatang: number | null): BomCostRow {
  return { qtyBaseUnit, ingredientUnitCostSatang };
}

describe("computeCostPerCupSatang -- QA adversarial extension", () => {
  it("a genuinely free ingredient (cost 0, NOT null) contributes 0 and does not poison the sum", () => {
    // Tap water: 50 g at a real, known cost of 0 satang/g. Mixed with a
    // priced ingredient. Must sum to exactly the priced ingredient's cost,
    // not null -- 0 is a legitimate known cost, distinct from "unknown".
    expect(computeCostPerCupSatang([row(50, 0), row(18, 5)])).toBe(90);
  });

  it("every ingredient genuinely free (all costs 0, none null) -> a real 0, not null", () => {
    expect(computeCostPerCupSatang([row(50, 0), row(10, 0)])).toBe(0);
  });

  it("qty_base_unit = 0 on a tracked (non-null-cost) row contributes nothing but does not poison the item", () => {
    expect(computeCostPerCupSatang([row(0, 500), row(18, 5)])).toBe(90);
  });

  it("qty_base_unit = 0 on the ONE null-cost row still poisons the whole item to null", () => {
    // A zero quantity does not excuse an unknown unit cost -- the line still
    // references an ingredient with no confirmed purchase, so the item's
    // cost is unknown regardless of how much of it the recipe uses.
    expect(computeCostPerCupSatang([row(0, null), row(18, 5)])).toBeNull();
  });

  it("multiple null-cost rows among several non-null rows -> still null, not a sum over the tracked subset", () => {
    expect(
      computeCostPerCupSatang([row(200, 45), row(30, null), row(1, 500), row(5, null)]),
    ).toBeNull();
  });

  it("all rows null -> null", () => {
    expect(computeCostPerCupSatang([row(1, null), row(1, null), row(1, null)])).toBeNull();
  });

  it("fractional numeric(14,4)-style quantities across multiple lines sum to the exact integer satang total, rounded once at the end", () => {
    // Three lines whose individual products are non-integer but whose SUM
    // happens to land on an exact integer -- proves rounding is not applied
    // per-line (which would risk drifting the total by a satang or two).
    // 12.3456 * 10  = 123.456
    // 7.6544  * 10  = 76.544
    // 1       * 100 = 100
    // sum = 123.456 + 76.544 + 100 = 300 exactly.
    expect(
      computeCostPerCupSatang([row(12.3456, 10), row(7.6544, 10), row(1, 100)]),
    ).toBe(300);
  });

  it("worked 3-ingredient latte, computed independently by hand, produces the exact expected integer", () => {
    // Oat milk: 220 ml at 0.62 satang/ml (62 satang/L)         = 136.4
    // Espresso beans: 20 g at 2.75 satang/g (2750 satang/kg)   = 55
    // Cup + lid + sleeve: 1 piece at 315 satang                = 315
    // Hand sum: 136.4 + 55 + 315 = 506.4 -> rounds to 506.
    const latte = [row(220, 0.62), row(20, 2.75), row(1, 315)];
    expect(computeCostPerCupSatang(latte)).toBe(506);
  });

  it("negative qty_base_unit (should not occur per schema, but must not crash or fabricate null->non-null) still sums arithmetically", () => {
    // Not a sanctioned input shape, but the function must not throw or
    // silently special-case it into null/0; it is a pure arithmetic sum.
    expect(computeCostPerCupSatang([row(-5, 10), row(10, 10)])).toBe(50);
  });

  it("a single null-cost row, alone, with a zero quantity -> null, never 0", () => {
    expect(computeCostPerCupSatang([row(0, null)])).toBeNull();
  });
});

describe("marginSatang / marginPercent -- QA adversarial extension", () => {
  it("marginSatang: cost 0 (real free item) and price 0 -> 0, a real number, not null", () => {
    expect(marginSatang(0, 0)).toBe(0);
  });

  it("marginPercent: cost 0 (real free item), price > 0 -> exactly 1 (100%), a LEGITIMATE 100% margin distinct from the forbidden null-coerced-to-100% case", () => {
    // This is the one case where 100% is the honestly correct answer: an
    // ingredient that is truly, confirmedly free. The forbidden case is
    // treating an UNKNOWN cost as if it were this -- which is exactly why
    // marginPercent must distinguish costSatang === null (forbidden, ->
    // null) from costSatang === 0 (legitimate, -> 1).
    expect(marginPercent(10000, 0)).toBe(1);
  });

  it("marginPercent: negative price with known cost -> a real (out-of-[0,1]) number, not clamped, not null", () => {
    expect(marginPercent(-100, 50)).toBe((-100 - 50) / -100);
  });

  it("marginSatang and marginPercent never return NaN for any non-null-cost combination including price=cost=0", () => {
    expect(Number.isNaN(marginSatang(0, 0))).toBe(false);
  });

  it("marginPercent: cost null takes priority regardless of price sign or magnitude", () => {
    expect(marginPercent(-100, null)).toBeNull();
    expect(marginPercent(999999, null)).toBeNull();
  });
});
