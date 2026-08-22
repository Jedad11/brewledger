// WBS 7.1 — one query shape shared by page.tsx's server-rendered initial
// summary AND useDashboardSummary.ts's own client-side realtime/poll
// refetch, same "single source of truth for the shape" reasoning
// orders/fetchWorkingQueue.ts already established for the working queue.
// Takes a plain SupabaseClient (server or browser) for the same reason that
// file does: this has no business knowing which runtime called it. RLS
// (merchant_rw_orders et al., 0021_rls.sql) is the tenant boundary; the
// explicit store_id filters below are "the current store" scoping
// (lib/merchant.ts's own currentStoreId note).
//
// Methodology mirrors WBS 7.5's own nightly `daily_aggregate` job (WBS
// Dictionary line 5539-5550) so a merchant never sees this dashboard and
// the P&L report disagree about what counts as revenue for the same day —
// this just runs the identical shape live instead of waiting for 01:00.
// The one deliberate difference is PROFIT (not revenue): WBS 7.1's own
// Claude Code Prompt step 2 requires "net profit only from order lines that
// have a non-null unit_cost_snapshot_satang" — i.e. an untracked line
// contributes to ยอดขายวันนี้ but is excluded entirely (both its revenue AND
// its cost) from กำไรสุทธิวันนี้, never treated as zero-cost. 7.5's own
// gross_revenue - total_cogs - other_expense formula uses ALL revenue minus
// only tracked cogs, which would let an untracked line's revenue inflate
// "profit" while wearing no cost at all — exactly the 100%-margin illusion
// RL-2 forbids. Kept as two different formulas is intentional, not drift.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@brewledger/db/types";
import { businessDateBoundsUtc } from "./businessDate";

// gross revenue per WBS 7.5's own definition: paid orders, online and cash
// alike. PENDING_PAYMENT (not yet paid), CANCELLED/REFUNDED (money did not
// stay with the merchant) and EXPIRED are excluded.
const REVENUE_STATUSES = ["ACCEPTED", "PREPARING", "READY", "COLLECTED"] as const;

// The live working queue the merchant is actively handling right now —
// independent of business_date (an order accepted at 23:50 and still being
// made at 00:05 is still today's work, not yesterday's), same statuses as
// orders/statusMap.ts's own WORKING_QUEUE_STATUSES.
const WAITING_STATUS = "ACCEPTED";
const PREPARING_STATUS = "PREPARING";
const READY_STATUS = "READY";

export interface UpcomingSlot {
  id: string;
  slotStart: string;
  bookedCount: number;
}

export interface DashboardSummary {
  revenueSatang: number;
  /** null only when zero of today's lines carry a cost snapshot (RL-2) — never coerced to 0. */
  profitSatang: number | null;
  expensesSatang: number;
  trackedItemCount: number;
  totalItemCount: number;
  orderCounts: { waiting: number; preparing: number; ready: number };
  upcomingSlots: UpcomingSlot[];
}

type OrderRow = Pick<Database["public"]["Tables"]["orders"]["Row"], "id" | "total_satang" | "status">;
type OrderItemRow = Pick<
  Database["public"]["Tables"]["order_items"]["Row"],
  "quantity" | "unit_price_snapshot_satang" | "unit_cost_snapshot_satang"
>;
type PurchaseInvoiceRow = Pick<Database["public"]["Tables"]["purchase_invoices"]["Row"], "total_satang">;
type PickupSlotRow = Pick<
  Database["public"]["Tables"]["pickup_slots"]["Row"],
  "id" | "slot_start" | "booked_count"
>;

export async function fetchDashboardSummary(
  supabase: SupabaseClient,
  storeId: string,
  timezone: string,
): Promise<DashboardSummary> {
  const { businessDate, startUtc, endUtc } = businessDateBoundsUtc(timezone);

  const [revenueResult, workingQueueResult, invoiceResult, slotResult] = await Promise.all([
    supabase
      .from("orders")
      .select("id, total_satang, status")
      .eq("store_id", storeId)
      .in("status", REVENUE_STATUSES)
      .gte("created_at", startUtc.toISOString())
      .lt("created_at", endUtc.toISOString()),
    supabase
      .from("orders")
      .select("id, total_satang, status")
      .eq("store_id", storeId)
      .in("status", [WAITING_STATUS, PREPARING_STATUS, READY_STATUS]),
    supabase
      .from("purchase_invoices")
      .select("total_satang")
      .eq("store_id", storeId)
      .eq("review_status", "confirmed")
      .eq("invoice_date", businessDate),
    supabase
      .from("pickup_slots")
      .select("id, slot_start, booked_count")
      .eq("store_id", storeId)
      .eq("is_open", true)
      .gt("slot_start", new Date().toISOString())
      .order("slot_start", { ascending: true })
      .limit(3),
  ]);

  const revenueOrders = (revenueResult.data ?? []) as OrderRow[];
  const revenueSatang = revenueOrders.reduce((sum, o) => sum + o.total_satang, 0);

  let trackedItemCount = 0;
  let totalItemCount = 0;
  let trackedRevenueSatang = 0;
  let trackedCogsSatang = 0;
  const revenueOrderIds = revenueOrders.map((o) => o.id);
  if (revenueOrderIds.length > 0) {
    const { data: itemRows } = await supabase
      .from("order_items")
      .select("quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang")
      .in("order_id", revenueOrderIds);
    for (const item of (itemRows ?? []) as OrderItemRow[]) {
      totalItemCount += 1;
      if (item.unit_cost_snapshot_satang !== null) {
        trackedItemCount += 1;
        trackedRevenueSatang += item.unit_price_snapshot_satang * item.quantity;
        trackedCogsSatang += item.unit_cost_snapshot_satang * item.quantity;
      }
    }
  }

  const expensesSatang = ((invoiceResult.data ?? []) as PurchaseInvoiceRow[]).reduce(
    (sum, row) => sum + (row.total_satang ?? 0),
    0,
  );

  // RL-2: only computed when at least one line today has a cost snapshot.
  // Zero tracked lines -> null, never 0 (a 0 here would read as "100%
  // expenses" or "break-even," both fabricated).
  const profitSatang =
    trackedItemCount > 0 ? trackedRevenueSatang - trackedCogsSatang - expensesSatang : null;

  const workingQueue = (workingQueueResult.data ?? []) as OrderRow[];
  const orderCounts = {
    waiting: workingQueue.filter((o) => o.status === WAITING_STATUS).length,
    preparing: workingQueue.filter((o) => o.status === PREPARING_STATUS).length,
    ready: workingQueue.filter((o) => o.status === READY_STATUS).length,
  };

  const upcomingSlots = ((slotResult.data ?? []) as PickupSlotRow[]).map((row) => ({
    id: row.id,
    slotStart: row.slot_start,
    bookedCount: row.booked_count,
  }));

  return {
    revenueSatang,
    profitSatang,
    expensesSatang,
    trackedItemCount,
    totalItemCount,
    orderCounts,
    upcomingSlots,
  };
}
