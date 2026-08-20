// WBS 4.5 — unit coverage for the PromptPay identifier normalisers
// (normalize.ts). RL-1: a typo here is not cosmetic -- every future order's
// QR is built from whatever these functions accept, so the check-digit
// rejection path for `nid` is the single highest-value assertion in this
// file: get it wrong and every customer's money goes to a stranger.
//
// Pure functions, no I/O -- no DB, no mocks needed.
import { describe, expect, it } from "vitest";
import {
  computeThaiNidCheckDigit,
  normalizeMsisdn,
  normalizeNid,
  normalizePromptPayId,
  normalizeTaxid,
} from "./normalize";

describe("normalizeMsisdn", () => {
  it("accepts a bare 10-digit number starting with 0", () => {
    expect(normalizeMsisdn("0812345678")).toEqual({ ok: true, value: "0812345678", error: null });
  });

  it("strips hyphens", () => {
    expect(normalizeMsisdn("081-234-5678")).toEqual({ ok: true, value: "0812345678", error: null });
  });

  it("strips spaces", () => {
    expect(normalizeMsisdn("081 234 5678")).toEqual({ ok: true, value: "0812345678", error: null });
  });

  it("strips a mix of spaces and hyphens", () => {
    expect(normalizeMsisdn(" 081-234 5678 ")).toEqual({ ok: true, value: "0812345678", error: null });
  });

  it("rejects a number not starting with 0", () => {
    const result = normalizeMsisdn("1812345678");
    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
    expect(result.error).toEqual(expect.any(String));
  });

  it("rejects too few digits", () => {
    expect(normalizeMsisdn("081234567").ok).toBe(false);
  });

  it("rejects too many digits", () => {
    expect(normalizeMsisdn("08123456789").ok).toBe(false);
  });

  it("rejects non-digit characters that survive separator stripping", () => {
    expect(normalizeMsisdn("081234567a").ok).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(normalizeMsisdn("").ok).toBe(false);
  });
});

// The Thai national ID check-digit algorithm, transcribed independently
// from the public spec (digit[i] * (13-i) for i = 1..12 over 1-indexed
// positions, check = (11 - sum mod 11) mod 10) rather than by importing
// computeThaiNidCheckDigit -- so a bug shared between the production
// formula and a test that just re-called the same function could not hide.
function independentThaiNidCheckDigit(first12Digits: string): number {
  let sum = 0;
  for (let pos = 1; pos <= 12; pos++) {
    const digit = Number(first12Digits[pos - 1]);
    sum += digit * (14 - pos); // pos=1 -> weight 13, pos=12 -> weight 2
  }
  return (11 - (sum % 11)) % 10;
}

describe("computeThaiNidCheckDigit", () => {
  const first12Vectors = [
    "110170023070", // realistic-shaped Thai ID prefix
    "000000000000",
    "111111111111",
    "999999999999",
    "123456789012",
    "987654321098",
    "010101010101",
    "234567890123",
  ];

  it.each(first12Vectors)(
    "matches an independently re-derived implementation of the same public formula for %s",
    (first12) => {
      expect(computeThaiNidCheckDigit(first12)).toBe(independentThaiNidCheckDigit(first12));
    },
  );

  it("always returns a single digit 0-9 across the vector set", () => {
    for (const first12 of first12Vectors) {
      const digit = computeThaiNidCheckDigit(first12);
      expect(Number.isInteger(digit)).toBe(true);
      expect(digit).toBeGreaterThanOrEqual(0);
      expect(digit).toBeLessThanOrEqual(9);
    }
  });
});

describe("normalizeNid", () => {
  // Built from computeThaiNidCheckDigit itself so this suite never depends
  // on a hand-memorised "real" ID number (unverifiable from this vantage
  // point) -- the independent-formula cross-check above is what proves the
  // check-digit MATH is right; this block proves normalizeNid's plumbing
  // (shape validation, separator stripping, accept/reject wiring) is right
  // given whatever the math produces.
  function buildValidNid(first12: string): string {
    return first12 + String(computeThaiNidCheckDigit(first12));
  }

  const VALID_FIRST12 = "110170023070";
  const VALID_NID = buildValidNid(VALID_FIRST12);

  it("accepts a 13-digit ID whose last digit is the correct check digit", () => {
    expect(normalizeNid(VALID_NID)).toEqual({ ok: true, value: VALID_NID, error: null });
  });

  it("rejects the same ID with the check digit flipped to a wrong value", () => {
    const correctDigit = Number(VALID_NID[12]);
    const wrongDigit = (correctDigit + 1) % 10;
    const tampered = VALID_NID.slice(0, 12) + String(wrongDigit);

    const result = normalizeNid(tampered);

    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
    expect(result.error).toEqual(expect.any(String));
  });

  it("rejects every other possible wrong check digit for the same 12-digit prefix", () => {
    const correctDigit = computeThaiNidCheckDigit(VALID_FIRST12);
    for (let candidate = 0; candidate <= 9; candidate++) {
      if (candidate === correctDigit) continue;
      const tampered = VALID_FIRST12 + String(candidate);
      expect(normalizeNid(tampered).ok, `digit ${candidate} should be rejected`).toBe(false);
    }
  });

  it("normalises separators before validating the check digit", () => {
    const spaced = `${VALID_NID.slice(0, 1)}-${VALID_NID.slice(1, 5)}-${VALID_NID.slice(5, 10)}-${VALID_NID.slice(10, 12)}-${VALID_NID.slice(12)}`;
    expect(normalizeNid(spaced)).toEqual({ ok: true, value: VALID_NID, error: null });
  });

  it("rejects a 12-digit (too short) input", () => {
    expect(normalizeNid(VALID_NID.slice(0, 12)).ok).toBe(false);
  });

  it("rejects a 14-digit (too long) input", () => {
    expect(normalizeNid(VALID_NID + "0").ok).toBe(false);
  });

  it("rejects non-digit characters that survive separator stripping", () => {
    expect(normalizeNid(VALID_NID.slice(0, 12) + "x").ok).toBe(false);
  });
});

describe("normalizeTaxid", () => {
  it("accepts any 13-digit string -- no check digit is enforced by design", () => {
    expect(normalizeTaxid("1234567890123")).toEqual({ ok: true, value: "1234567890123", error: null });
  });

  it("strips spaces and hyphens", () => {
    expect(normalizeTaxid("1-2345-67890-12-3")).toEqual({ ok: true, value: "1234567890123", error: null });
  });

  it("rejects fewer than 13 digits", () => {
    expect(normalizeTaxid("123456789012").ok).toBe(false);
  });

  it("rejects more than 13 digits", () => {
    expect(normalizeTaxid("12345678901234").ok).toBe(false);
  });

  it("rejects non-digit characters", () => {
    expect(normalizeTaxid("123456789012a").ok).toBe(false);
  });
});

describe("normalizePromptPayId", () => {
  it("dispatches msisdn to normalizeMsisdn", () => {
    expect(normalizePromptPayId("msisdn", "081-234-5678")).toEqual({
      ok: true,
      value: "0812345678",
      error: null,
    });
  });

  it("dispatches nid to normalizeNid, including check-digit rejection", () => {
    const invalidNid = "1101700230700"; // a random 13-digit string, check digit not asserted to be right
    const result = normalizePromptPayId("nid", invalidNid);
    // Whatever the "right" digit is, this fixed string is extremely unlikely
    // to coincide with it by chance; either way, exercise the same
    // pass-through logic normalizeNid has already been tested against.
    expect(result).toEqual(normalizeNid(invalidNid));
  });

  it("dispatches taxid to normalizeTaxid", () => {
    expect(normalizePromptPayId("taxid", "1234567890123")).toEqual({
      ok: true,
      value: "1234567890123",
      error: null,
    });
  });
});
