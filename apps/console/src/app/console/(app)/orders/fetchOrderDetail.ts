// WBS 5.9 — /console/orders/{id}. Same query-sharing posture as
// fetchWorkingQueue.ts (WBS 5.8): one shape used by the server-rendered
// page, so there is exactly one definition of "what the detail screen
// shows" to drift out of sync. Unlike fetchWorkingQueue, this fetches
// exactly one order regardless of its status (a merchant can open a
// terminal-state order's detail from history, not only the working queue),
// so it takes no WORKING_QUEUE_STATUSES filter.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@brewledger/db/types";
import type { OrderLineItem } from "@brewledger/ui";
import { formatPickupTime } from "./format";

type OrderRow = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "order_code" | "customer_name" | "customer_phone" | "total_satang" | "pickup_slot_id" | "status" | "store_id"
>;

type OrderItemRow = Pick<
  Database["public"]["Tables"]["order_items"]["Row"],
  "id" | "order_id" | "item_name_snapshot" | "quantity"
> & {
  order_item_options: Pick<Database["public"]["Tables"]["order_item_options"]["Row"], "option_name_snapshot">[];
};

type HistoryRow = Pick<
  Database["public"]["Tables"]["order_status_history"]["Row"],
  "from_status" | "to_status" | "created_at"
>;

export interface OrderDetailHistoryEntry {
  toStatus: string;
  time: string;
}

export interface OrderDetail {
  id: string;
  code: string;
  status: string;
  customerName: string;
  customerPhone: string | null;
  pickupTime: string;
  totalSatang: number;
  cups: number;
  items: OrderLineItem[];
  history: OrderDetailHistoryEntry[];
}

export async function fetchOrderDetail(
  supabase: SupabaseClient,
  storeId: string,
  orderId: string,
): Promise<OrderDetail | null> {
  const { data: orderRow } = await supabase
    .from("orders")
    .select("id, order_code, customer_name, customer_phone, total_satang, pickup_slot_id, status, store_id")
    .eq("id", orderId)
    .eq("store_id", storeId)
    .maybeSingle();

  const order = orderRow as OrderRow | null;
  if (!order) return null;

  let pickupTime = "-";
  if (order.pickup_slot_id) {
    const { data: slotRow } = await supabase
      .from("pickup_slots")
      .select("slot_start")
      .eq("id", order.pickup_slot_id)
      .maybeSingle();
    pickupTime = formatPickupTime((slotRow as { slot_start: string } | null)?.slot_start ?? null) ?? "-";
  }

  const { data: itemRows } = await supabase
    .from("order_items")
    .select("id, order_id, item_name_snapshot, quantity, order_item_options(option_name_snapshot)")
    .eq("order_id", order.id);

  const items: OrderLineItem[] = [];
  let cups = 0;
  for (const row of (itemRows ?? []) as unknown as OrderItemRow[]) {
    const optionsLabel = row.order_item_options.map((o) => o.option_name_snapshot).join(" · ") || undefined;
    items.push({ name: row.item_name_snapshot, optionsLabel, quantity: row.quantity });
    cups += row.quantity;
  }

  // order_status_history: authenticated-only, RLS-scoped to the caller's
  // own stores via a one-join policy on order_id (0032_order_status_history.sql)
  // — no separate store_id filter needed on this query, same as that
  // policy's own reasoning.
  const { data: historyRows } = await supabase
    .from("order_status_history")
    .select("from_status, to_status, created_at")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  const history = ((historyRows ?? []) as HistoryRow[]).map((row) => ({
    toStatus: row.to_status,
    time: formatPickupTime(row.created_at) ?? "-",
  }));

  return {
    id: order.id,
    code: order.order_code,
    status: order.status,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    pickupTime,
    totalSatang: order.total_satang,
    cups,
    items,
    history,
  };
}
