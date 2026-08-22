// WBS 7.7 engineer leg — reconciliation test for the period-comparison
// aggregation. Not a substitute for qa_engineer's screen-level coverage;
// this is the cheap, in-scope data-correctness check the WBS's own
// Acceptance criterion asks for directly ("figures reconcile against the
// sum of the daily P&L rows for the same range" / Claude Code Prompt step 4
// "RECONCILIATION TEST").
//
// Mocked Supabase client for fetchOverviewComparison/fetchMonthlyTrend,
// same convention as WBS 7.5's fetchPnlDay.test.ts (this app has no
// real-Postgres test infrastructure yet). aggregateRange itself is a pure
// function and is exercised directly with hand-built daily_financials rows.
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aggregateRange, fetchOverviewComparison, fetchMonthlyTrend } from "./fetchOverview";
import { monthComparisonRanges, yearComparisonRanges } from "./periods";

const STORE_ID = "33333333-3333-4333-8333-333333333333";

function row(businessDate: string, overrides: Partial<{
  gross_revenue_satang: number;
  total_cogs_satang: number | null;
  other_expense_satang: number;
  net_profit_satang: number | null;
  order_count: number;
}> = {}) {
  return {
    business_date: businessDate,
    gross_revenue_satang: 1000,
    total_cogs_satang: 400,
    other_expense_satang: 100,
    net_profit_satang: 500,
    order_count: 1,
    ...overrides,
  };
}

function chainable(data: unknown) {
  const obj: Record<string, unknown> = {};
  const self = () => obj;
  obj.select = self;
  obj.eq = self;
  obj.gte = self;
  obj.lte = self;
  obj.then = (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data, error: null });
  return obj;
}

describe("aggregateRange — reconciliation", () => {
  it("REQUIRED: the aggregate over a range equals the exact-satang sum of the daily_financials rows in that range", () => {
    const rows = [
      row("2026-08-01", { gross_revenue_satang: 5000, total_cogs_satang: 2000, other_expense_satang: 300, net_profit_satang: 2700, order_count: 3 }),
      row("2026-08-02", { gross_revenue_satang: 4200, total_cogs_satang: 1800, other_expense_satang: 0, net_profit_satang: 2400, order_count: 2 }),
      row("2026-08-03", { gross_revenue_satang: 6100, total_cogs_satang: 2500, other_expense_satang: 500, net_profit_satang: 3100, order_count: 4 }),
    ];

    const aggregate = aggregateRange(rows, { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-03" });

    const expectedGross = rows.reduce((s, r) => s + r.gross_revenue_satang, 0);
    const expectedCogs = rows.reduce((s, r) => s + (r.total_cogs_satang ?? 0), 0);
    const expectedExpense = rows.reduce((s, r) => s + r.other_expense_satang, 0);
    const expectedNet = rows.reduce((s, r) => s + (r.net_profit_satang ?? 0), 0);
    const expectedOrders = rows.reduce((s, r) => s + r.order_count, 0);

    expect(aggregate.grossRevenueSatang).toBe(expectedGross);
    expect(aggregate.totalCogsSatang).toBe(expectedCogs);
    expect(aggregate.otherExpenseSatang).toBe(expectedExpense);
    expect(aggregate.netProfitSatang).toBe(expectedNet);
    expect(aggregate.orderCount).toBe(expectedOrders);
  });

  it("a day with a null total_cogs_satang/net_profit_satang (untracked items that day) poisons the whole range to null — never 0, never dropped from the sum", () => {
    const rows = [
      row("2026-08-01", { total_cogs_satang: 2000, net_profit_satang: 2700 }),
      row("2026-08-02", { total_cogs_satang: null, net_profit_satang: null }),
      row("2026-08-03", { total_cogs_satang: 2500, net_profit_satang: 3100 }),
    ];

    const aggregate = aggregateRange(rows, { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-03" });

    expect(aggregate.totalCogsSatang).toBeNull();
    expect(aggregate.netProfitSatang).toBeNull();
    // Revenue/expense/orders are still summed normally — RL-2's null
    // discipline only ever applies to cost-derived figures.
    expect(aggregate.grossRevenueSatang).toBe(3000);
    expect(aggregate.orderCount).toBe(3);
  });

  it("a business_date missing entirely from daily_financials (aggregate job hasn't reached it yet) also poisons the range to null, not a partial sum", () => {
    const rows = [row("2026-08-01"), row("2026-08-03")]; // 2026-08-02 missing

    const aggregate = aggregateRange(rows, { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-03" });

    expect(aggregate.totalCogsSatang).toBeNull();
    expect(aggregate.netProfitSatang).toBeNull();
    expect(aggregate.grossRevenueSatang).toBe(2000); // only the two present rows
  });

  it("a fully-known range with every day present produces exact numeric equality, never a float rounding drift", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row(`2026-07-${String(i + 1).padStart(2, "0")}`, {
        gross_revenue_satang: 33333,
        total_cogs_satang: 11111,
        other_expense_satang: 777,
        net_profit_satang: 33333 - 11111 - 777,
        order_count: 7,
      }),
    );

    const aggregate = aggregateRange(rows, { fromBusinessDate: "2026-07-01", toBusinessDate: "2026-07-30" });

    expect(aggregate.grossRevenueSatang).toBe(30 * 33333);
    expect(aggregate.totalCogsSatang).toBe(30 * 11111);
    expect(aggregate.netProfitSatang).toBe(30 * (33333 - 11111 - 777));
    expect(Number.isInteger(aggregate.grossRevenueSatang)).toBe(true);
    expect(Number.isInteger(aggregate.netProfitSatang)).toBe(true);
  });
});

describe("fetchOverviewComparison — end-to-end reconciliation against a mocked daily_financials table", () => {
  it("current/previous aggregates equal the exact sum of the mocked rows for each range independently", async () => {
    const currentRows = [
      row("2026-08-01", { gross_revenue_satang: 1000, total_cogs_satang: 300, other_expense_satang: 50, net_profit_satang: 650, order_count: 1 }),
      row("2026-08-02", { gross_revenue_satang: 2000, total_cogs_satang: 700, other_expense_satang: 0, net_profit_satang: 1300, order_count: 2 }),
    ];
    const previousRows = [
      row("2026-07-01", { gross_revenue_satang: 900, total_cogs_satang: 250, other_expense_satang: 20, net_profit_satang: 630, order_count: 1 }),
      row("2026-07-02", { gross_revenue_satang: 1800, total_cogs_satang: 600, other_expense_satang: 0, net_profit_satang: 1200, order_count: 2 }),
    ];

    let call = 0;
    const client = {
      from: (table: string) => {
        if (table !== "daily_financials") throw new Error(`unexpected table: ${table}`);
        call += 1;
        return chainable(call === 1 ? currentRows : previousRows);
      },
    } as unknown as SupabaseClient;

    const ranges = {
      mode: "custom" as const,
      current: { fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-02" },
      previous: { fromBusinessDate: "2026-07-01", toBusinessDate: "2026-07-02" },
      incomplete: false,
    };

    const comparison = await fetchOverviewComparison(client, STORE_ID, ranges);

    expect(comparison.current.grossRevenueSatang).toBe(3000);
    expect(comparison.current.netProfitSatang).toBe(1950);
    expect(comparison.previous.grossRevenueSatang).toBe(2700);
    expect(comparison.previous.netProfitSatang).toBe(1830);
  });
});

describe("fetchMonthlyTrend — 12-month reconciliation", () => {
  it("each month's revenue equals the exact sum of that month's rows, and a fully-present month's net profit sums exactly too", async () => {
    const rows = [
      row("2026-01-05", { gross_revenue_satang: 1000, net_profit_satang: 400 }),
      row("2026-01-06", { gross_revenue_satang: 1500, net_profit_satang: 600 }),
    ];
    const client = {
      from: (table: string) => {
        if (table !== "daily_financials") throw new Error(`unexpected table: ${table}`);
        return chainable(rows);
      },
    } as unknown as SupabaseClient;

    const trend = await fetchMonthlyTrend(client, STORE_ID, "Asia/Bangkok", "2026-01-06");

    expect(trend).toHaveLength(12);
    const jan = trend.find((t) => t.month === "2026-01");
    expect(jan?.grossRevenueSatang).toBe(2500);
    // net profit unknown for Jan because only 2 of the elapsed 6 days
    // (Jan 1-6) have a row -- never fabricated as a partial sum.
    expect(jan?.netProfitSatang).toBeNull();
    const dec = trend.find((t) => t.month === "2025-12");
    expect(dec?.grossRevenueSatang).toBe(0);
    expect(dec?.netProfitSatang).toBeNull();
  });
});

describe("comparisonRanges — like-for-like day counts", () => {
  it("a mid-month current period compares against the SAME day count in the previous month, never a full month", () => {
    const ranges = monthComparisonRanges("Asia/Bangkok", new Date("2026-08-16T10:00:00+07:00"));
    expect(ranges.current).toEqual({ fromBusinessDate: "2026-08-01", toBusinessDate: "2026-08-16" });
    expect(ranges.previous).toEqual({ fromBusinessDate: "2026-07-01", toBusinessDate: "2026-07-16" });
    expect(ranges.incomplete).toBe(true);
  });

  it("clamps the previous-month day when the current day doesn't exist there (e.g. the 31st against a 30-day month)", () => {
    const ranges = monthComparisonRanges("Asia/Bangkok", new Date("2026-08-31T10:00:00+07:00"));
    expect(ranges.previous.toBusinessDate).toBe("2026-07-31"); // July has 31 days, no clamp needed here
    const rangesMar31 = monthComparisonRanges("Asia/Bangkok", new Date("2026-03-31T10:00:00+07:00"));
    expect(rangesMar31.previous.toBusinessDate).toBe("2026-02-28"); // Feb has no 31st -- clamped
  });

  it("year mode compares like-for-like day-of-year ranges too", () => {
    const ranges = yearComparisonRanges("Asia/Bangkok", new Date("2026-08-16T10:00:00+07:00"));
    expect(ranges.current).toEqual({ fromBusinessDate: "2026-01-01", toBusinessDate: "2026-08-16" });
    expect(ranges.previous).toEqual({ fromBusinessDate: "2025-01-01", toBusinessDate: "2025-08-16" });
    expect(ranges.incomplete).toBe(true);
  });
});
