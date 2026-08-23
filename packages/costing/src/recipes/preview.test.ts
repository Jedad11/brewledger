// WBS 6.7 -- the entry's own acceptance criterion: "the cost preview updates
// live and shows `—` while any referenced ingredient has no cost." Tested
// here at the pure-function level (previewRecipeCostSatang), which is where
// that guarantee actually lives -- the console screen only calls this and
// renders its result through MoneyValue, so a correct return value here is
// what makes the screen correct, not the JSX around it.
import { describe, expect, it } from "vitest";
import { previewRecipeCostSatang } from "./preview";

describe("previewRecipeCostSatang", () => {
  it("returns null (never 0) for no lines at all", () => {
    expect(previewRecipeCostSatang([])).toBeNull();
  });

  it("sums qty * unitCostSatang across every line when all costs are known", () => {
    const result = previewRecipeCostSatang([
      { qtyBaseUnit: 18, unitCostSatang: 50 }, // 900
      { qtyBaseUnit: 200, unitCostSatang: 3 }, // 600
    ]);
    expect(result).toBe(1500);
  });

  it("returns null -- never a partial sum -- the instant ANY line's ingredient has an unknown cost", () => {
    const result = previewRecipeCostSatang([
      { qtyBaseUnit: 18, unitCostSatang: 50 },
      { qtyBaseUnit: 200, unitCostSatang: null },
      { qtyBaseUnit: 30, unitCostSatang: 10 },
    ]);
    expect(result).toBeNull();
    expect(result).not.toBe(0);
  });

  it("rounds a fractional total to the nearest whole satang", () => {
    const result = previewRecipeCostSatang([{ qtyBaseUnit: 3, unitCostSatang: 7 }]);
    expect(result).toBe(21);
    expect(Number.isInteger(result)).toBe(true);
  });
});
