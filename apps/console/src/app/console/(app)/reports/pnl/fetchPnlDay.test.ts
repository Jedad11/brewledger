// WBS 7.5 qa_engineer leg — fetchPnlDay.ts (the P&L data layer).
//
// Mocked Supabase client, same convention as WBS 7.1's own
// fetchDashboardSummary.test.ts (this app has no real-Postgres test
// infrastructure yet — see that file's own header). The Postgres-backed
// half of this entry's Testing block (exact-satang reconciliation, worker
// idempotency, historical immutability against an ingredient cost change)
// lives in worker/tests/dailyAggregate.test.ts, which writes the
// daily_financials rows this file's "aggregate" read path consumes.
//
// This file's own job: prove the THREE READ PATHS branch correctly (today
// live / past-day aggregate / past-day fallback-to-live), and that the RL-2
// formula resolution documented at the top of fetchPnlDay.ts — tracked-only
// on both sides of net_profit, never the WBS Dictionary's literal
// all-revenue-minus-tracked-cogs prose — is what the live path actually
// computes.
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPnlDay, fetchPnlTrend, type PnlDay } from "./fetchPnlDay";
import { businessDateBoundsUtc } from "../../businessDate";

const STORE_ID = "22222222-2222-4222-8222-222222222222";
const TIMEZONE = "Asia/Bangkok";

const TODAY = businessDateBoundsUtc(TIMEZONE).businessDate;
function shiftDate(businessDate: string, deltaDays: number): string {
  const d = new Date(`${businessDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}
const YESTERDAY = shiftDate(TODAY, -1);
const TWO_DAYS_AGO = shiftDate(TODAY, -2);

function chainable(result: { data: unknown; single?: boolean }) {
  const obj: Record<string, unknown> = {};
  const self = () => obj;
  obj.select = self;
  obj.eq = self;
  obj.in = self;
  obj.gte = self;
  obj.lt = self;
  obj.order = self;
  obj.limit = self;
  obj.maybeSingle = () => Promise.resolve({ data: result.data, error: null });
  obj.then = (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: result.data, error: null });
  return obj;
}

interface FakeTables {
  orders?: unknown[];
  orderItems?: unknown[];
  purchaseInvoices?: unknown[];
  dailyFinancialsRow?: unknown | null; // undefined => table shouldn't be queried at all
}

function makeFakeSupabase(tables: FakeTables) {
  const calls: string[] = [];
  const from = vi.fn((table: string) => {
    calls.push(table);
    if (table === "orders") return chainable({ data: tables.orders ?? [] });
    if (table === "order_items") return chainable({ data: tables.orderItems ?? [] });
    if (table === "purchase_invoices") return chainable({ data: tables.purchaseInvoices ?? [] });
    if (table === "daily_financials") return chainable({ data: tables.dailyFinancialsRow ?? null });
    throw new Error(`unexpected table: ${table}`);
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

describe("fetchPnlDay — RL-2 disclosure states", () => {
  it("REQUIRED: an all-untracked day renders net profit and total cogs as null, never 0 — revenue and expenses still shown", async () => {
    const { client } = makeFakeSupabase({
      orders: [{ id: "o1", total_satang: 5000 }],
      orderItems: [{ quantity: 1, unit_price_snapshot_satang: 5000, unit_cost_snapshot_satang: null }],
      purchaseInvoices: [{ total_satang: 800 }],
    });

    const day = await fetchPnlDay(client, STORE_ID, TIMEZONE); // today, live

    expect(day.grossRevenueSatang).toBe(5000);
    expect(day.otherExpenseSatang).toBe(800); // expenses still shown normally
    expect(day.totalCogsSatang).toBeNull(); // NOT 0
    expect(day.netProfitSatang).toBeNull(); // NOT 0
    expect(day.trackedItemCount).toBe(0);
    expect(day.totalItemCount).toBe(1);
    expect(day.untrackedRevenueSatang).toBe(5000);
  });

  it("a partially-tracked day computes tracked-only profit and reports the untracked revenue share exactly", async () => {
    const { client } = makeFakeSupabase({
      orders: [{ id: "o1", total_satang: 14000 }],
      orderItems: [
        { quantity: 1, unit_price_snapshot_satang: 8000, unit_cost_snapshot_satang: 3000 }, // tracked
        { quantity: 1, unit_price_snapshot_satang: 6000, unit_cost_snapshot_satang: null }, // untracked
      ],
      purchaseInvoices: [{ total_satang: 1000 }],
    });

    const day = await fetchPnlDay(client, STORE_ID, TIMEZONE);

    expect(day.grossRevenueSatang).toBe(14000); // ALL revenue, including the untracked line
    expect(day.totalCogsSatang).toBe(3000); // tracked cogs only
    // 8000 (tracked revenue) - 3000 (tracked cogs) - 1000 (expense) = 4000.
    // NOT 14000 - 3000 - 1000 = 10000, which is what the WBS Dictionary's
    // own literal (all-revenue-minus-tracked-cogs) prose would produce and
    // which lets the untracked line's ฿60 wear a phantom 100% margin.
    expect(day.netProfitSatang).toBe(4000);
    expect(day.trackedItemCount).toBe(1);
    expect(day.totalItemCount).toBe(2);
    expect(day.untrackedRevenueSatang).toBe(6000);
  });

  it("a fully-tracked day has trackedItemCount === totalItemCount and zero untracked revenue", async () => {
    const { client } = makeFakeSupabase({
      orders: [{ id: "o1", total_satang: 10000 }],
      orderItems: [{ quantity: 1, unit_price_snapshot_satang: 10000, unit_cost_snapshot_satang: 4000 }],
    });

    const day = await fetchPnlDay(client, STORE_ID, TIMEZONE);

    expect(day.trackedItemCount).toBe(day.totalItemCount);
    expect(day.untrackedRevenueSatang).toBe(0);
    expect(day.netProfitSatang).toBe(6000);
  });

  it("cash-channel orders are not excluded — the query never filters on order.channel", async () => {
    // The fake order row deliberately carries no `channel` field at all
    // (fetchPnlDay.ts's own select list is "id, total_satang" — it never
    // references channel), proving inclusion doesn't depend on channel
    // being 'online'. WBS 5.12 (channel = 'cash') isn't built yet, but the
    // orders table already has the column (packages/db/migrations/0011) —
    // this guards against a future filter silently excluding it.
    const { client } = makeFakeSupabase({
      orders: [{ id: "o1", total_satang: 3000 }], // no `channel` key present
      orderItems: [{ quantity: 1, unit_price_snapshot_satang: 3000, unit_cost_snapshot_satang: 1000 }],
    });

    const day = await fetchPnlDay(client, STORE_ID, TIMEZONE);
    expect(day.grossRevenueSatang).toBe(3000);
    expect(day.orderCount).toBe(1);
  });

  it("no gateway fee field exists anywhere on the returned PnlDay (WBS 4.8 supersedes it)", async () => {
    const { client } = makeFakeSupabase({ orders: [], orderItems: [] });
    const day = await fetchPnlDay(client, STORE_ID, TIMEZONE);
    const keys = Object.keys(day);
    expect(keys.some((k) => /fee/i.test(k))).toBe(false);
  });
});

describe("fetchPnlDay — three read paths", () => {
  it("today reads live from orders/order_items, never touching daily_financials", async () => {
    const { client, calls } = makeFakeSupabase({
      orders: [{ id: "o1", total_satang: 2000 }],
      orderItems: [{ quantity: 1, unit_price_snapshot_satang: 2000, unit_cost_snapshot_satang: 500 }],
    });

    const day = await fetchPnlDay(client, STORE_ID, TIMEZONE); // no requestedBusinessDate => today

    expect(day.source).toBe("live");
    expect(day.businessDate).toBe(TODAY);
    expect(calls).not.toContain("daily_financials");
  });

  it("a past day that daily_financials already has aggregated reads the stored row verbatim, not a live recompute", async () => {
    const { client, calls } = makeFakeSupabase({
      // Live order data intentionally DISAGREES with the stored aggregate,
      // to prove the aggregate path really uses the stored row and doesn't
      // silently fall back to recomputing from orders/order_items.
      orders: [{ id: "stale", total_satang: 999_999 }],
      orderItems: [{ quantity: 1, unit_price_snapshot_satang: 999_999, unit_cost_snapshot_satang: 1 }],
      dailyFinancialsRow: {
        gross_revenue_satang: 7000,
        total_cogs_satang: 2500,
        other_expense_satang: 300,
        net_profit_satang: 4200,
        order_count: 3,
      },
    });

    const day: PnlDay = await fetchPnlDay(client, STORE_ID, TIMEZONE, YESTERDAY);

    expect(day.source).toBe("aggregate");
    expect(day.businessDate).toBe(YESTERDAY);
    expect(day.grossRevenueSatang).toBe(7000);
    expect(day.totalCogsSatang).toBe(2500);
    expect(day.otherExpenseSatang).toBe(300);
    expect(day.netProfitSatang).toBe(4200);
    expect(day.orderCount).toBe(3);
    expect(calls).toContain("daily_financials");
  });

  it("a past day the nightly aggregate hasn't reached yet falls back to a live computation, not a blank/error page", async () => {
    const { client } = makeFakeSupabase({
      dailyFinancialsRow: null, // maybeSingle() found nothing
      orders: [{ id: "o1", total_satang: 4400 }],
      orderItems: [{ quantity: 1, unit_price_snapshot_satang: 4400, unit_cost_snapshot_satang: 1100 }],
    });

    const day = await fetchPnlDay(client, STORE_ID, TIMEZONE, TWO_DAYS_AGO);

    expect(day.source).toBe("live"); // fallback, not "aggregate"
    expect(day.businessDate).toBe(TWO_DAYS_AGO); // the REQUESTED past date, not today
    expect(day.grossRevenueSatang).toBe(4400);
    expect(day.netProfitSatang).toBe(4400 - 1100);
  });

  it("a future date is never requestable — falls back to today's live figures rather than trusting the caller", async () => {
    const { client } = makeFakeSupabase({
      orders: [{ id: "o1", total_satang: 1000 }],
      orderItems: [{ quantity: 1, unit_price_snapshot_satang: 1000, unit_cost_snapshot_satang: 200 }],
    });
    const tomorrow = shiftDate(TODAY, 1);

    const day = await fetchPnlDay(client, STORE_ID, TIMEZONE, tomorrow);

    expect(day.source).toBe("live");
    expect(day.businessDate).toBe(TODAY);
  });
});

describe("fetchPnlTrend — gap discipline", () => {
  it("a business_date with no daily_financials row renders as a gap (null), never a fabricated 0", async () => {
    const day: PnlDay = {
      businessDate: TODAY,
      grossRevenueSatang: 1000,
      totalCogsSatang: 400,
      otherExpenseSatang: 0,
      netProfitSatang: 600,
      orderCount: 1,
      trackedItemCount: 1,
      totalItemCount: 1,
      untrackedRevenueSatang: 0,
      source: "live",
    };
    // Only ONE of the six prior days has a stored row; the rest must
    // surface as null gaps, not 0.
    const oneOfSix = shiftDate(TODAY, -3);
    const { client } = makeFakeSupabase({
      dailyFinancialsRow: undefined, // unused by this select (.in(), not .maybeSingle())
    });
    // fetchPnlTrend's own select uses .in(...).then(...) — override `from`
    // directly since chainable()'s daily_financials branch here is keyed to
    // maybeSingle, not the array shape fetchPnlTrend needs.
    (client.from as unknown as (t: string) => unknown) = ((table: string) => {
      if (table !== "daily_financials") throw new Error(`unexpected table: ${table}`);
      const obj: Record<string, unknown> = {};
      const self = () => obj;
      obj.select = self;
      obj.eq = self;
      obj.in = self;
      obj.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        resolve({
          data: [{ business_date: oneOfSix, net_profit_satang: 900 }],
          error: null,
        });
      return obj;
    }) as never;

    const trend = await fetchPnlTrend(client, STORE_ID, day);

    expect(trend).toHaveLength(7); // 6 prior days + `day` itself
    const found = trend.find((t) => t.businessDate === oneOfSix);
    expect(found?.netProfitSatang).toBe(900);
    const gaps = trend.filter((t) => t.businessDate !== oneOfSix && t.businessDate !== TODAY);
    expect(gaps.every((g) => g.netProfitSatang === null)).toBe(true);
    expect(trend[trend.length - 1]).toEqual({ businessDate: TODAY, netProfitSatang: 600 });
  });
});
