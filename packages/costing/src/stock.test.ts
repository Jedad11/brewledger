// WBS 6.8 -- pure-function tests for isNegativeStock/isLowStock
// (packages/costing/src/stock.ts). No DB dependency here by design -- see
// stock.ts's own header comment on scope.
import { describe, expect, it } from "vitest";
import { isNegativeStock, isLowStock } from "./stock";

describe("isNegativeStock", () => {
  it("negative stock -> true", () => {
    expect(isNegativeStock(-1)).toBe(true);
    expect(isNegativeStock(-0.01)).toBe(true);
  });

  it("zero or positive stock -> false", () => {
    expect(isNegativeStock(0)).toBe(false);
    expect(isNegativeStock(500)).toBe(false);
  });
});

describe("isLowStock", () => {
  it("REQUIRED: null threshold (merchant never set one) -> false, never fabricated", () => {
    expect(isLowStock(0, null)).toBe(false);
    expect(isLowStock(-50, null)).toBe(false);
    expect(isLowStock(1_000_000, null)).toBe(false);
  });

  it("stock at or below the threshold -> true", () => {
    expect(isLowStock(100, 100)).toBe(true);
    expect(isLowStock(50, 100)).toBe(true);
  });

  it("stock above the threshold -> false", () => {
    expect(isLowStock(150, 100)).toBe(false);
  });

  it("negative stock with a threshold set is also low stock -- the two warnings are not mutually exclusive", () => {
    expect(isLowStock(-10, 100)).toBe(true);
    expect(isNegativeStock(-10)).toBe(true);
  });
});
