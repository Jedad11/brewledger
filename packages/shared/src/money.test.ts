// WBS 4.4 testing block — "Money round-trip test: 45.50 THB -> 4550 satang
// -> displays '45.50' with no float drift." money.ts itself predates this
// entry (WBS 2.5-ish groundwork) and had no test file yet.
import { describe, expect, it } from "vitest";
import { satangToThb, thbToSatang, formatSatangAsThb } from "./money";

describe("thbToSatang / satangToThb round-trip", () => {
  it("45.50 THB -> 4550 satang exactly, no float drift", () => {
    expect(thbToSatang(45.5)).toBe(4550);
    expect(satangToThb(4550)).toBe(45.5);
  });

  it("formatSatangAsThb(4550) reads exactly 45.50, never a float artifact like 45.49999999999", () => {
    const formatted = formatSatangAsThb(4550);
    expect(formatted).toContain("45.50");
    expect(formatted).not.toMatch(/45\.4999|45\.5000000/);
  });

  it("a value that would drift under naive float math (0.1 + 0.2-style) still round-trips exactly", () => {
    // 33.30 THB is the canonical floating-point trap: 33.3 * 100 in raw JS
    // float math is 3329.9999999999995, not 3330 — thbToSatang's Math.round
    // is what closes that gap. If a future edit drops the rounding, this
    // fails at 3329, not 3330.
    expect(thbToSatang(33.3)).toBe(3330);
    expect(satangToThb(3330)).toBe(33.3);
  });

  it("zero is a real, representable value distinct from null (RL-2's null-vs-zero discipline is a MoneyValue-level concern, not this module's, but zero itself must still round-trip)", () => {
    expect(thbToSatang(0)).toBe(0);
    expect(satangToThb(0)).toBe(0);
  });

  it("negative values (a price-delta discount) round-trip exactly", () => {
    expect(thbToSatang(-5)).toBe(-500);
    expect(satangToThb(-500)).toBe(-5);
  });
});
