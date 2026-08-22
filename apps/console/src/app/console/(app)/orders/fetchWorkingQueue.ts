// WBS 5.8 — one query shape shared by page.tsx's server-rendered initial
// list AND the client's own poll (useOrdersFeed.ts) so the two never drift
// into two different definitions of "what's in the working queue." Takes a
// plain SupabaseClient (server or browser -- both @supabase/ssr factories
// return real SupabaseClient instances) rather than either app's own
// createClient() wrapper, since this file has no business knowing which
// runtime called it. RLS (merchant_rw_orders et al., 0021_rls.sql) is the
// tenant boundary; the explicit store_id filters below are "the current
// store" scoping (lib/merchant.ts's own currentStoreId note: a merchant
// owning more than one store is legal at the schema level, and an
// unfiltered query would silently interleave two stores' queues).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@brewledger/db/types";
import type { OrderLineItem } from "@brewledger/ui";
import { formatPickupTime } from "./format";
import { WORKING_QUEUE_STATUSES } from "./statusMap";

type OrderRow = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  | "id"
  | "order_code"
  | "customer_name"
  | "total_satang"
  | "pickup_slot_id"
  | "status"
  | "created_at"
  | "payment_confirmed_at"
>;

type OrderItemRow = Pick<
  Database["public"]["Tables"]["order_items"]["Row"],
  "id" | "order_id" | "item_name_snapshot" | "quantity"
> & {
  order_item_options: Pick<Database["public"]["Tables"]["order_item_options"]["Row"], "option_name_snapshot">[];
};

export interface WorkingOrder {
  id: string;
  code: string;
  status: string;
  customerName: string;
  pickupSlotId: string | null;
  pickupTime: string;
  totalSatang: number;
  cups: number;
  items: OrderLineItem[];
  /** COALESCE(payment_confirmed_at, created_at) — the moment this order entered the merchant's queue, used for the unseen cursor. */
  arrivedAt: string;
}

export async function fetchWorkingQueue(supabase: SupabaseClient, storeId: string): Promise<WorkingOrder[]> {
  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, order_code, customer_name, total_satang, pickup_slot_id, status, created_at, payment_confirmed_at")
    .eq("store_id", storeId)
    .in("status", WORKING_QUEUE_STATUSES)
    .order("created_at", { ascending: true });

  const orders = (orderRows ?? []) as OrderRow[];
  if (orders.length === 0) return [];

  const slotIds = [...new Set(orders.map((o) => o.pickup_slot_id).filter((id): id is string => id !== null))];
  const slotStartById = new Map<string, string>();
  if (slotIds.length > 0) {
    const { data: slotRows } = await supabase.from("pickup_slots").select("id, slot_start").in("id", slotIds);
    for (const slot of (slotRows ?? []) as { id: string; slot_start: string }[]) {
      slotStartById.set(slot.id, slot.slot_start);
    }
  }

  const orderIds = orders.map((o) => o.id);
  const { data: itemRows } = await supabase
    .from("order_items")
    .select("id, order_id, item_name_snapshot, quantity, order_item_options(option_name_snapshot)")
    .in("order_id", orderIds);

  const itemsByOrder = new Map<string, OrderLineItem[]>();
  const cupsByOrder = new Map<string, number>();
  for (const row of (itemRows ?? []) as unknown as OrderItemRow[]) {
    const optionsLabel = row.order_item_options.map((o) => o.option_name_snapshot).join(" · ") || undefined;
    const list = itemsByOrder.get(row.order_id) ?? [];
    list.push({ name: row.item_name_snapshot, optionsLabel, quantity: row.quantity });
    itemsByOrder.set(row.order_id, list);
    cupsByOrder.set(row.order_id, (cupsByOrder.get(row.order_id) ?? 0) + row.quantity);
  }

  return orders.map((o) => ({
    id: o.id,
    code: o.order_code,
    status: o.status,
    customerName: o.customer_name,
    pickupSlotId: o.pickup_slot_id,
    pickupTime: (o.pickup_slot_id ? formatPickupTime(slotStartById.get(o.pickup_slot_id) ?? null) : null) ?? "-",
    totalSatang: o.total_satang,
    cups: cupsByOrder.get(o.id) ?? 0,
    items: itemsByOrder.get(o.id) ?? [],
    arrivedAt: o.payment_confirmed_at ?? o.created_at,
  }));
}
