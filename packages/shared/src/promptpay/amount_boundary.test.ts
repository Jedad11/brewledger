// WBS 5.5 qa_engineer leg — dedicated stress coverage for "amount encoding
// correct across the satang -> decimal boundary" (the WBS 5.5 Testing block
// item conformance.test.ts's own golden fixtures and generate.test.ts's
// guard-clause suite only sample at a handful of round-ish points: 100, 1,
// 5500, 12345, 450000, 99). This file exists to prove there is no rounding
// bug lurking at odd satang amounts -- the kind of value a real order total
// actually produces (menu prices plus option deltas plus quantity multiples
// rarely land on a round number).
//
// The ground truth here is a from-scratch satang -> decimal formatter built
// entirely out of INTEGER string manipulation -- no division, no
// toFixed(), nothing that touches IEEE-754 floating point at all. It is
// independent of generate.ts's own `(amountSatang / 100).toFixed(2)`
// boundary conversion (see generate.ts's header comment identifying that as
// "the one legitimate decimal conversion" in the whole system) precisely so
// this test can disagree with that line if it is ever wrong. Because satang
// is already the smallest unit of currency in this system, every valid
// amountSatang has AT MOST two decimal digits once divided by 100 -- there
// is never a third digit to round away, so unlike the classic
// `(1.005).toFixed(2) -> "1.00"` JS gotcha, a correct implementation here
// can never face an actual rounding decision. A bug that appears anyway
// would be a floating-point REPRESENTATION error (e.g. 107/100 not being
// exactly representable in binary), not a rounding-policy error -- this
// sweep is built to catch exactly that class of bug.
import { describe, expect, it } from "vitest";
import { buildPromptPayPayload } from "./generate";

// --- independent TLV parser, a fourth copy in this package (see
// generate.test.ts and conformance.test.ts's own near-identical parsers,
// each deliberately un-shared) -----------------------------------------
function parseTLV(payload: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    const tag = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isInteger(len) || len < 0) {
      throw new Error(`malformed TLV at offset ${i} in payload: ${payload}`);
    }
    fields[tag] = payload.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return fields;
}

const TAG_AMOUNT = "54";

// Ground truth: pure integer/string arithmetic, zero floating-point
// division anywhere in this function.
function satangToDecimalStringExact(satang: number): string {
  if (!Number.isInteger(satang) || satang <= 0) {
    throw new Error(`satangToDecimalStringExact: expected a positive integer, got ${satang}`);
  }
  const digits = String(satang).padStart(3, "0"); // e.g. 7 -> "007", 12345 -> "12345"
  const fracPart = digits.slice(-2);
  const wholePartRaw = digits.slice(0, -2);
  const wholePart = wholePartRaw.replace(/^0+(?=\d)/, ""); // strip leading zeros, keep a lone "0"
  return `${wholePart}.${fracPart}`;
}

describe("satangToDecimalStringExact — self-check of the ground-truth formatter", () => {
  it.each([
    [1, "0.01"],
    [9, "0.09"],
    [10, "0.10"],
    [99, "0.99"],
    [100, "1.00"],
    [101, "1.01"],
    [999, "9.99"],
    [1000, "10.00"],
    [123456, "1234.56"],
  ])("satangToDecimalStringExact(%i) === %s", (satang, expected) => {
    expect(satangToDecimalStringExact(satang)).toBe(expected);
  });
});

describe("buildPromptPayPayload — amount encoding across the satang->decimal boundary, odd/adversarial amounts", () => {
  // Every integer satang value from 1 to 2,000 (0.01 THB to 20.00 THB) --
  // deliberately exhaustive over a real range rather than a hand-picked
  // sample, so no odd value in that band can hide a boundary bug.
  const exhaustiveLowRange = Array.from({ length: 2000 }, (_, i) => i + 1);

  it.each(exhaustiveLowRange)("amountSatang=%i round-trips through the real encoder to the exact ground-truth decimal string", (amountSatang) => {
    const payload = buildPromptPayPayload({ promptpayId: "0812345678", promptpayType: "msisdn", amountSatang });
    const fields = parseTLV(payload);
    expect(fields[TAG_AMOUNT]).toBe(satangToDecimalStringExact(amountSatang));
  });

  // Spot-checks at realistic order-total magnitudes an actual BrewLedger
  // cart would produce -- e.g. 3 lattes at 65.00 THB plus a 5.00 THB
  // oat-milk option delta, or a large catering order -- none of them round
  // numbers, all the way up past the value where floating-point mantissa
  // precision could plausibly start to matter.
  const realisticOddTotals = [
    6501, // a single 65.00 THB item plus a 1-satang rounding fixture
    19500 + 500, // 3x 65.00 + one 5.00 option delta = 200.00 -- included as a round control
    20099, // 200.99 THB
    33333, // 333.33 THB
    45067, // 450.67 THB -- close to the WBS 6.5 1kg/450THB anchor magnitude
    99999, // 999.99 THB
    100001, // 1000.01 THB -- crosses the 4-digit whole-baht boundary
    123457, // 1234.57 THB
    999999, // 9999.99 THB
    1000001, // 10000.01 THB -- crosses the 5-digit whole-baht boundary
    9999999, // 99999.99 THB -- a large catering order
  ];

  it.each(realisticOddTotals)("realistic odd order total amountSatang=%i encodes exactly, no float drift", (amountSatang) => {
    const payload = buildPromptPayPayload({ promptpayId: "0812345678", promptpayType: "msisdn", amountSatang });
    const fields = parseTLV(payload);
    expect(fields[TAG_AMOUNT]).toBe(satangToDecimalStringExact(amountSatang));
  });

  it("tag 54's decimal string never contains a floating-point artifact (no extra digits, no scientific notation, no trailing garbage)", () => {
    for (const amountSatang of [1, 7, 35, 107, 299, 12345, 999999]) {
      const payload = buildPromptPayPayload({ promptpayId: "0812345678", promptpayType: "msisdn", amountSatang });
      const fields = parseTLV(payload);
      expect(fields[TAG_AMOUNT]).toMatch(/^\d+\.\d{2}$/); // exactly digits, one dot, exactly two fractional digits
    }
  });
});
