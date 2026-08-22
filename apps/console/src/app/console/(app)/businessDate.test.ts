// WBS 7.1 — business-date cut-off (WBS Dictionary line 5551-5553): a sale
// belongs to the calendar day it fell on in the STORE timezone, not UTC.
import { describe, expect, it } from "vitest";
import { businessDateBoundsUtc } from "./businessDate";

describe("businessDateBoundsUtc", () => {
  it("resolves a UTC instant just after midnight Bangkok time to the LOCAL calendar day, not the UTC one", () => {
    // 2026-08-22T18:30:00Z is 2026-08-23T01:30:00+07:00 in Bangkok --
    // already the next local day even though the UTC date is still the 22nd.
    const now = new Date("2026-08-22T18:30:00Z");
    const bounds = businessDateBoundsUtc("Asia/Bangkok", now);

    expect(bounds.businessDate).toBe("2026-08-23");
    // Local midnight 2026-08-23T00:00:00+07:00 === 2026-08-22T17:00:00Z.
    expect(bounds.startUtc.toISOString()).toBe("2026-08-22T17:00:00.000Z");
    expect(bounds.endUtc.toISOString()).toBe("2026-08-23T17:00:00.000Z");
  });

  it("a sale timestamp inside [startUtc, endUtc) is the one instant this business date should include", () => {
    const now = new Date("2026-08-22T18:30:00Z");
    const bounds = businessDateBoundsUtc("Asia/Bangkok", now);

    expect(now.getTime()).toBeGreaterThanOrEqual(bounds.startUtc.getTime());
    expect(now.getTime()).toBeLessThan(bounds.endUtc.getTime());
  });

  it("produces exactly a 24-hour window", () => {
    const bounds = businessDateBoundsUtc("Asia/Bangkok", new Date("2026-08-22T12:00:00Z"));
    expect(bounds.endUtc.getTime() - bounds.startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
