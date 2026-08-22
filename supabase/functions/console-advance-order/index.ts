// WBS 5.9 — "เริ่มทำ" / "พร้อมรับ" / "รับแล้ว". Thin auth-and-dispatch shim,
// same posture as console-confirm-payment/console-reject-payment: the real
// guard is console_advance_order (packages/db/migrations/
// 0040_console_advance_order.sql), which nests transition_order() (WBS 5.7)
// as one plpgsql transaction. This file never touches orders.status itself.
//
// No CORS/OPTIONS handling: called server-to-server from apps/console's
// advanceOrder server action, which forwards the merchant's own session
// access_token — same reasoning as console-confirm-payment/index.ts's own
// header comment (the console session lives in an httpOnly cookie the
// browser cannot read to build an Authorization header itself).
import { withConsoleAuth } from "../_shared/console/auth.ts";
import { jsonResponse, errorResponse } from "../_shared/console/response.ts";

type AdvanceTarget = "PREPARING" | "READY" | "COLLECTED";
const VALID_TARGETS: readonly AdvanceTarget[] = ["PREPARING", "READY", "COLLECTED"];

interface AdvanceOrderRequest {
  orderId: string;
  to: AdvanceTarget;
}

function isAdvanceOrderRequest(body: unknown): body is AdvanceOrderRequest {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.orderId === "string" && typeof b.to === "string" && (VALID_TARGETS as string[]).includes(b.to);
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
    if (!isAdvanceOrderRequest(body)) {
      return errorResponse(400, "malformed request body");
    }

    const { data, error } = await ctx.supabase.rpc("console_advance_order", {
      p_order_id: body.orderId,
      p_to: body.to,
    });

    if (error) {
      // Never leak error.message -- same posture as every other console-*
      // RPC error handler in this codebase.
      console.error("console_advance_order RPC error", error);
      return errorResponse(500, "advance failed");
    }

    if (data.ok === false) {
      if (data.code === "FORBIDDEN") return errorResponse(403);
      if (data.code === "NOT_FOUND") return errorResponse(404, "order not found");
      // 409: a real state conflict, not a server fault -- another tab/device
      // already moved this order, or the target skips a required hop. The
      // console client shows a specific "this order already changed"
      // message rather than the generic failure copy for this one code.
      if (data.code === "ILLEGAL_TRANSITION") return errorResponse(409, "illegal transition");
      if (data.code === "INVALID_TARGET") return errorResponse(400, "invalid target status");
      return errorResponse(500, "advance failed");
    }

    // A second tap or a retried request returns this SAME 200 shape with
    // already:true -- same idempotent-double-tap posture as WBS 5.6.
    return jsonResponse({ ok: true, already: data.already, order: data.order ?? null });
  }),
);
