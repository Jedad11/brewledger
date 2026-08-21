// WBS 5.6 — "ยังไม่ได้รับเงิน". Expires the order immediately and releases
// its slot; no stock movement (the order was never confirmed, so nothing
// was ever deducted). Same shim posture as console-confirm-payment/index.ts
// — the real logic is console_reject_payment (packages/db/migrations/
// 0031_payment_confirmation.sql). No CORS/OPTIONS handling for the same
// reason: server-to-server only, via apps/console's rejectPayment server
// action.
import { withConsoleAuth } from "../_shared/console/auth.ts";
import { jsonResponse, errorResponse } from "../_shared/console/response.ts";

interface RejectPaymentRequest {
  orderId: string;
}

function isRejectPaymentRequest(body: unknown): body is RejectPaymentRequest {
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
    if (!isRejectPaymentRequest(body)) {
      return errorResponse(400, "malformed request body");
    }

    const { data, error } = await ctx.supabase.rpc("console_reject_payment", {
      p_order_id: body.orderId,
    });

    if (error) {
      console.error("console_reject_payment RPC error", error);
      return errorResponse(500, "rejection failed");
    }

    if (data.ok === false) {
      if (data.code === "FORBIDDEN") return errorResponse(403);
      if (data.code === "NOT_FOUND") return errorResponse(404, "order not found");
      return errorResponse(500, "rejection failed");
    }

    return jsonResponse({ ok: true, already: data.already });
  }),
);
