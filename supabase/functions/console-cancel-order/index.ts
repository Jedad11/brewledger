// WBS 5.11 — "ยกเลิกออเดอร์" with mandatory reason capture. Thin
// auth-and-dispatch shim, same posture as console-advance-order/index.ts:
// the real guard is console_cancel_order (packages/db/migrations/
// 0051_console_cancel_order_refund.sql), which nests transition_order()
// (WBS 5.7) as one plpgsql transaction and writes cancel_reason under the
// same row lock. This file never touches orders.status or orders.cancel_reason
// itself.
//
// No CORS/OPTIONS handling: called server-to-server from apps/console's
// cancelOrder server action, which forwards the merchant's own session
// access_token — same reasoning as console-advance-order/index.ts's own
// header comment.
import { withConsoleAuth } from "../_shared/console/auth.ts";
import { jsonResponse, errorResponse } from "../_shared/console/response.ts";

type CancelReason =
  | "out_of_stock"
  | "equipment_failure"
  | "customer_request"
  | "unexpected_closure"
  | "other";

const VALID_REASONS: readonly CancelReason[] = [
  "out_of_stock",
  "equipment_failure",
  "customer_request",
  "unexpected_closure",
  "other",
];

interface CancelOrderRequest {
  orderId: string;
  reason: CancelReason;
}

function isCancelOrderRequest(body: unknown): body is CancelOrderRequest {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.orderId === "string" &&
    typeof b.reason === "string" &&
    (VALID_REASONS as string[]).includes(b.reason)
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
    if (!isCancelOrderRequest(body)) {
      return errorResponse(400, "malformed request body");
    }

    const { data, error } = await ctx.supabase.rpc("console_cancel_order", {
      p_order_id: body.orderId,
      p_reason: body.reason,
    });

    if (error) {
      // Never leak error.message -- same posture as every other console-*
      // RPC error handler in this codebase.
      console.error("console_cancel_order RPC error", error);
      return errorResponse(500, "cancel failed");
    }

    if (data.ok === false) {
      if (data.code === "FORBIDDEN") return errorResponse(403);
      if (data.code === "NOT_FOUND") return errorResponse(404, "order not found");
      if (data.code === "VALIDATION_ERROR") return errorResponse(400, "invalid cancel reason");
      // 409: a real state conflict, not a server fault -- another tab/device
      // already moved this order past the point cancellation is legal.
      if (data.code === "ILLEGAL_TRANSITION") return errorResponse(409, "illegal transition");
      return errorResponse(500, "cancel failed");
    }

    // A second tap or a retried request returns this SAME 200 shape with
    // already:true -- same idempotent-double-tap posture as console-advance-order.
    return jsonResponse({ ok: true, already: data.already, order: data.order ?? null });
  }),
);
