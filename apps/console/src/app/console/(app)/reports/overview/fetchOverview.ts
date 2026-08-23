// WBS 7.7 — Period Comparison data layer. Reads daily_financials ONLY (a
// SUM over the pre-aggregated table, per WBS 7.8's own design note that
// reports should prefer it over a live join across orders/order_items) —
// unlike WBS 7.5's fetchPnlDay.ts, this file has no "live" read path at all,
// because a comparison is always over at least one full closed range and
// daily_financials is written nightly for every store/date by
// worker/src/handlers/dailyAggregate.ts.
//
// RL-2 null discipline, extended from a single day to a RANGE: a day
// dailyAggregate hasn't reached yet (new store, worker downtime overnight)
// is NOT the same as a day with zero orders — dailyAggregate always inserts
// a row for every store every night (see its own header comment), so a
// MISSING row means "we don't have a number for that day yet", exactly like
// an untracked day's null total_cogs_satang/net_profit_satang. Both cases
// poison totalCogsSatang/netProfitSatang for the WHOLE requested range to
// null — never silently dropped from the sum, never coerced to 0.
// grossRevenueSatang/otherExpenseSatang/orderCount are NOT poisoned this way
// (they are simple positive sums, never subject to RL-2's cost-unknown
// rule) — they sum whatever rows are actually present, same as
// fetchPnlDay.ts always shows a day's gross revenue even on an all-untracked
// day.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@brewledger/db/types";
import type { ComparisonRanges, DateRange } from "./periods";

type DailyFinancialsRow = Pick<
  Database["public"]["Tables"]["daily_financials"]["Row"],
  "business_date" | "gross_revenue_satang" | "total_cogs_satang" | "other_expense_satang" | "net_profit_satang" | "order_count"
>;

export interface PeriodAggregate {
  fromBusinessDate: string;
  toBusinessDate: string;
  grossRevenueSatang: number;
  /** null when any business_date in the range is missing from daily_financials or itself carries a null cost (RL-2) — never coerced to 0. */
  totalCogsSatang: number | null;
  otherExpenseSatang: number;
  /** Same null discipline as totalCogsSatang. */
  netProfitSatang: number | null;
  orderCount: number;
}

export interface OverviewComparison {
  ranges: ComparisonRanges;
  current: PeriodAggregate;
  previous: PeriodAggregate;
}

function expectedBusinessDates(fromBusinessDate: string, toBusinessDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${fromBusinessDate}T00:00:00Z`);
  const end = new Date(`${toBusinessDate}T00:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

// Pure — exported so fetchOverview.test.ts can assert the reconciliation
// property (sum of daily_financials rows for a range === this function's
// output for that same range) without a live Supabase client.
export function aggregateRange(rows: DailyFinancialsRow[], range: DateRange): PeriodAggregate {
  const byDate = new Map(rows.map((r) => [r.business_date, r]));
  const expected = expectedBusinessDates(range.fromBusinessDate, range.toBusinessDate);

  let grossRevenueSatang = 0;
  let otherExpenseSatang = 0;
  let orderCount = 0;
  let cogsSumSatang = 0;
  let netSumSatang = 0;
  let cogsKnown = true;
  let netKnown = true;

  for (const businessDate of expected) {
    const row = byDate.get(businessDate);
    if (!row) {
      cogsKnown = false;
      netKnown = false;
      continue;
    }
    grossRevenueSatang += row.gross_revenue_satang;
    otherExpenseSatang += row.other_expense_satang;
    orderCount += row.order_count;
    if (row.total_cogs_satang === null) {
      cogsKnown = false;
    } else {
      cogsSumSatang += row.total_cogs_satang;
    }
    if (row.net_profit_satang === null) {
      netKnown = false;
    } else {
      netSumSatang += row.net_profit_satang;
    }
  }

  return {
    fromBusinessDate: range.fromBusinessDate,
    toBusinessDate: range.toBusinessDate,
    grossRevenueSatang,
    otherExpenseSatang,
    orderCount,
    totalCogsSatang: cogsKnown ? cogsSumSatang : null,
    netProfitSatang: netKnown ? netSumSatang : null,
  };
}

async function fetchDailyFinancialsRange(
  supabase: SupabaseClient,
  storeId: string,
  range: DateRange,
): Promise<DailyFinancialsRow[]> {
  const { data } = await supabase
    .from("daily_financials")
    .select("business_date, gross_revenue_satang, total_cogs_satang, other_expense_satang, net_profit_satang, order_count")
    .eq("store_id", storeId)
    .gte("business_date", range.fromBusinessDate)
    .lte("business_date", range.toBusinessDate);
  return (data ?? []) as DailyFinancialsRow[];
}

export async function fetchPeriodAggregate(
  supabase: SupabaseClient,
  storeId: string,
  range: DateRange,
): Promise<PeriodAggregate> {
  const rows = await fetchDailyFinancialsRange(supabase, storeId, range);
  return aggregateRange(rows, range);
}

export async function fetchOverviewComparison(
  supabase: SupabaseClient,
  storeId: string,
  ranges: ComparisonRanges,
): Promise<OverviewComparison> {
  const [current, previous] = await Promise.all([
    fetchPeriodAggregate(supabase, storeId, ranges.current),
    fetchPeriodAggregate(supabase, storeId, ranges.previous),
  ]);
  return { ranges, current, previous };
}

export interface MonthlyTrendPoint {
  /** YYYY-MM. */
  month: string;
  grossRevenueSatang: number;
  /** null when any day that month is missing from daily_financials or carries a null cost (RL-2). */
  netProfitSatang: number | null;
}

function monthKeysEndingAt(businessDate: string, count: number): string[] {
  const [y, m] = businessDate.split("-").map(Number);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`);
  }
  return keys;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// 12-month trend for the grouped bar chart. Reads the single widest range
// once (12 calendar months back through today) rather than 12 separate
// queries, same "one range query, not N re-scans" posture as WBS 7.5's
// fetchPnlTrend.
export async function fetchMonthlyTrend(
  supabase: SupabaseClient,
  storeId: string,
  timeZone: string,
  todayBusinessDate: string,
): Promise<MonthlyTrendPoint[]> {
  const monthKeys = monthKeysEndingAt(todayBusinessDate, 12);
  const fromBusinessDate = `${monthKeys[0]}-01`;

  const { data } = await supabase
    .from("daily_financials")
    .select("business_date, gross_revenue_satang, total_cogs_satang, other_expense_satang, net_profit_satang, order_count")
    .eq("store_id", storeId)
    .gte("business_date", fromBusinessDate)
    .lte("business_date", todayBusinessDate);

  const rows = (data ?? []) as DailyFinancialsRow[];
  const byMonth = new Map<string, DailyFinancialsRow[]>();
  for (const row of rows) {
    const key = row.business_date.slice(0, 7);
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(row);
    else byMonth.set(key, [row]);
  }

  return monthKeys.map((month) => {
    const monthRows = byMonth.get(month) ?? [];
    const grossRevenueSatang = monthRows.reduce((sum, r) => sum + r.gross_revenue_satang, 0);
    const daysInThisMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const isCurrentMonth = month === todayBusinessDate.slice(0, 7);
    const expectedDayCount = isCurrentMonth ? Number(todayBusinessDate.slice(8, 10)) : daysInThisMonth;
    const netKnown = monthRows.length === expectedDayCount && monthRows.every((r) => r.net_profit_satang !== null);
    const netProfitSatang = netKnown ? monthRows.reduce((sum, r) => sum + (r.net_profit_satang ?? 0), 0) : null;
    return { month, grossRevenueSatang, netProfitSatang };
  });
}
