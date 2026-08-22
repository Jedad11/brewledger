// WBS 5.10 — per-IP rate limiting for public-order-status, blunting
// scripted brute-force enumeration of order codes. Same atomic
// check-and-record shape as _shared/auth/rateLimit.ts (WBS 4.1), against
// its own table (order_lookup_attempts /
// record_order_lookup_attempt_if_allowed,
// packages/db/migrations/0036_order_lookup_rate_limit.sql) rather than
// auth_attempts itself — see that migration's header comment for why a
// second table, not a shared bucket, keeps OTP-request and order-lookup
// rate limits from colliding on one IP.
//
// Reuses AUTH_ATTEMPTS_HASH_SALT (the same HMAC key auth's rate limiter
// already reads from Edge Function secrets) rather than introducing a
// second secret to configure: the key's only job is to keep raw IPs out of
// a Postgres table, and HMAC key reuse across independent message spaces
// (auth IPs/phones vs. order-lookup IPs) is standard and safe.
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

export async function checkAndRecordOrderLookupRateLimit(
  supabase: SupabaseClient,
  ip: string,
  maxPerHour: number,
): Promise<{ allowed: boolean }> {
  const salt = Deno.env.get("AUTH_ATTEMPTS_HASH_SALT");
  if (!salt) {
    throw new Error("Missing required environment variable AUTH_ATTEMPTS_HASH_SALT");
  }
  const ipHash = await hmacSha256Hex(ip, salt);

  const { data, error } = await supabase.rpc("record_order_lookup_attempt_if_allowed", {
    p_ip_hash: ipHash,
    p_max_per_hour: maxPerHour,
  });
  if (error) throw error;

  return { allowed: data === true };
}
