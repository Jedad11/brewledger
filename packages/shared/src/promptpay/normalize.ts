// WBS 4.5 — client- and server-side normalisation/validation for the three
// PromptPay identifier types the merchant can enter at
// /console/settings/payments. Plain exported functions, no React, no
// component state, so both the settings form and qa_engineer's unit tests
// can call them directly.
//
// RL-1: a typo here is not cosmetic. Every order's QR is built from
// whatever `stores.promptpay_id` holds, so an identifier that passes
// validation but names someone else's PromptPay account sends every
// customer's money to a stranger. When in doubt, reject rather than guess.

export type PromptPayType = "msisdn" | "nid" | "taxid";

export interface NormalizeResult {
  ok: boolean;
  value: string | null;
  error: string | null;
}

function ok(value: string): NormalizeResult {
  return { ok: true, value, error: null };
}

function fail(error: string): NormalizeResult {
  return { ok: false, value: null, error };
}

function stripSeparators(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

// Thai mobile number: 10 digits, starts with 0. Normalised form has no
// separators, e.g. "081-234-5678" / "081 234 5678" -> "0812345678".
export function normalizeMsisdn(raw: string): NormalizeResult {
  const digits = stripSeparators(raw);
  if (!/^0\d{9}$/.test(digits)) {
    return fail("กรอกเบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0");
  }
  return ok(digits);
}

// Thai national ID: 13 digits, 13th digit is a mod-11 check digit over the
// first 12. Standard weighting: digit[i] * (13 - i) for i = 0..11
// (0-indexed), summed, checkDigit = (11 - sum % 11) % 10.
export function computeThaiNidCheckDigit(first12Digits: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(first12Digits[i]) * (13 - i);
  }
  return (11 - (sum % 11)) % 10;
}

export function normalizeNid(raw: string): NormalizeResult {
  const digits = stripSeparators(raw);
  if (!/^\d{13}$/.test(digits)) {
    return fail("กรอกเลขบัตรประชาชน 13 หลัก");
  }
  const expected = computeThaiNidCheckDigit(digits.slice(0, 12));
  const actual = Number(digits[12]);
  if (expected !== actual) {
    return fail("เลขบัตรประชาชนไม่ถูกต้อง ตรวจสอบเลขอีกครั้ง");
  }
  return ok(digits);
}

// Tax ID: 13 digits. No publicly documented check-digit scheme is applied
// here on purpose — unlike the citizen ID, Revenue Department tax ID check
// digits are not a stable, independently verifiable public algorithm, so
// validating only shape avoids rejecting a real, correctly-entered ID on a
// guess. The QR-preview verification step (merchant scans and sees their
// own name) is the actual safety net for this type, same as the others.
export function normalizeTaxid(raw: string): NormalizeResult {
  const digits = stripSeparators(raw);
  if (!/^\d{13}$/.test(digits)) {
    return fail("กรอกเลขผู้เสียภาษี 13 หลัก");
  }
  return ok(digits);
}

export function normalizePromptPayId(type: PromptPayType, raw: string): NormalizeResult {
  switch (type) {
    case "msisdn":
      return normalizeMsisdn(raw);
    case "nid":
      return normalizeNid(raw);
    case "taxid":
      return normalizeTaxid(raw);
  }
}
