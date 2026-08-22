import { createPublicClient, createServiceRoleClient } from "../_shared/public/db.ts";
import { jsonResponse, errorResponse, corsPreflightResponse } from "../_shared/public/response.ts";
import { extractClientIp } from "../_shared/clientIp.ts";
import { checkAndRecordOrderLookupRateLimit } from "../_shared/public/rateLimit.ts";
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
const LOOKUP_MAX_PER_HOUR = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") return errorResponse(405, "method not allowed");

  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const phone = params.get("phone");
  if (!code) return errorResponse(400, "code is required");

  if (phone) {
    const ip = extractClientIp(req.headers);
    try {
      const { allowed } = await checkAndRecordOrderLookupRateLimit(
        createServiceRoleClient(),
        ip,
        LOOKUP_MAX_PER_HOUR,
      );
      if (!allowed) return errorResponse(429, "too many attempts, try again later");
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
