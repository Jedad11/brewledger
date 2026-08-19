// WBS 4.1 — Thai phone number normalisation for the login flow.
//
// Kept local to apps/console (not packages/shared) on purpose: this module
// is auth-adjacent, and packages/shared is imported by apps/shop too. RL-3 /
// F01 requires zero auth-related code reachable from Customer Web, even an
// unused export — see scripts/check-shop-has-no-auth.mjs.
//
// Accepts the three shapes a merchant naturally types: 0812345678,
// 081-234-5678, +66812345678 (with or without spaces/dashes) — and produces
// E.164 (+66xxxxxxxxx) for Supabase Auth / the OTP request function. Thai
// mobile numbers are 10 digits starting with 0 in local format, i.e. 9
// significant digits after the leading 0 or after +66.
export function normalizeThaiPhone(raw: string): string | null {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");

  let significant: string | null = null;

  if (hasPlus && digits.startsWith("66") && digits.length === 11) {
    significant = digits.slice(2);
  } else if (!hasPlus && digits.startsWith("66") && digits.length === 11) {
    significant = digits.slice(2);
  } else if (digits.startsWith("0") && digits.length === 10) {
    significant = digits.slice(1);
  }

  if (!significant || significant.length !== 9 || !/^[689]\d{8}$/.test(significant)) {
    return null;
  }

  return `+66${significant}`;
}

// +66812345678 -> "081-234-5678", purely for showing the number back to the
// merchant for confirmation before the OTP is sent (WBS 4.1 §5).
export function formatThaiPhoneForDisplay(e164: string): string {
  const digits = e164.replace("+66", "0");
  if (digits.length !== 10) return e164;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
