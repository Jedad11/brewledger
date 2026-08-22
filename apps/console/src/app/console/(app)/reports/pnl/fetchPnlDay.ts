// WBS 7.5 — Daily P&L data access. Two read paths, matching the WBS
// prompt's own "Today reads live from orders; past days read
// daily_financials" instruction, plus one path that isn't in the prompt but
// has to exist: a past day the nightly `daily_aggregate` job hasn't reached
// yet (new store, worker downtime) still needs a number, not a blank page —
// falls back to the same live computation as today.
//
// RL-2 note on the formula: the WBS Dictionary's own prose
// (net_profit = gross_revenue(ALL lines) - total_cogs(tracked lines only) -
// other_expense) would let an untracked line's full price inflate profit
// while wearing zero cost — the exact 100%-margin illusion RL-2 forbids. The
// WBS's own disclosure copy one paragraph later, and state_matrix.md, both
// compute profit from tracked lines only. This file and worker/src/handlers/
// dailyAggregate.ts both use the tracked-only formula (net_profit =
// trackedRevenue - trackedCogs - otherExpense), matching WBS 7.1's own
// fetchDashboardSummary.ts resolution of the same ambiguity — flagged during
// 7.1's redline review as a WBS Dictionary documentation defect, not
// rediscovered here.
//
// No gateway fee term anywhere in this file: WBS 4.8 (Fee Model
// Documentation) already dropped merchants.absorb_gateway_fee,
// orders.gateway_fee_satang, and orders.fee_borne_by, and its own Claude
// Code Prompt step 2 explicitly lists "the absorbed-fee line in the WBS 7.5
// P&L" among the lines to remove. The delivered prototype
// (design/console-reports.js scPnl()) still renders one — stale, superseded
// by 4.8, not reproduced here. See docs/design/state_matrix.md's own pnl
// section, corrected in this change.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@brewledger/db/types";
import { businessDateBoundsUtc, businessDateBoundsForDateUtc } from "../../businessDate";

const REVENUE_STATUSES = ["ACCEPTED", "PREPARING", "READY", "COLLECTED"] as const;

export interface PnlDay {
  businessDate: string;
  grossRevenueSatang: number;
  /** null when zero tracked lines that day — never coerced to 0 (RL-2). */
  totalCogsSatang: number | null;
  otherExpenseSatang: number;
  /** null when zero tracked lines that day — never coerced to 0 (RL-2). */
  netProfitSatang: number | null;
  orderCount: number;
  trackedItemCount: number;
  totalItemCount: number;
  untrackedRevenueSatang: number;
  source: "live" | "aggregate";
}

type OrderRow = Pick<Database["public"]["Tables"]["orders"]["Row"], "id" | "total_satang">;
type OrderItemRow = Pick<
  Database["public"]["Tables"]["order_items"]["Row"],
  "quantity" | "unit_price_snapshot_satang" | "unit_cost_snapshot_satang"
>;
type PurchaseInvoiceRow = Pick<Database["public"]["Tables"]["purchase_invoices"]["Row"], "total_satang">;
type DailyFinancialsRow = Pick<
  Database["public"]["Tables"]["daily_financials"]["Row"],
  "gross_revenue_satang" | "total_cogs_satang" | "other_expense_satang" | "net_profit_satang" | "order_count"
>;

async function fetchRevenueOrders(
  supabase: SupabaseClient,
  storeId: string,
  startUtc: Date,
  endUtc: Date,
): Promise<OrderRow[]> {
  const { data } = await supabase
    .from("orders")
    .select("id, total_satang")
    .eq("store_id", storeId)
    .in("status", REVENUE_STATUSES)
    .gte("created_at", startUtc.toISOString())
    .lt("created_at", endUtc.toISOString());
  return (data ?? []) as OrderRow[];
}

interface ItemDisclosure {
  orders: OrderRow[];
  trackedItemCount: number;
  totalItemCount: number;
  trackedRevenueSatang: number;
  trackedCogsSatang: number;
  untrackedRevenueSatang: number;
}

// Item-level tally shared by both read paths. Deliberately NOT sourced from
// daily_financials (which has no per-item columns) — order_items.
// unit_cost_snapshot_satang / unit_price_snapshot_satang are frozen at sale
// (trigger-protected, see CLAUDE.md's "cost is stored twice"), so re-scanning
// them for a PAST day is exactly as immutable as reading a stored aggregate
// would be, and needs no new column or migration to support the
// untracked-item disclosure block on historical days.
async function computeItemDisclosure(
  supabase: SupabaseClient,
  storeId: string,
  startUtc: Date,
  endUtc: Date,
): Promise<ItemDisclosure> {
  const orders = await fetchRevenueOrders(supabase, storeId, startUtc, endUtc);

  let trackedItemCount = 0;
  let totalItemCount = 0;
  let trackedRevenueSatang = 0;
  let trackedCogsSatang = 0;
  let untrackedRevenueSatang = 0;

  const orderIds = orders.map((o) => o.id);
  if (orderIds.length > 0) {
    const { data: itemRows } = await supabase
      .from("order_items")
      .select("quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang")
      .in("order_id", orderIds);
    for (const item of (itemRows ?? []) as OrderItemRow[]) {
      totalItemCount += 1;
      const lineRevenueSatang = item.unit_price_snapshot_satang * item.quantity;
      if (item.unit_cost_snapshot_satang !== null) {
        trackedItemCount += 1;
        trackedRevenueSatang += lineRevenueSatang;
        trackedCogsSatang += item.unit_cost_snapshot_satang * item.quantity;
      } else {
        untrackedRevenueSatang += lineRevenueSatang;
      }
    }
  }

  return { orders, trackedItemCount, totalItemCount, trackedRevenueSatang, trackedCogsSatang, untrackedRevenueSatang };
}

async function computeLiveDay(
  supabase: SupabaseClient,
  storeId: string,
  businessDate: string,
  startUtc: Date,
  endUtc: Date,
): Promise<PnlDay> {
  const [disclosure, invoiceResult] = await Promise.all([
    computeItemDisclosure(supabase, storeId, startUtc, endUtc),
    supabase
      .from("purchase_invoices")
      .select("total_satang")
      .eq("store_id", storeId)
      .eq("review_status", "confirmed")
      .eq("invoice_date", businessDate),
  ]);

  const grossRevenueSatang = disclosure.orders.reduce((sum, o) => sum + o.total_satang, 0);
  const otherExpenseSatang = ((invoiceResult.data ?? []) as PurchaseInvoiceRow[]).reduce(
    (sum, row) => sum + (row.total_satang ?? 0),
    0,
  );

  const totalCogsSatang = disclosure.trackedItemCount > 0 ? disclosure.trackedCogsSatang : null;
  const netProfitSatang =
    disclosure.trackedItemCount > 0
      ? disclosure.trackedRevenueSatang - disclosure.trackedCogsSatang - otherExpenseSatang
      : null;

  return {
    businessDate,
    grossRevenueSatang,
    totalCogsSatang,
    otherExpenseSatang,
    netProfitSatang,
    orderCount: disclosure.orders.length,
    trackedItemCount: disclosure.trackedItemCount,
    totalItemCount: disclosure.totalItemCount,
    untrackedRevenueSatang: disclosure.untrackedRevenueSatang,
    source: "live",
  };
}

export async function fetchPnlDay(
  supabase: SupabaseClient,
  storeId: string,
  timezone: string,
  requestedBusinessDate?: string,
): Promise<PnlDay> {
  const today = businessDateBoundsUtc(timezone);

  if (!requestedBusinessDate || requestedBusinessDate === today.businessDate) {
    return computeLiveDay(supabase, storeId, today.businessDate, today.startUtc, today.endUtc);
  }

  // A future date should never be requestable (PnlClient disables "next"
  // once it reaches today), but guard here too rather than trusting the UI.
  if (requestedBusinessDate > today.businessDate) {
    return computeLiveDay(supabase, storeId, today.businessDate, today.startUtc, today.endUtc);
  }

  const bounds = businessDateBoundsForDateUtc(timezone, requestedBusinessDate);

  const { data: row } = await supabase
    .from("daily_financials")
    .select("gross_revenue_satang, total_cogs_satang, other_expense_satang, net_profit_satang, order_count")
    .eq("store_id", storeId)
    .eq("business_date", requestedBusinessDate)
    .maybeSingle();

  if (!row) {
    // daily_aggregate hasn't reached this date yet (new store, or the
    // worker was down at 01:00 that night) -- fall back to the same live
    // computation as today rather than showing a blank/zeroed report.
    return computeLiveDay(supabase, storeId, requestedBusinessDate, bounds.startUtc, bounds.endUtc);
  }

  const aggregate = row as DailyFinancialsRow;
  const disclosure = await computeItemDisclosure(supabase, storeId, bounds.startUtc, bounds.endUtc);

  return {
    businessDate: requestedBusinessDate,
    grossRevenueSatang: aggregate.gross_revenue_satang,
    totalCogsSatang: aggregate.total_cogs_satang,
    otherExpenseSatang: aggregate.other_expense_satang,
    netProfitSatang: aggregate.net_profit_satang,
    orderCount: aggregate.order_count,
    trackedItemCount: disclosure.trackedItemCount,
    totalItemCount: disclosure.totalItemCount,
    untrackedRevenueSatang: disclosure.untrackedRevenueSatang,
    source: "aggregate",
  };
}

export interface PnlTrendPoint {
  businessDate: string;
  netProfitSatang: number | null;
}

function priorBusinessDates(businessDate: string, count: number): string[] {
  const dates: string[] = [];
  const anchor = new Date(`${businessDate}T00:00:00Z`);
  for (let i = 1; i <= count; i++) {
    const prior = new Date(anchor.getTime());
    prior.setUTCDate(prior.getUTCDate() - i);
    dates.push(prior.toISOString().slice(0, 10));
  }
  return dates.reverse(); // oldest first
}

// 7-day trend strip ending on `day`. The 6 days before it come from
// daily_financials (one range query, not 6 live re-scans); `day` itself is
// already computed (live or aggregate) by the caller, so it's reused rather
// than fetched twice. A day with no daily_financials row (aggregate hasn't
// reached it) renders as a gap, not a fabricated 0 (RL-2's null discipline
// applies to a trend line too, not only to a single figure).
export async function fetchPnlTrend(supabase: SupabaseClient, storeId: string, day: PnlDay): Promise<PnlTrendPoint[]> {
  const priorDates = priorBusinessDates(day.businessDate, 6);

  const { data } = await supabase
    .from("daily_financials")
    .select("business_date, net_profit_satang")
    .eq("store_id", storeId)
    .in("business_date", priorDates);

  const netProfitByDate = new Map<string, number | null>(
    ((data ?? []) as Pick<Database["public"]["Tables"]["daily_financials"]["Row"], "business_date" | "net_profit_satang">[]).map(
      (r) => [r.business_date, r.net_profit_satang],
    ),
  );

  const points: PnlTrendPoint[] = priorDates.map((businessDate) => ({
    businessDate,
    netProfitSatang: netProfitByDate.get(businessDate) ?? null,
  }));
  points.push({ businessDate: day.businessDate, netProfitSatang: day.netProfitSatang });
  return points;
}
