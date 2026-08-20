// PromptPay QR payload builder — the pure payload-generation slice of
// WBS 5.5 (Order QR issuance), built early as a prerequisite for WBS 4.5's
// live verification preview. WBS 5.5 itself (order-level issuance, the
// `/s/{slug}/pay/{code}` screen, CRC conformance suite) is NOT built here.
//
// PromptPay QR is a published EMVCo data format, not a service call.
// Generating one is string encoding plus a checksum — no network call, no
// credentials, no external dependency at runtime. The payee is ALWAYS the
// merchant's own PromptPay alias, so money moves bank-to-bank between the
// customer and the merchant and Brew Ledger is not a party to it (RL-1). If
// anyone ever proposes making the payee anything other than the merchant's
// own alias, that is a regulatory reclassification, not a refactor.
import generatePayload from "promptpay-qr";
import type { PromptPayType } from "./normalize";

export interface BuildPromptPayPayloadInput {
  promptpayId: string;
  promptpayType: PromptPayType;
  amountSatang: number;
}

// promptpay-qr infers the EMVCo merchant-info tag (01 mobile phone vs 02
// national ID / tax ID) purely from the normalised digit length of the
// target it's given — the library has no separate "type" parameter, and
// the EMVCo profile itself doesn't distinguish NID from tax ID (both are
// tag 02, 13 digits). promptpayType is still required and validated here,
// not passed through: it is the caller's evidence that the identifier was
// normalised for the type the merchant actually selected, so a 13-digit
// value can never silently pass through the phone-number branch (or vice
// versa) because of a caller bug upstream.
function assertNormalizedShape(promptpayId: string, promptpayType: PromptPayType): void {
  if (!/^\d+$/.test(promptpayId)) {
    throw new Error(
      `buildPromptPayPayload: promptpayId must already be normalised to digits only, got "${promptpayId}"`,
    );
  }
  if (promptpayType === "msisdn") {
    if (promptpayId.length !== 10 || promptpayId[0] !== "0") {
      throw new Error(
        `buildPromptPayPayload: msisdn promptpayId must be 10 digits starting with 0, got "${promptpayId}"`,
      );
    }
    return;
  }
  if (promptpayId.length !== 13) {
    throw new Error(
      `buildPromptPayPayload: ${promptpayType} promptpayId must be 13 digits, got "${promptpayId}"`,
    );
  }
}

export function buildPromptPayPayload(input: BuildPromptPayPayloadInput): string {
  const { promptpayId, promptpayType, amountSatang } = input;

  if (!promptpayId || promptpayId.trim().length === 0) {
    throw new Error(
      "buildPromptPayPayload: promptpayId is required — there is no house account to fall back to (RL-1)",
    );
  }
  assertNormalizedShape(promptpayId, promptpayType);

  if (!Number.isInteger(amountSatang) || amountSatang <= 0) {
    throw new Error(
      `buildPromptPayPayload: amountSatang must be a positive integer, got ${amountSatang}`,
    );
  }

  // Convert satang to a decimal string at THIS boundary only. Everywhere
  // else in the system money stays an integer number of satang.
  const amountDecimalString = (amountSatang / 100).toFixed(2);

  return generatePayload(promptpayId, { amount: Number(amountDecimalString) });
}
