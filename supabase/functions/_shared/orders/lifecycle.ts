// WBS 5.7 — thin RPC wrapper around transition_order(), the ONLY permitted
// way to change orders.status (packages/db/migrations/0032_order_status_history.sql).
// See docs/db/wbs_5_7_lifecycle_design.md §0/§5 for why this owns no
// transaction of its own: this codebase's Edge Functions hold a
// supabase-js client scoped to a single RPC call, never a raw Postgres
// connection, so there is no `tx` to pass the way the WBS 5.7 prompt's
// literal transitionOrder(tx, orderId, to, actor) signature assumes. The
// atomic guard — row lock, transition map, side effects, history write —
// is entirely inside transition_order() in Postgres; supabase-js's single
// .rpc() call IS the unit of work, same posture as console-confirm-payment/
// index.ts's own ctx.supabase.rpc("console_confirm_payment", ...) call.
//
// Neutral location (not under _shared/console/ or _shared/public/) so it is
// importable from both scopes without tripping the RL-3 eslint import
// boundary — it contains no cost/margin/stock read logic, only an
// order-status RPC call.
//
// NOTE: calling this directly does NOT, by itself, give a caller the
// idempotent-double-tap behaviour WBS 5.6 requires — that lives in the
// wrapper Postgres function (console_confirm_payment / console_reject_payment,
// packages/db/migrations/0033_route_payment_confirmation_through_lifecycle.sql;
// see docs/db/wbs_5_7_lifecycle_design.md §4). Call this only from inside
// such a wrapper's own RPC, never directly from an Edge Function index.ts as
// the sole guard for a merchant-facing, money/stock-bearing action.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type OrderStatus =
  | "PENDING_PAYMENT" | "ACCEPTED" | "PREPARING" | "READY"
  | "COLLECTED" | "CANCELLED" | "REFUNDED" | "EXPIRED";

export type Actor =
  | { type: "merchant"; id: string }
  | { type: "system" };

export class IllegalTransitionError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`illegal order transition: ${from} -> ${to} (order ${orderId})`);
  }
}

export async function transitionOrder(
  supabase: SupabaseClient,
  orderId: string,
  to: OrderStatus,
  actor: Actor,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("transition_order", {
    p_order_id: orderId,
    p_to: to,
    p_actor: actor.type === "merchant" ? actor.id : null,
    p_actor_type: actor.type,
  });

  if (error) {
    if (error.code === "BL001") {
      const match = /from_status=([A-Z_]+) to_status=([A-Z_]+)/.exec(error.details ?? "");
      throw new IllegalTransitionError(orderId, match?.[1] ?? "?", match?.[2] ?? to);
    }
    throw error;
  }
  return data as Record<string, unknown>;
}
