// WBS 4.1 — Testing block, item 2: "Unit: phone number normalisation across
// the three common Thai input formats."
//
// Pure-function unit tests, no network/DB — normalizeThaiPhone/
// formatThaiPhoneForDisplay have zero I/O.
import { describe, expect, it } from "vitest";
import { formatThaiPhoneForDisplay, normalizeThaiPhone } from "./phone";

describe("normalizeThaiPhone", () => {
  describe("the three formats named in the WBS testing block all normalise to the same E.164 value", () => {
    const cases: Array<[string, string]> = [
      ["0812345678", "+66812345678"],
      ["081-234-5678", "+66812345678"],
      ["+66812345678", "+66812345678"],
    ];

    for (const [input, expected] of cases) {
      it(`"${input}" -> "${expected}"`, () => {
        expect(normalizeThaiPhone(input)).toBe(expected);
      });
    }

    it("all three inputs converge on the identical normalised value", () => {
      const results = new Set(cases.map(([input]) => normalizeThaiPhone(input)));
      expect(results.size).toBe(1);
      expect([...results][0]).toBe("+66812345678");
    });
  });

  describe("additional realistic variants", () => {
    it("accepts spaces instead of dashes: 081 234 5678", () => {
      expect(normalizeThaiPhone("081 234 5678")).toBe("+66812345678");
    });

    it("accepts 66 without a leading plus: 66812345678", () => {
      expect(normalizeThaiPhone("66812345678")).toBe("+66812345678");
    });

    it("accepts a 06x (mobile) and 09x (mobile) leading digit, not just 08x", () => {
      expect(normalizeThaiPhone("0612345678")).toBe("+66612345678");
      expect(normalizeThaiPhone("0912345678")).toBe("+66912345678");
    });

    it("trims surrounding whitespace", () => {
      expect(normalizeThaiPhone("  081-234-5678  ")).toBe("+66812345678");
    });
  });

  describe("rejects invalid input rather than guessing", () => {
    it("a landline-shaped number (leading 0, but not 6/8/9) is rejected", () => {
      // Thai mobiles are 06x/08x/09x; 02x etc. are Bangkok landlines.
      expect(normalizeThaiPhone("0212345678")).toBeNull();
    });

    it("too few digits is rejected", () => {
      expect(normalizeThaiPhone("081234567")).toBeNull();
    });

    it("too many digits is rejected", () => {
      expect(normalizeThaiPhone("08123456789")).toBeNull();
    });

    it("non-Thai country code is rejected", () => {
      expect(normalizeThaiPhone("+16502530000")).toBeNull();
    });

    it("empty string is rejected", () => {
      expect(normalizeThaiPhone("")).toBeNull();
    });

    it("letters/garbage input is rejected", () => {
      expect(normalizeThaiPhone("not-a-phone-number")).toBeNull();
    });
  });
});

describe("formatThaiPhoneForDisplay", () => {
  it("formats E.164 back to the 0XX-XXX-XXXX shape shown for confirmation", () => {
    expect(formatThaiPhoneForDisplay("+66812345678")).toBe("081-234-5678");
  });

  it("round-trips: normalise then format returns the canonical local display for every input format", () => {
    const inputs = ["0812345678", "081-234-5678", "+66812345678"];
    for (const input of inputs) {
      const normalized = normalizeThaiPhone(input);
      expect(normalized).not.toBeNull();
      expect(formatThaiPhoneForDisplay(normalized as string)).toBe("081-234-5678");
    }
  });
});
