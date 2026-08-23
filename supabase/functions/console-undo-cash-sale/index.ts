// WBS 5.12 — "ยกเลิก" on a recent cash sale, active for 2 minutes. Thin
// auth-and-dispatch shim, same posture as console-confirm-payment: the real
// window/channel/status guard, the transition_order (WBS 5.7) call, and the
// RL-1 refund_status override all live inside console_undo_cash_sale
// (packages/db/migrations/0050_console_cash_sale.sql). This file never
// trusts a client-supplied "still in window" flag — the server re-checks
// created_at itself.
//
// No CORS/OPTIONS handling: called server-to-server from apps/console's
// undoCashSale server action, same reasoning as console-confirm-payment/
// index.ts's own header comment.
import { withConsoleAuth } from "../_shared/console/auth.ts";
import { jsonResponse, errorResponse } from "../_shared/console/response.ts";

interface UndoCashSaleRequest {
  orderId: string;
}

function isUndoCashSaleRequest(body: unknown): body is UndoCashSaleRequest {
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
    if (!isUndoCashSaleRequest(body)) {
      return errorResponse(400, "malformed request body");
    }

    const { data, error } = await ctx.supabase.rpc("console_undo_cash_sale", {
      p_order_id: body.orderId,
      p_merchant_id: ctx.merchantId,
    });

    if (error) {
      console.error("console_undo_cash_sale RPC error", error);
      return errorResponse(500, "undo failed");
    }

    if (data.ok === false) {
      if (data.code === "FORBIDDEN") return errorResponse(403);
      if (data.code === "NOT_FOUND") return errorResponse(404, "order not found");
      // 409, not 500: a real, expected state conflict (window passed,
      // already transitioned, or not a cash sale) -- the console client
      // directs the merchant to the order detail screen for this, same
      // "direct the merchant to cancel properly" wording the WBS 5.12
      // prompt itself uses.
      if (data.code === "UNDO_NOT_AVAILABLE") return jsonResponse({ code: "UNDO_NOT_AVAILABLE" }, 409);
      return errorResponse(500, "undo failed");
    }

    return jsonResponse({ ok: true, order: data.order });
  }),
);
