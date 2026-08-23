import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { PendingPaymentSection, type PendingOrder } from "./PendingPaymentSection";
import { PageEmptyState } from "./PageEmptyState";
import { InboxClient } from "./InboxClient";
import { fetchWorkingQueue } from "./fetchWorkingQueue";
import { PAGE_TITLE } from "./copy";
import type { Database } from "@brewledger/db/types";

// WBS 5.6 built the pending-payment section below. WBS 5.8 adds the working
// QUEUE (orders already ACCEPTED and beyond) as InboxClient, "above" it per
// the WBS 5.6 prompt's own structure note being read the other way around —
// pending-payment renders first on the page, the working queue after, both
// under one <h1>.
type OrderRow = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "order_code" | "customer_name" | "total_satang" | "pickup_slot_id" | "expires_at" | "status"
>;

export default async function OrdersPage() {
  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    redirect("/console/login");
  }

  const supabase = await createClient();
  const storeId = currentStoreId(merchant);

  // RLS (auth_store_ids(), 0021_rls.sql) already scopes every query below to
  // the caller's own stores; the explicit .eq("store_id", storeId) filters
  // are a NARROWER "the current store" scope (lib/merchant.ts's own
  // currentStoreId note — a merchant owning more than one store is legal at
  // the schema level, and this screen renders exactly one store's queue).
  let pendingOrders: PendingOrder[] = [];
  if (storeId) {
    const { data: orderRows } = await supabase
      .from("orders")
      .select("id, order_code, customer_name, total_satang, pickup_slot_id, expires_at, status")
      .eq("store_id", storeId)
      .eq("status", "PENDING_PAYMENT")
      .order("expires_at", { ascending: true });

    const pending = (orderRows ?? []) as OrderRow[];

    const slotIds = pending.map((o) => o.pickup_slot_id).filter((id): id is string => id !== null);
    const slotStartById = new Map<string, string>();
    if (slotIds.length > 0) {
      const { data: slotRows } = await supabase.from("pickup_slots").select("id, slot_start").in("id", slotIds);
      for (const slot of slotRows ?? []) {
        slotStartById.set(slot.id as string, slot.slot_start as string);
      }
    }

    pendingOrders = pending.map((order) => ({
      id: order.id,
      orderCode: order.order_code,
      customerName: order.customer_name,
      totalSatang: order.total_satang,
      pickupSlotStart: order.pickup_slot_id ? (slotStartById.get(order.pickup_slot_id) ?? null) : null,
      expiresAt: order.expires_at,
    }));
  }

  let workingOrders: Awaited<ReturnType<typeof fetchWorkingQueue>> = [];
  let lastSeenAt: string | null = null;
  let notifySoundMuted = false;
  if (storeId) {
    workingOrders = await fetchWorkingQueue(supabase, storeId);
    const { data: storeRow } = await supabase
      .from("stores")
      .select("orders_last_seen_at, notify_sound_muted")
      .eq("id", storeId)
      .single();
    lastSeenAt = storeRow?.orders_last_seen_at ?? null;
    notifySoundMuted = storeRow?.notify_sound_muted ?? false;
  }

  // Page-level empty state (docs/design/state_matrix.md line 127): only
  // shown when there is truly nothing to work on anywhere on this page —
  // widened here (WBS 5.8) from "pending is empty" to "pending AND the
  // working queue are both empty", per WBS 5.6's own forward-looking note.
  if (pendingOrders.length === 0 && workingOrders.length === 0) {
    return (
      <>
        <header className="oc-top">
          <div>
            <h1>{PAGE_TITLE}</h1>
          </div>
        </header>
        <div className="oc-body">
          <PageEmptyState />
        </div>
      </>
    );
  }

  return (
    <>
      <header className="oc-top">
        <div>
          <h1>{PAGE_TITLE}</h1>
        </div>
      </header>
      <div className="oc-body">
        {pendingOrders.length > 0 ? <PendingPaymentSection orders={pendingOrders} /> : null}
        {storeId ? (
          <InboxClient
            storeId={storeId}
            initialOrders={workingOrders}
            initialLastSeenAt={lastSeenAt}
            initialMuted={notifySoundMuted}
          />
        ) : null}
      </div>
    </>
  );
}
