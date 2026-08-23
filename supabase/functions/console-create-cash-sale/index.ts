// WBS 5.12 — "รับเงินสด". Thin auth-and-dispatch shim, same posture as
// console-confirm-payment/console-advance-order: the real revalidation,
// cost-snapshot, order-code generation, and stock-deduction logic all live
// inside console_create_cash_sale (packages/db/migrations/
// 0050_console_cash_sale.sql), one plpgsql transaction. This file has no
// business logic of its own.
//
// No CORS/OPTIONS handling: called server-to-server from apps/console's
// createCashSale server action, which forwards the merchant's own session
// access_token — same reasoning as console-confirm-payment/index.ts's own
// header comment (the console session lives in an httpOnly cookie the
// browser cannot read to build an Authorization header itself).
import { withConsoleAuth } from "../_shared/console/auth.ts";
import { jsonResponse, errorResponse } from "../_shared/console/response.ts";

interface CashSaleCartOption {
  groupId: string;
  optionId: string;
  name: string;
  deltaSatang: number;
}

interface CashSaleCartLine {
  menuItemId: string;
  nameSnapshot: string;
  unitPriceSatang: number;
  quantity: number;
  options: CashSaleCartOption[];
}

interface CreateCashSaleRequest {
  cart: CashSaleCartLine[];
}

function isCreateCashSaleRequest(body: unknown): body is CreateCashSaleRequest {
  if (typeof body !== "object" || body === null) return false;
  const cart = (body as Record<string, unknown>).cart;
  return Array.isArray(cart);
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
    if (!isCreateCashSaleRequest(body)) {
      return errorResponse(400, "malformed request body");
    }

    const { data, error } = await ctx.supabase.rpc("console_create_cash_sale", {
      p_merchant_id: ctx.merchantId,
      p_cart_lines: body.cart.map((line) => ({
        menuItemId: line.menuItemId,
        nameSnapshot: line.nameSnapshot,
        unitPriceSatang: line.unitPriceSatang,
        quantity: line.quantity,
        options: (line.options ?? []).map((option) => ({
          groupId: option.groupId,
          optionId: option.optionId,
          name: option.name,
          deltaSatang: option.deltaSatang,
        })),
      })),
    });

    if (error) {
      // Never leak error.message -- same posture as every other console-*
      // RPC error handler in this codebase.
      console.error("console_create_cash_sale RPC error", error);
      return errorResponse(500, "cash sale failed");
    }

    if (data.ok === false) {
      if (data.code === "FORBIDDEN") return errorResponse(403);
      if (data.code === "NOT_FOUND") return errorResponse(404, "store not found");
      if (data.code === "PRICE_MISMATCH") return jsonResponse({ code: "PRICE_MISMATCH", diffs: data.diffs ?? [] }, 409);
      return errorResponse(400, data.message ?? "validation error");
    }

    return jsonResponse({ ok: true, order: data.order });
  }),
);
