// WBS 4.5 — unit coverage for buildPromptPayPayload() (generate.ts), the
// live-preview generator the payments settings screen depends on.
//
// Full EMVCo/CRC conformance and golden-file coverage is WBS 5.5's suite,
// deliberately NOT built here (see generate.ts's own header comment: this
// is "the pure payload-generation slice ... built early as a prerequisite
// for WBS 4.5's live verification preview"). What IS in scope for 4.5: the
// guard clauses this entry's acceptance criteria depend on, the satang ->
// decimal boundary conversion, and -- because this generator is the RL-1
// primary enforcement point end to end -- a basic decode-and-check-payee
// test proving the payload never embeds anything other than the exact
// identifier passed in.
import { describe, expect, it } from "vitest";
import { buildPromptPayPayload } from "./generate";

// --- minimal EMVCo TLV parser, for THIS test file only -------------------
// Tag(2) + Length(2, decimal) + Value(Length bytes), repeated. Written
// directly against the public EMVCo QR spec structure the payload builder
// itself implements (see generate.ts's header comment and the promptpay-qr
// source), not by importing any parsing helper from generate.ts -- there
// isn't one; the production code only ever needs to encode; decoding here
// exists solely so this suite can prove the payee shape independently of
// trusting the encoder's own self-report.
function parseTLV(payload: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < payload.length) {
    const tag = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isInteger(len) || len < 0) {
      throw new Error(`malformed TLV at offset ${i} in payload: ${payload}`);
    }
    const value = payload.slice(i + 4, i + 4 + len);
    fields[tag] = value;
    i += 4 + len;
  }
  return fields;
}

const TAG_MERCHANT_INFO_BOT = "29";
const TAG_TRANSACTION_AMOUNT = "54";
const TAG_MOBILE = "01";
const TAG_TAXID_OR_NID = "02";

// The EMVCo mobile-number encoding this generator (via promptpay-qr) uses:
// country code 66 replacing the leading 0, left-padded with zeros to 13
// digits total. Re-derived here from the public EMVCo PromptPay profile,
// independently of promptpay-qr's own internal formatTarget().
function expectedMobileTarget(normalizedMsisdn: string): string {
  const withCountryCode = normalizedMsisdn.replace(/^0/, "66");
  return withCountryCode.padStart(13, "0");
}

function decodePayee(payload: string): { tag: "01" | "02"; target: string } {
  const top = parseTLV(payload);
  const merchantInfo = parseTLV(top[TAG_MERCHANT_INFO_BOT]);
  if (merchantInfo[TAG_MOBILE] !== undefined) {
    return { tag: "01", target: merchantInfo[TAG_MOBILE] };
  }
  if (merchantInfo[TAG_TAXID_OR_NID] !== undefined) {
    return { tag: "02", target: merchantInfo[TAG_TAXID_OR_NID] };
  }
  throw new Error(`no recognised payee tag found in merchant info template: ${JSON.stringify(merchantInfo)}`);
}

describe("buildPromptPayPayload — guard clauses", () => {
  it("throws when amountSatang is zero", () => {
    expect(() =>
      buildPromptPayPayload({ promptpayId: "0812345678", promptpayType: "msisdn", amountSatang: 0 }),
    ).toThrow();
  });

  it("throws when amountSatang is negative", () => {
    expect(() =>
      buildPromptPayPayload({ promptpayId: "0812345678", promptpayType: "msisdn", amountSatang: -100 }),
    ).toThrow();
  });

  it("throws when amountSatang is not an integer", () => {
    expect(() =>
      buildPromptPayPayload({ promptpayId: "0812345678", promptpayType: "msisdn", amountSatang: 100.5 }),
    ).toThrow();
  });

  it("throws when amountSatang is NaN", () => {
    expect(() =>
      buildPromptPayPayload({ promptpayId: "0812345678", promptpayType: "msisdn", amountSatang: NaN }),
    ).toThrow();
  });

  it("throws when promptpayId is an empty string", () => {
    expect(() =>
      buildPromptPayPayload({ promptpayId: "", promptpayType: "msisdn", amountSatang: 100 }),
    ).toThrow();
  });

  it("throws when promptpayId is whitespace only", () => {
    expect(() =>
      buildPromptPayPayload({ promptpayId: "   ", promptpayType: "msisdn", amountSatang: 100 }),
    ).toThrow();
  });

  it("throws when promptpayId still contains separators (caller forgot to normalise)", () => {
    expect(() =>
      buildPromptPayPayload({ promptpayId: "081-234-5678", promptpayType: "msisdn", amountSatang: 100 }),
    ).toThrow();
  });

  it("throws when a 13-digit id is passed as msisdn (shape/type mismatch)", () => {
    expect(() =>
      buildPromptPayPayload({ promptpayId: "1234567890123", promptpayType: "msisdn", amountSatang: 100 }),
    ).toThrow();
  });

  it("throws when a 10-digit id is passed as nid (shape/type mismatch)", () => {
    expect(() =>
      buildPromptPayPayload({ promptpayId: "0812345678", promptpayType: "nid", amountSatang: 100 }),
    ).toThrow();
  });
});

describe("buildPromptPayPayload — satang to decimal conversion (the one legitimate boundary)", () => {
  it.each([
    [100, "1.00"],
    [1, "0.01"],
    [12345, "123.45"],
    [450000, "4500.00"],
    [99, "0.99"],
  ])("amountSatang %i encodes as transaction amount %s in the payload", (amountSatang, expectedDecimal) => {
    const payload = buildPromptPayPayload({
      promptpayId: "0812345678",
      promptpayType: "msisdn",
      amountSatang,
    });
    const fields = parseTLV(payload);
    expect(fields[TAG_TRANSACTION_AMOUNT]).toBe(expectedDecimal);
  });
});

describe("buildPromptPayPayload — forbidden-payee shape check (RL-1)", () => {
  it("a msisdn payload's decoded payee target is derived exactly from the given identifier, no other value", () => {
    const promptpayId = "0812345678";
    const payload = buildPromptPayPayload({ promptpayId, promptpayType: "msisdn", amountSatang: 100 });

    const payee = decodePayee(payload);

    expect(payee.tag).toBe("01");
    expect(payee.target).toBe(expectedMobileTarget(promptpayId));
  });

  it("changing the msisdn changes the decoded payee target correspondingly -- proves the target is not a fixed value", () => {
    const idA = "0812345678";
    const idB = "0899999999";

    const payeeA = decodePayee(buildPromptPayPayload({ promptpayId: idA, promptpayType: "msisdn", amountSatang: 100 }));
    const payeeB = decodePayee(buildPromptPayPayload({ promptpayId: idB, promptpayType: "msisdn", amountSatang: 100 }));

    expect(payeeA.target).toBe(expectedMobileTarget(idA));
    expect(payeeB.target).toBe(expectedMobileTarget(idB));
    expect(payeeA.target).not.toBe(payeeB.target);
  });

  it("a nid payload's decoded payee target is exactly the 13-digit id, unmodified", () => {
    const promptpayId = "1101700230708";
    const payload = buildPromptPayPayload({ promptpayId, promptpayType: "nid", amountSatang: 100 });

    const payee = decodePayee(payload);

    expect(payee.tag).toBe("02");
    expect(payee.target).toBe(promptpayId);
  });

  it("a taxid payload's decoded payee target is exactly the 13-digit id, unmodified", () => {
    const promptpayId = "9876543210123";
    const payload = buildPromptPayPayload({ promptpayId, promptpayType: "taxid", amountSatang: 100 });

    const payee = decodePayee(payload);

    expect(payee.tag).toBe("02");
    expect(payee.target).toBe(promptpayId);
  });

  it("two different 13-digit ids produce two different decoded payee targets -- no fixed/house payee is baked in", () => {
    const idA = "1101700230708";
    const idB = "9876543210123";

    const payeeA = decodePayee(buildPromptPayPayload({ promptpayId: idA, promptpayType: "nid", amountSatang: 100 }));
    const payeeB = decodePayee(buildPromptPayPayload({ promptpayId: idB, promptpayType: "taxid", amountSatang: 100 }));

    expect(payeeA.target).toBe(idA);
    expect(payeeB.target).toBe(idB);
    expect(payeeA.target).not.toBe(payeeB.target);
  });

  it("varying only the amount leaves the decoded payee target unchanged -- amount and payee are independent fields", () => {
    const promptpayId = "0812345678";
    const payeeAt100 = decodePayee(buildPromptPayPayload({ promptpayId, promptpayType: "msisdn", amountSatang: 100 }));
    const payeeAt450000 = decodePayee(
      buildPromptPayPayload({ promptpayId, promptpayType: "msisdn", amountSatang: 450000 }),
    );

    expect(payeeAt100.target).toBe(payeeAt450000.target);
    expect(payeeAt100.target).toBe(expectedMobileTarget(promptpayId));
  });
});
