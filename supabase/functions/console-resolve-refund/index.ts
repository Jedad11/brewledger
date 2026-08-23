// WBS 5.11 — "โอนคืนแล้ว". The merchant has already transferred the refund
// from their own banking app (RL-1 — this system never moves money); this
// endpoint only records that the obligation is resolved. Thin
// auth-and-dispatch shim, same posture as console-confirm-payment/index.ts:
// the real guard is console_resolve_refund (packages/db/migrations/
// 0051_console_cancel_order_refund.sql), which transitions CANCELLED ->
// REFUNDED via transition_order() (WBS 5.7) and then writes
// refund_resolved_by/refund_resolved_at under the same row lock. This file
// never touches orders.status or the refund columns itself.
//
// No CORS/OPTIONS handling: called server-to-server from apps/console's
// resolveRefund server action, which forwards the merchant's own session
// access_token — same reasoning as console-confirm-payment/index.ts's own
// header comment.
import { withConsoleAuth } from "../_shared/console/auth.ts";
import { jsonResponse, errorResponse } from "../_shared/console/response.ts";

interface ResolveRefundRequest {
  orderId: string;
}

function isResolveRefundRequest(body: unknown): body is ResolveRefundRequest {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).orderId === "string"
  );
}

Deno.serve(
  withConsoleAuth(async (req, ctx) => {
    if (req.method !== "POST") return errorResponse(405, "method not allowed");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse(400, "invalid JSON body");
    }
    if (!isResolveRefundRequest(body)) {
      return errorResponse(400, "malformed request body");
    }

    const { data, error } = await ctx.supabase.rpc("console_resolve_refund", {
      p_order_id: body.orderId,
    });

    if (error) {
      console.error("console_resolve_refund RPC error", error);
      return errorResponse(500, "resolve failed");
    }

    if (data.ok === false) {
      if (data.code === "FORBIDDEN") return errorResponse(403);
      if (data.code === "NOT_FOUND") return errorResponse(404, "order not found");
      // 409: e.g. this order never had a refund owed (PENDING_PAYMENT
      // cancel), or a double tap raced another device's own resolve -- a
      // real state conflict, not a server fault.
      if (data.code === "ILLEGAL_TRANSITION") return errorResponse(409, "illegal transition");
      return errorResponse(500, "resolve failed");
    }

    // A second tap or a retried request returns this SAME 200 shape with
    // already:true -- same idempotent-double-tap posture as WBS 5.6/5.9.
    return jsonResponse({ ok: true, already: data.already, order: data.order ?? null });
  }),
);
