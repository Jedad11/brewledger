import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { PendingPaymentSection, type PendingOrder } from "./PendingPaymentSection";
import { PageEmptyState } from "./PageEmptyState";
import { PAGE_TITLE } from "./copy";
import type { Database } from "@brewledger/db/types";

// WBS 5.6 — the pending-payment section is this entry's own deliverable,
// built out in full below. The working QUEUE (orders already ACCEPTED and
// beyond) is WBS 5.8's own screen and is deliberately NOT built here: an
// inbox card promises real actions (advance, cancel, open) that route
// through the WBS 5.7 lifecycle guard, which does not exist in this repo
// yet (see packages/db/migrations/0031_payment_confirmation.sql's own
// header comment on that gap). Rendering OrderCard here with inert
// onAdvance/onCancel handlers would be a dead button in production, which
// is worse than the section not existing yet -- WBS 5.8 owns adding it
// below this one, same page, same "above the working queue" structure the
// WBS 5.6 prompt itself describes.
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

  // RLS (auth_store_ids(), 0021_rls.sql) already scopes this to the caller's
  // own stores -- no manual .in("store_id", merchant.storeIds) filter needed
  // or wanted (WBS 4.2: this app never re-derives store scoping by hand).
  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, order_code, customer_name, total_satang, pickup_slot_id, expires_at, status")
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

  const pendingOrders: PendingOrder[] = pending.map((order) => ({
    id: order.id,
    orderCode: order.order_code,
    customerName: order.customer_name,
    totalSatang: order.total_satang,
    pickupSlotStart: order.pickup_slot_id ? (slotStartById.get(order.pickup_slot_id) ?? null) : null,
    expiresAt: order.expires_at,
  }));

  // Page-level empty state (docs/design/state_matrix.md line 127, pre-
  // existing copy): only shown when there is truly nothing pending. Once
  // WBS 5.8 lands its own working-queue query, this condition should widen
  // to "pending is empty AND the queue is empty" -- narrowing it to pending-
  // only here, rather than guessing at the queue's shape, is this entry's
  // own scope boundary.
  if (pendingOrders.length === 0) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-8">
        <h1 className="mb-6 font-serif text-3xl font-bold leading-[1.35] text-ink">{PAGE_TITLE}</h1>
        <PageEmptyState />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <h1 className="mb-6 font-serif text-3xl font-bold leading-[1.35] text-ink">{PAGE_TITLE}</h1>
      <PendingPaymentSection orders={pendingOrders} />
    </main>
  );
}
