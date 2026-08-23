// WBS 6.9 -- pure-function tests for computeCostPerCupSatang/marginSatang/
// marginPercent (packages/costing/src/costPerCup.ts). No DB dependency here
// by design -- see costPerCup.ts's own header comment on scope. No
// fast-check dependency exists anywhere in this repo yet (checked
// package.json/pnpm-lock.yaml before writing this file), so the "property:
// null in, null out for every combination" requirement is satisfied with an
// exhaustive table over every null/non-null combination instead, same
// spirit as cost.test.ts's worked-example style.
import { describe, expect, it } from "vitest";
import { computeCostPerCupSatang, marginSatang, marginPercent, type BomCostRow } from "./costPerCup";

function row(qtyBaseUnit: number, ingredientUnitCostSatang: number | null): BomCostRow {
  return { qtyBaseUnit, ingredientUnitCostSatang };
}

describe("computeCostPerCupSatang", () => {
  it("REQUIRED (RL-2): no BOM rows -> null, never 0", () => {
    expect(computeCostPerCupSatang([])).toBeNull();
  });

  it("REQUIRED (RL-2): any row with a null ingredient cost -> null for the WHOLE item, not a partial sum", () => {
    expect(
      computeCostPerCupSatang([row(200, 45), row(30, null), row(1, 500)]),
    ).toBeNull();
  });

  it("null-cost row anywhere in the array (first, middle, last) always wins over any tracked rows", () => {
    expect(computeCostPerCupSatang([row(1, null), row(1, 10)])).toBeNull();
    expect(computeCostPerCupSatang([row(1, 10), row(1, null), row(1, 10)])).toBeNull();
    expect(computeCostPerCupSatang([row(1, 10), row(1, null)])).toBeNull();
  });

  it("complete BOM -> the exact integer satang sum", () => {
    // 2 lines, whole-number products: 200g milk @ 0.45 satang/g = 90 satang,
    // 18g coffee @ 5 satang/g = 90 satang -> 180 satang total.
    expect(computeCostPerCupSatang([row(200, 0.45), row(18, 5)])).toBe(180);
  });

  it("worked 3-ingredient latte example produces the exact expected integer", () => {
    // Milk: 200 ml at 0.4 satang/ml (40 satang/L)      = 80 satang
    // Espresso beans: 18 g at 3 satang/g (3000 satang/kg) = 54 satang
    // Cup + lid: 1 piece at 250 satang                  = 250 satang
    // Total: 80 + 54 + 250 = 384 satang.
    const latte = [row(200, 0.4), row(18, 3), row(1, 250)];
    expect(computeCostPerCupSatang(latte)).toBe(384);
  });

  it("rounds a fractional satang total to the nearest whole satang", () => {
    // 3 units at 0.335 satang/unit = 1.005 -> rounds to 1.
    expect(computeCostPerCupSatang([row(3, 0.335)])).toBe(1);
  });

  it("single tracked row -> that row's own cost", () => {
    expect(computeCostPerCupSatang([row(10, 5)])).toBe(50);
  });
});

describe("marginSatang", () => {
  it("REQUIRED (RL-2): cost null -> null, never price or 0", () => {
    expect(marginSatang(10000, null)).toBeNull();
  });

  it("cost 0 (a real, known zero cost, distinct from unknown) -> price itself, not null", () => {
    expect(marginSatang(10000, 0)).toBe(10000);
  });

  it("known price and cost -> price minus cost", () => {
    expect(marginSatang(10000, 3840)).toBe(6160);
  });

  it("price 0, cost known -> a real (negative) number, not null -- price=0 alone does not trigger the null branch here", () => {
    expect(marginSatang(0, 100)).toBe(-100);
  });

  it("cost greater than price -> a correctly signed negative margin", () => {
    expect(marginSatang(100, 500)).toBe(-400);
  });
});

describe("marginPercent", () => {
  it("REQUIRED (RL-2): cost null -> null, never 100% and never 0%", () => {
    expect(marginPercent(10000, null)).toBeNull();
  });

  it("REQUIRED: price 0 -> null (division by zero price is not a real percentage), even when cost is known", () => {
    expect(marginPercent(0, 100)).toBeNull();
  });

  it("price 0 AND cost null -> still null (both guards independently sufficient)", () => {
    expect(marginPercent(0, null)).toBeNull();
  });

  it("known price and cost -> the exact fractional margin", () => {
    expect(marginPercent(10000, 3840)).toBe(0.616);
  });

  it("cost equal to price -> exactly 0, a real (not null) 0% margin", () => {
    expect(marginPercent(1000, 1000)).toBe(0);
  });

  it("cost greater than price -> a correctly signed negative percent, not clamped to 0", () => {
    expect(marginPercent(100, 150)).toBe(-0.5);
  });
});
