// WBS 4.1 — two-point OTP rate limiting (phone_hash 5/hour, ip_hash
// 20/hour), both enforced in console-auth-request-otp — the only place in
// the request path that sees both the phone number and the caller's real
// IP before delivery is handed off to Supabase Auth's own (Vonage-backed)
// phone provider. Phone numbers and IPs are hashed with HMAC-SHA256 keyed by
// AUTH_ATTEMPTS_HASH_SALT before ever reaching auth_attempts — a Thai
// mobile number's variable part is 9 digits, small enough that a bare
// SHA-256 digest is brute-forceable offline in well under a second, and an
// HMAC with a server-only secret closes that off.
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

export async function hashForRateLimit(value: string): Promise<string> {
  const salt = Deno.env.get("AUTH_ATTEMPTS_HASH_SALT");
  if (!salt) {
    throw new Error("Missing required environment variable AUTH_ATTEMPTS_HASH_SALT");
  }
  return hmacSha256Hex(value, salt);
}

export type RateLimitColumn = "phone_hash" | "ip_hash";

/**
 * Counts rows for this hash in the trailing hour, and — only if still under
 * the limit — records this attempt. The count-check and the insert happen
 * inside a single Postgres function call (record_auth_attempt_if_allowed,
 * packages/db/migrations/0025_auth_attempts_atomic_check.sql), serialised by
 * a transaction-scoped advisory lock keyed on (column, hash) — not two
 * separate PostgREST round trips, which would let concurrent requests for
 * the same phone/IP all read the same under-the-limit count before any
 * insert lands (TOCTOU; redline_reviewer finding, 2026-08-19). A request
 * that gets rejected is not itself counted against the caller's next
 * attempt — the insert only happens on the allowed branch, inside the same
 * locked statement.
 */
export async function checkAndRecordRateLimit(
  supabase: SupabaseClient,
  column: RateLimitColumn,
  rawValue: string,
  maxPerHour: number,
): Promise<{ allowed: boolean }> {
  const hash = await hashForRateLimit(rawValue);

  const { data, error } = await supabase.rpc("record_auth_attempt_if_allowed", {
    p_column: column,
    p_hash: hash,
    p_max_per_hour: maxPerHour,
  });
  if (error) throw error;

  return { allowed: data === true };
}
