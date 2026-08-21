// WBS 5.6 — "ได้รับเงินแล้ว". There is no gateway webhook to replace: the
// merchant confirms after checking their own banking app. Every atomicity /
// idempotency / RL-2 stock-deduction concern lives in the
// console_confirm_payment Postgres function (packages/db/migrations/
// 0031_payment_confirmation.sql) — one plpgsql transaction, not a series of
// calls from here. This file is a thin auth-and-dispatch shim.
//
// No CORS/OPTIONS handling: this function is called server-to-server from
// apps/console's confirmPayment server action (apps/console/src/app/console/
// (app)/orders/actions.ts), which forwards the merchant's own session
// access_token — never directly from a browser (the console session lives
// in an httpOnly cookie the browser cannot read to build an Authorization
// header itself). No browser ever sends a CORS preflight to this URL.
import { withConsoleAuth } from "../_shared/console/auth.ts";
import { jsonResponse, errorResponse } from "../_shared/console/response.ts";

interface ConfirmPaymentRequest {
  orderId: string;
}

function isConfirmPaymentRequest(body: unknown): body is ConfirmPaymentRequest {
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
    if (!isConfirmPaymentRequest(body)) {
      return errorResponse(400, "malformed request body");
    }

    const { data, error } = await ctx.supabase.rpc("console_confirm_payment", {
      p_order_id: body.orderId,
      p_merchant_id: ctx.merchantId,
    });

    if (error) {
      // Never leak error.message -- same posture as public-create-order's
      // own RPC error handling.
      console.error("console_confirm_payment RPC error", error);
      return errorResponse(500, "confirmation failed");
    }

    if (data.ok === false) {
      if (data.code === "FORBIDDEN") return errorResponse(403);
      if (data.code === "NOT_FOUND") return errorResponse(404, "order not found");
      return errorResponse(500, "confirmation failed");
    }

    // A second tap or a retried request returns this SAME 200 shape with
    // already:true -- WBS 5.6's own acceptance criterion: not an error
    // surfaced to the merchant, who tapped twice because the first tap felt
    // slow.
    return jsonResponse({ ok: true, already: data.already, order: data.order ?? null });
  }),
);
