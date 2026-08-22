// WBS 7.1 Claude Code Prompt step 2, verbatim requirement: "Write a test
// that loads the dashboard for a store with zero bom_lines and asserts:
// revenue renders, order count renders, no error is thrown, and profit is
// '—' not '0'." fetchDashboardSummary is the data layer that decision is
// made in (DashboardClient/DashboardView just render whatever this
// function returns) — its own zero-BOM test is this file's; the render
// side of that same assertion (profit literally shows the "—" glyph, not
// the string "0") lives in DashboardClient.test.tsx.
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDashboardSummary } from "./fetchDashboardSummary";

const STORE_ID = "11111111-1111-4111-8111-111111111111";

function chainable(result: { data: unknown[] }) {
  const obj: Record<string, unknown> = {};
  const self = () => obj;
  obj.select = self;
  obj.eq = self;
  obj.in = self;
  obj.gte = self;
  obj.lt = self;
  obj.gt = self;
  obj.order = self;
  obj.limit = self;
  obj.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
    resolve({ data: result.data, error: null });
  return obj;
}

function makeFakeSupabase(tables: {
  ordersRevenue: unknown[];
  ordersWorkingQueue: unknown[];
  orderItems?: unknown[];
  purchaseInvoices?: unknown[];
  pickupSlots?: unknown[];
}) {
  let ordersCallCount = 0;
  const from = vi.fn((table: string) => {
    if (table === "orders") {
      ordersCallCount += 1;
      // fetchDashboardSummary.ts queries "orders" twice, in this order:
      // the revenue query (today, paid statuses), then the working-queue
      // query (live ACCEPTED/PREPARING/READY, no date bound).
      return chainable({ data: ordersCallCount === 1 ? tables.ordersRevenue : tables.ordersWorkingQueue });
    }
    if (table === "order_items") return chainable({ data: tables.orderItems ?? [] });
    if (table === "purchase_invoices") return chainable({ data: tables.purchaseInvoices ?? [] });
    if (table === "pickup_slots") return chainable({ data: tables.pickupSlots ?? [] });
    throw new Error(`unexpected table: ${table}`);
  });
  return { from } as unknown as SupabaseClient;
}

describe("fetchDashboardSummary", () => {
  it("REQUIRED (RL-2): a store with zero bom_lines still gets revenue and order count, with profit null (not 0)", async () => {
    const supabase = makeFakeSupabase({
      ordersRevenue: [
        { id: "o1", total_satang: 8000, status: "ACCEPTED" },
        { id: "o2", total_satang: 6000, status: "COLLECTED" },
      ],
      ordersWorkingQueue: [{ id: "o1", total_satang: 8000, status: "ACCEPTED" }],
      // Every line lacks a cost snapshot -- the zero-bom_lines store.
      orderItems: [
        { quantity: 1, unit_price_snapshot_satang: 8000, unit_cost_snapshot_satang: null },
        { quantity: 1, unit_price_snapshot_satang: 6000, unit_cost_snapshot_satang: null },
      ],
    });

    const summary = await fetchDashboardSummary(supabase, STORE_ID, "Asia/Bangkok");

    expect(summary.revenueSatang).toBe(14000);
    expect(summary.orderCounts).toEqual({ waiting: 1, preparing: 0, ready: 0 });
    expect(summary.profitSatang).toBeNull();
    expect(summary.trackedItemCount).toBe(0);
    expect(summary.totalItemCount).toBe(2);
  });

  it("computes profit only from tracked lines when some items have no cost snapshot", async () => {
    const supabase = makeFakeSupabase({
      ordersRevenue: [{ id: "o1", total_satang: 14000, status: "COLLECTED" }],
      ordersWorkingQueue: [],
      orderItems: [
        { quantity: 1, unit_price_snapshot_satang: 8000, unit_cost_snapshot_satang: 3000 }, // tracked
        { quantity: 1, unit_price_snapshot_satang: 6000, unit_cost_snapshot_satang: null }, // untracked
      ],
      purchaseInvoices: [{ total_satang: 1000 }],
    });

    const summary = await fetchDashboardSummary(supabase, STORE_ID, "Asia/Bangkok");

    expect(summary.revenueSatang).toBe(14000);
    expect(summary.expensesSatang).toBe(1000);
    expect(summary.trackedItemCount).toBe(1);
    expect(summary.totalItemCount).toBe(2);
    // 8000 (tracked revenue) - 3000 (tracked cogs) - 1000 (expenses) = 4000
    expect(summary.profitSatang).toBe(4000);
  });

  it("an order with zero live orders returns 0/0/0 order counts, not an error", async () => {
    const supabase = makeFakeSupabase({ ordersRevenue: [], ordersWorkingQueue: [] });

    const summary = await fetchDashboardSummary(supabase, STORE_ID, "Asia/Bangkok");

    expect(summary.revenueSatang).toBe(0);
    expect(summary.orderCounts).toEqual({ waiting: 0, preparing: 0, ready: 0 });
    expect(summary.profitSatang).toBeNull();
  });
});
