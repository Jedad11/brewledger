// WBS 5.11 — "รอคืนเงิน" section. Same query-sharing posture as
// fetchWorkingQueue.ts/fetchOrderDetail.ts (WBS 5.8/5.9): one shape used by
// the server-rendered page, so there is exactly one definition of "what's
// in the pending-refund list" to drift out of sync. Backed by
// orders_refund_pending_idx (packages/db/migrations/
// 0051_console_cancel_order_refund.sql) — store_id + refund_status='pending'
// — the query below matches that index's own predicate exactly.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@brewledger/db/types";

type OrderRow = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "order_code" | "customer_name" | "customer_phone" | "total_satang"
>;

type HistoryRow = Pick<Database["public"]["Tables"]["order_status_history"]["Row"], "order_id" | "created_at">;

export interface RefundPendingOrder {
  id: string;
  orderCode: string;
  customerName: string;
  customerPhone: string | null;
  totalSatang: number;
  daysOutstanding: number;
}

export async function fetchRefundPending(supabase: SupabaseClient, storeId: string): Promise<RefundPendingOrder[]> {
  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, order_code, customer_name, customer_phone, total_satang")
    .eq("store_id", storeId)
    .eq("refund_status", "pending")
    .order("created_at", { ascending: false });

  const orders = (orderRows ?? []) as OrderRow[];
  if (orders.length === 0) return [];

  // CANCELLED is reached at most once per order (terminal, except the
  // CANCELLED -> REFUNDED pair this list's own resolve action drives) --
  // exactly one order_status_history row per order here, the moment the
  // refund obligation began, not orders.created_at (which is when the
  // order was PLACED, not when it was cancelled).
  const orderIds = orders.map((o) => o.id);
  const { data: historyRows } = await supabase
    .from("order_status_history")
    .select("order_id, created_at")
    .in("order_id", orderIds)
    .eq("to_status", "CANCELLED");

  const cancelledAtByOrder = new Map<string, string>();
  for (const row of (historyRows ?? []) as HistoryRow[]) {
    cancelledAtByOrder.set(row.order_id, row.created_at);
  }

  const nowMs = Date.now();
  return orders.map((order) => {
    const cancelledAt = cancelledAtByOrder.get(order.id);
    const elapsedMs = cancelledAt ? nowMs - new Date(cancelledAt).getTime() : 0;
    const daysOutstanding = Math.max(0, Math.floor(elapsedMs / 86_400_000));
    return {
      id: order.id,
      orderCode: order.order_code,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      totalSatang: order.total_satang,
      daysOutstanding,
    };
  });
}
