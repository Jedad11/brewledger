import { createPublicClient, createServiceRoleClient } from "../_shared/public/db.ts";
import { jsonResponse, errorResponse, corsPreflightResponse } from "../_shared/public/response.ts";
import { extractClientIp } from "../_shared/clientIp.ts";
import { checkAndRecordOrderLookupRateLimit, normalizePhoneForRateLimit } from "../_shared/public/rateLimit.ts";
import { toPublicOrderStatus } from "../../../packages/shared/src/serializers/public.ts";
import { publicOrderStatusSchema, parseOrThrow } from "../../../packages/shared/src/serializers/public.schema.ts";

// Only the phone+code branch (public_order_lookup, `/track`'s "find my
// order on another device" flow) is rate-limited here, not the code-only
// branch (public_order_status). `/o/{code}` polls the code-only branch
// every 5s while visible (WBS 5.10) — for every customer watching their own
// order, which can mean many customers behind the same shop wifi/NAT
// legitimately sharing one IP. Rate-limiting that path per IP would break
// live tracking for exactly the multi-customer-same-network case this
// product runs in. The phone+code branch has no such legitimate
// high-frequency caller — a person searches `/track` a handful of times at
// most — so it can be capped without touching real usage. 20/hour matches
// WBS 4.1's own OTP ip_hash cap, for the same "generous for a real person,
// meaningfully bounding for a script" reasoning.
//
// TWO buckets, phone_hash checked first (redline_reviewer finding,
// 2026-08-22, closed by packages/db/migrations/0039_order_lookup_phone_bucket.sql —
// see that migration's comment for the full reasoning). ip_hash alone was a
// no-op against any scripted caller rotating x-forwarded-for, proven live: a
// fresh fake octet bought a fresh 20/hour budget every time. phone_hash
// bounds the attack that actually matters here — enumerating order_codes
// against a real, targeted phone number — regardless of how many codes are
// tried or how many IPs (real or spoofed) send the requests. ip_hash stays
// as a second, known-spoofable, defense-in-depth signal against
// unsophisticated scripts, same posture console-auth-request-otp documents
// for its own ip_hash bucket.
const LOOKUP_MAX_PER_HOUR = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") return errorResponse(405, "method not allowed");

  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const phone = params.get("phone");
  if (!code) return errorResponse(400, "code is required");

  if (phone) {
    const serviceClient = createServiceRoleClient();
    const normalizedPhone = normalizePhoneForRateLimit(phone);
    const ip = extractClientIp(req.headers);
    try {
      // Phone bucket first, same order as console-auth-request-otp: it's
      // the real backstop, so an over-limit phone shouldn't also burn an
      // ip_hash check whose result would just be discarded.
      const phoneCheck = await checkAndRecordOrderLookupRateLimit(
        serviceClient,
        "phone_hash",
        normalizedPhone,
        LOOKUP_MAX_PER_HOUR,
      );
      if (!phoneCheck.allowed) return errorResponse(429, "too many attempts, try again later");

      const ipCheck = await checkAndRecordOrderLookupRateLimit(
        serviceClient,
        "ip_hash",
        ip,
        LOOKUP_MAX_PER_HOUR,
      );
      if (!ipCheck.allowed) return errorResponse(429, "too many attempts, try again later");
    } catch {
      return errorResponse(500, "lookup failed");
    }
  }

  const supabase = createPublicClient();

  const { data, error } = phone
    ? await supabase.rpc("public_order_lookup", { p_phone: phone, p_order_code: code })
    : await supabase.rpc("public_order_status", { p_order_code: code });

  if (error) return errorResponse(500, "lookup failed");

  const dtos = (data ?? []).map((row: unknown) =>
    parseOrThrow(publicOrderStatusSchema, toPublicOrderStatus(row as Parameters<typeof toPublicOrderStatus>[0]))
  );
  return jsonResponse(dtos);
});
