// WBS 5.9 — "ทำเสร็จทั้งช่วงเวลานี้": mark every ACCEPTED/PREPARING order in
// one pickup slot as READY. The client sends the exact order ids it already
// has locally (the working-queue rows grouped by slot) rather than a
// pickup_slot_id for this function to re-derive its own grouping from --
// avoids a second "which orders share a slot" definition that could drift
// from the client's own (InboxClient.tsx groups by formatted pickup-time
// label; re-deriving that here from pickup_slot_id would be a second,
// possibly-disagreeing source of truth for the same grouping).
//
// "Process per order, not as one DB transaction" (WBS 5.9 acceptance): each
// iteration below is an independent RPC call (its own Postgres transaction),
// not wrapped in any outer transaction of this function's own -- a failure
// on order 3 of 5 neither blocks nor rolls back orders 1, 2, 4, 5.
//
// An order currently ACCEPTED needs two hops (ACCEPTED->PREPARING->READY;
// transition_order has no direct ACCEPTED->READY pair, WBS 5.7 §3) while a
// PREPARING order needs one -- this function reads each order's current
// status first (via ctx.supabase, RLS-scoped to the caller's own stores, so
// a foreign order id simply returns no row rather than leaking whether it
// exists) and walks only the hops that specific order actually needs.
import { withConsoleAuth, type ConsoleContext } from "../_shared/console/auth.ts";
import { jsonResponse, errorResponse } from "../_shared/console/response.ts";

interface BulkReadyRequest {
  orderIds: string[];
}

const MAX_ORDER_IDS = 200; // generous bound for a single pickup slot; guards against a malformed/abusive payload

function isBulkReadyRequest(body: unknown): body is BulkReadyRequest {
  if (typeof body !== "object" || body === null) return false;
  const ids = (body as Record<string, unknown>).orderIds;
  return Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === "string");
}

interface BulkResultRow {
  orderId: string;
  ok: boolean;
  code?: string;
}

async function advanceOne(
  ctx: ConsoleContext,
  orderId: string,
  to: "PREPARING" | "READY",
): Promise<{ ok: true } | { ok: false; code: string }> {
  const { data, error } = await ctx.supabase.rpc("console_advance_order", { p_order_id: orderId, p_to: to });
  if (error) {
    console.error("console_advance_order RPC error (bulk)", error);
    return { ok: false, code: "ERROR" };
  }
  if (data.ok === false) {
    return { ok: false, code: data.code ?? "ERROR" };
  }
  return { ok: true };
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
    if (!isBulkReadyRequest(body)) {
      return errorResponse(400, "malformed request body");
    }
    if (body.orderIds.length > MAX_ORDER_IDS) {
      return errorResponse(400, "too many orders");
    }

    const results: BulkResultRow[] = [];

    for (const orderId of body.orderIds) {
      const { data: orderRow, error: readErr } = await ctx.supabase
        .from("orders")
        .select("status")
        .eq("id", orderId)
        .maybeSingle();

      if (readErr || !orderRow) {
        results.push({ orderId, ok: false, code: "NOT_FOUND" });
        continue;
      }

      let status = orderRow.status as string;

      if (status === "ACCEPTED") {
        const step = await advanceOne(ctx, orderId, "PREPARING");
        if (!step.ok) {
          results.push({ orderId, ok: false, code: step.code });
          continue;
        }
        status = "PREPARING";
      }

      if (status === "PREPARING") {
        const step = await advanceOne(ctx, orderId, "READY");
        if (!step.ok) {
          results.push({ orderId, ok: false, code: step.code });
          continue;
        }
        status = "READY";
      }

      results.push(status === "READY" ? { orderId, ok: true } : { orderId, ok: false, code: "INVALID_STATUS" });
    }

    return jsonResponse({ ok: true, results });
  }),
);
