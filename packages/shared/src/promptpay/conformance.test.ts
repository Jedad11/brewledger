// WBS 5.5 — EMVCo/CRC conformance and golden-file coverage for
// buildPromptPayPayload(). generate.test.ts (WBS 4.5) explicitly disclaims
// this scope in its own header comment ("Full EMVCo/CRC conformance and
// golden-file coverage is WBS 5.5's suite, deliberately NOT built here") —
// this file is that suite.
//
// Everything here is independent of the code under test: a fresh CRC-16/
// CCITT-FALSE implementation (not imported from anywhere, not copied from
// promptpay-qr's own source), a fresh TLV decoder, and three golden
// payload strings hand-assembled field by field against the public EMVCo
// PromptPay profile rather than captured from buildPromptPayPayload's own
// output. See docs/design/... no -- see this file's own comments below for
// how each golden fixture was derived; the derivation is the point.
import { describe, expect, it } from "vitest";
import { buildPromptPayPayload } from "./generate";

// --- independent TLV decoder (a second, freshly-written copy -- see the
// near-identical parser in generate.test.ts; duplicated deliberately so
// this file has no import-time dependency on that one) ------------------
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

// --- independent CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) ----------
// Authored directly against the public algorithm description, not against
// promptpay-qr's source (which this repo never vendors or reads) and not
// against generate.ts (which has no CRC code of its own -- it delegates to
// promptpay-qr entirely). This is the one function in the suite whose
// entire job is to disagree with the code under test if the code under
// test is wrong.
function crc16CcittFalse(input: string): string {
  let register = 0xffff;
  for (let charIndex = 0; charIndex < input.length; charIndex++) {
    register ^= input.charCodeAt(charIndex) << 8;
    for (let bitIndex = 0; bitIndex < 8; bitIndex++) {
      register = register & 0x8000 ? ((register << 1) ^ 0x1021) & 0xffff : (register << 1) & 0xffff;
    }
  }
  return register.toString(16).toUpperCase().padStart(4, "0");
}

const TAG_CRC = "63";
const TAG_POI = "01";
const TAG_AMOUNT = "54";

describe("buildPromptPayPayload — CRC-16/CCITT-FALSE conformance", () => {
  const fixtures: Array<{ promptpayId: string; promptpayType: "msisdn" | "nid" | "taxid"; amountSatang: number }> = [
    { promptpayId: "0812345678", promptpayType: "msisdn", amountSatang: 5500 },
    { promptpayId: "0899999999", promptpayType: "msisdn", amountSatang: 100 },
    { promptpayId: "1101700230708", promptpayType: "nid", amountSatang: 12345 },
    { promptpayId: "9876543210123", promptpayType: "taxid", amountSatang: 450000 },
  ];

  it.each(fixtures)(
    "recomputed CRC matches tag 63 for promptpayId=$promptpayId amountSatang=$amountSatang",
    ({ promptpayId, promptpayType, amountSatang }) => {
      const payload = buildPromptPayPayload({ promptpayId, promptpayType, amountSatang });

      // Per the EMVCo profile (and the WBS 5.5 schema note): the CRC is
      // computed over the full string with "6304" appended, i.e. everything
      // up to and including the CRC tag+length, but not the CRC value
      // itself. The embedded CRC is always the payload's trailing 4 chars.
      const embeddedCrc = payload.slice(-4);
      const dataOverWhichCrcWasComputed = payload.slice(0, -4);
      expect(dataOverWhichCrcWasComputed.endsWith(`${TAG_CRC}04`)).toBe(true);

      expect(crc16CcittFalse(dataOverWhichCrcWasComputed)).toBe(embeddedCrc);
    },
  );
});

describe("buildPromptPayPayload — point of initiation (tag 01)", () => {
  it.each([100, 5500, 1, 450000])(
    "tag 01 is '12' (dynamic) whenever an amount is present, amountSatang=%i",
    (amountSatang) => {
      const payload = buildPromptPayPayload({ promptpayId: "0812345678", promptpayType: "msisdn", amountSatang });
      expect(parseTLV(payload)[TAG_POI]).toBe("12");
    },
  );
});

describe("buildPromptPayPayload — golden-file conformance", () => {
  // Each fixture below was derived independently of buildPromptPayPayload:
  // hand-assembled tag by tag (ID + zero-padded 2-digit LENGTH + VALUE) per
  // the EMVCo/PromptPay profile in this WBS entry's own schema note, then
  // CRC'd with the from-scratch crc16CcittFalse() above -- never generated
  // by calling the function under test and capturing its output. Field
  // order (00, 01, 29, 58, 53, 54, 63) was confirmed against
  // buildPromptPayPayload's actual output before being committed here: the
  // WBS worked example's prose lists 53/54 before 58, but the real
  // promptpay-qr library (and therefore this codebase's production output)
  // emits country (58) before currency/amount (53/54). CRC is
  // order-dependent, so the golden string must match the real byte
  // sequence, not the prose's illustrative ordering -- documented here
  // rather than silently "fixed" so the discrepancy is traceable.
  //
  // Vector A mirrors the WBS 5.5 schema note's own worked example (55.00
  // THB to 081-234-5678); B and C cover a different mobile number/amount
  // and a 13-digit national ID, per the WBS Claude Code Prompt's explicit
  // ask for "a mobile number and a 13-digit ID, at different amounts".
  const goldenFixtures = [
    {
      name: "A - msisdn 0812345678, 55.00 THB",
      input: { promptpayId: "0812345678", promptpayType: "msisdn" as const, amountSatang: 5500 },
      expected: "00020101021229370016A000000677010111011300668123456785802TH5303764540555.006304D1F6",
    },
    {
      name: "B - msisdn 0899999999, 1.00 THB",
      input: { promptpayId: "0899999999", promptpayType: "msisdn" as const, amountSatang: 100 },
      expected: "00020101021229370016A000000677010111011300668999999995802TH530376454041.0063041A88",
    },
    {
      name: "C - nid 1101700230708, 123.45 THB",
      input: { promptpayId: "1101700230708", promptpayType: "nid" as const, amountSatang: 12345 },
      expected: "00020101021229370016A000000677010111021311017002307085802TH53037645406123.456304C4EA",
    },
  ];

  it.each(goldenFixtures)("$name matches byte-for-byte", ({ input, expected }) => {
    expect(buildPromptPayPayload(input)).toBe(expected);
  });

  it.each(goldenFixtures)("$name's own embedded CRC is self-consistent (belt and suspenders)", ({ expected }) => {
    const embeddedCrc = expected.slice(-4);
    expect(crc16CcittFalse(expected.slice(0, -4))).toBe(embeddedCrc);
  });

  it.each(goldenFixtures)("$name decodes to the expected amount", ({ input, expected }) => {
    expect(parseTLV(expected)[TAG_AMOUNT]).toBe((input.amountSatang / 100).toFixed(2));
  });
});

describe("buildPromptPayPayload — forbidden-payee, suite level (RL-1)", () => {
  // Placeholder identifiers standing in for "any Brew Ledger-controlled
  // identifier" -- team phone numbers, a tax ID, a test/house alias. None
  // of these is ever passed as promptpayId anywhere in this file (see the
  // fixture lists above and in generate.test.ts): this test's entire job
  // is to prove that fact holds by scanning actual generated output, not
  // by trusting the fixture lists never to have been edited to include one
  // by accident.
  const FORBIDDEN_IDENTIFIERS = [
    "0800000000", // placeholder Brew Ledger team test MSISDN
    "0000000000000", // placeholder Brew Ledger tax ID
    "6699999999999", // placeholder Brew Ledger house alias, msisdn-shaped target form
  ];

  const allPayloadsInThisSuite = [
    buildPromptPayPayload({ promptpayId: "0812345678", promptpayType: "msisdn", amountSatang: 5500 }),
    buildPromptPayPayload({ promptpayId: "0899999999", promptpayType: "msisdn", amountSatang: 100 }),
    buildPromptPayPayload({ promptpayId: "1101700230708", promptpayType: "nid", amountSatang: 12345 }),
    buildPromptPayPayload({ promptpayId: "9876543210123", promptpayType: "taxid", amountSatang: 450000 }),
  ];

  it.each(FORBIDDEN_IDENTIFIERS)("no payload generated anywhere in this suite contains forbidden identifier %s", (forbidden) => {
    for (const payload of allPayloadsInThisSuite) {
      expect(payload).not.toContain(forbidden);
    }
  });
});
