// WBS 5.10 — two-bucket rate limiting for public-order-status's phone+code
// branch (order_lookup_attempts / record_order_lookup_attempt_if_allowed,
// packages/db/migrations/0036_order_lookup_rate_limit.sql +
// 0039_order_lookup_phone_bucket.sql). Same atomic check-and-record shape,
// against its own table rather than auth_attempts itself — see 0036's
// header comment for why a second table, not a shared bucket, keeps
// OTP-request and order-lookup rate limits from colliding on one IP.
//
// Originally ip_hash-only (redline_reviewer finding, 2026-08-19-style: the
// spoofable-x-forwarded-for problem console-auth-request-otp already
// documents). Reviewer proved live (2026-08-22) that an ip_hash-only bucket
// is a no-op against a scripted caller rotating fake IP octets — every
// request gets a fresh 20/hour budget. Reshaped to mirror
// _shared/auth/rateLimit.ts's (column, hash) pattern: phone_hash is checked
// first as the real, non-rotatable-by-IP-spoofing backstop; ip_hash second
// as a coarse defense-in-depth signal. See 0039's migration comment for the
// full reasoning on why phone_hash (not a phone+code pair) is the right key.
//
// Reuses AUTH_ATTEMPTS_HASH_SALT (the same HMAC key auth's rate limiter
// already reads from Edge Function secrets) rather than introducing a
// second secret to configure: the key's only job is to keep raw phone
// numbers/IPs out of a Postgres table, and HMAC key reuse across independent
// message spaces (auth vs. order-lookup) is standard and safe.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

async function hmacSha256Hex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type OrderLookupRateLimitColumn = "phone_hash" | "ip_hash";

// Same normalisation packages/db/migrations/0037_normalize_order_lookup_phone.sql
// applies inside public_order_lookup, duplicated here (not imported — SQL
// can't be) so the phone_hash bucket key is stable for a given real number
// across however a customer happens to type it. Without this, a caller
// could defeat the phone_hash bucket exactly like the ip_hash bucket: retype
// the SAME number as "0812345678", "081-234-5678", "+66812345678",
// "66812345678", ... and get a fresh bucket each time.
export function normalizePhoneForRateLimit(rawPhone: string): string {
  const trimmed = rawPhone.trim();
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (/^0[0-9]{9}$/.test(digits)) return `+66${digits.slice(1)}`;
  if (/^66[0-9]{9}$/.test(digits)) return `+${digits}`;
  return trimmed;
}

export async function checkAndRecordOrderLookupRateLimit(
  supabase: SupabaseClient,
  column: OrderLookupRateLimitColumn,
  rawValue: string,
  maxPerHour: number,
): Promise<{ allowed: boolean }> {
  const salt = Deno.env.get("AUTH_ATTEMPTS_HASH_SALT");
  if (!salt) {
    throw new Error("Missing required environment variable AUTH_ATTEMPTS_HASH_SALT");
  }
  const hash = await hmacSha256Hex(rawValue, salt);

  const { data, error } = await supabase.rpc("record_order_lookup_attempt_if_allowed", {
    p_column: column,
    p_hash: hash,
    p_max_per_hour: maxPerHour,
  });
  if (error) throw error;

  return { allowed: data === true };
}
