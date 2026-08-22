import { describe, expect, it } from "vitest";
import { toBaseUnit, costPerBaseUnit, costPerHumanUnit } from "./units";

describe("toBaseUnit -- mass family (kg/g -> g)", () => {
  it("kg -> g multiplies by 1000", () => {
    expect(toBaseUnit(1, "kg", "g")).toBe(1000);
    expect(toBaseUnit(2.5, "kg", "g")).toBe(2500);
  });

  it("g -> g is identity", () => {
    expect(toBaseUnit(18, "g", "g")).toBe(18);
    expect(toBaseUnit(0.5, "g", "g")).toBe(0.5);
  });
});

describe("toBaseUnit -- volume family (L/ml -> ml)", () => {
  it("L -> ml multiplies by 1000", () => {
    expect(toBaseUnit(1, "L", "ml")).toBe(1000);
    expect(toBaseUnit(0.2, "L", "ml")).toBeCloseTo(200, 6);
  });

  it("ml -> ml is identity", () => {
    expect(toBaseUnit(150, "ml", "ml")).toBe(150);
  });
});

describe("toBaseUnit -- count family (dozen/pack/piece -> piece)", () => {
  it("dozen -> piece multiplies by 12", () => {
    expect(toBaseUnit(1, "dozen", "piece")).toBe(12);
    expect(toBaseUnit(2, "dozen", "piece")).toBe(24);
  });

  it("piece -> piece is identity", () => {
    expect(toBaseUnit(240, "piece", "piece")).toBe(240);
  });

  it("pack -> piece multiplies by the given packSize", () => {
    expect(toBaseUnit(4, "pack", "piece", 50)).toBe(200); // 4 packs of 50 cups
    expect(toBaseUnit(1, "pack", "piece", 6)).toBe(6);
  });

  it("pack -> piece throws when packSize is missing, zero, or negative", () => {
    expect(() => toBaseUnit(4, "pack", "piece")).toThrow(/packSize/);
    expect(() => toBaseUnit(4, "pack", "piece", 0)).toThrow(/packSize/);
    expect(() => toBaseUnit(4, "pack", "piece", -1)).toThrow(/packSize/);
  });
});

describe("toBaseUnit -- incompatible pairs throw rather than coerce", () => {
  it("kg -> ml throws (mass into a volume base unit)", () => {
    expect(() => toBaseUnit(1, "kg", "ml")).toThrow(/incompatible/i);
  });

  it("L -> g throws (volume into a mass base unit)", () => {
    expect(() => toBaseUnit(1, "L", "g")).toThrow(/incompatible/i);
  });

  it("dozen -> g throws (count into a mass base unit)", () => {
    expect(() => toBaseUnit(1, "dozen", "g")).toThrow(/incompatible/i);
  });

  it("g -> piece throws (mass into a count base unit)", () => {
    expect(() => toBaseUnit(1, "g", "piece")).toThrow(/incompatible/i);
  });

  it("ml -> piece throws (volume into a count base unit)", () => {
    expect(() => toBaseUnit(1, "ml", "piece")).toThrow(/incompatible/i);
  });

  it("piece -> g throws (count into a mass base unit)", () => {
    expect(() => toBaseUnit(1, "piece", "g")).toThrow(/incompatible/i);
  });
});

describe("costPerBaseUnit -- the regression-guard assertion", () => {
  it("1 kg at 450 THB (45,000 satang) yields EXACTLY 45 satang per gram -- a factor-of-1000 regression must fail this loudly", () => {
    const satangPerGram = costPerBaseUnit(45_000, 1, "kg", "g");
    expect(satangPerGram).toBe(45);
    // Explicit anti-regression: if the kg multiplier ever silently becomes
    // 1 instead of 1000 (the exact bug class this entry exists to prevent),
    // this would be 45000, not 45 -- fail loudly, not "close enough".
    expect(satangPerGram).not.toBe(45_000);
  });
});

describe("costPerBaseUnit -- further worked examples per unit family", () => {
  it("1 L of milk at 60 THB (6,000 satang) yields 6 satang per ml", () => {
    expect(costPerBaseUnit(6_000, 1, "L", "ml")).toBe(6);
  });

  it("1 dozen eggs at 60 THB (6,000 satang) yields 500 satang per piece", () => {
    expect(costPerBaseUnit(6_000, 1, "dozen", "piece")).toBe(500);
  });

  it("a 50-cup pack at 220 THB (22,000 satang) yields 440 satang per piece", () => {
    expect(costPerBaseUnit(22_000, 1, "pack", "piece", 50)).toBe(440);
  });

  it("900 g of beans at 405 THB (40,500 satang) yields 45 satang per gram (non-1kg anchor, same rate)", () => {
    expect(costPerBaseUnit(40_500, 900, "g", "g")).toBe(45);
  });

  it("propagates toBaseUnit's incompatible-pair throw", () => {
    expect(() => costPerBaseUnit(45_000, 1, "kg", "ml")).toThrow(/incompatible/i);
  });

  it("throws rather than dividing by zero when the converted quantity is zero", () => {
    expect(() => costPerBaseUnit(1_000, 0, "g", "g")).toThrow(/must be > 0/);
  });
});

describe("costPerHumanUnit -- display-only conversion (WBS 6.5: '45 บาท/กก.' not '4.5 สตางค์/กรัม')", () => {
  it("g -> กก. (x1000)", () => {
    expect(costPerHumanUnit(45, "g")).toEqual({ satangPerHumanUnit: 45_000, label: "กก." });
  });

  it("ml -> ล. (x1000)", () => {
    expect(costPerHumanUnit(6, "ml")).toEqual({ satangPerHumanUnit: 6_000, label: "ล." });
  });

  it("piece -> ชิ้น (x1, no scaling)", () => {
    expect(costPerHumanUnit(220, "piece")).toEqual({ satangPerHumanUnit: 220, label: "ชิ้น" });
  });
});
