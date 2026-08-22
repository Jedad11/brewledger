// WBS 7.8 — CI performance smoke test skeleton.
//
// engineer-built harness per WBS 7.8's own Acceptance criteria ("run each
// report query against the fixture, fail the build if any exceeds 3 seconds
// ... assert this by parsing EXPLAIN output"). qa_engineer owns validating
// and extending this per the WBS's Testing block — see PROGRESS.md's WBS 7.8
// row for the exact boundary: this file proves the harness works end-to-end
// for WBS 7.1 (the only report query that exists today, live at commit
// cc91fb3's fetchDashboardSummary.ts); WBS 7.5/7.6/7.7 sections are stubs
// that must be filled in once those entries land, not fabricated now.
//
// Requires the WBS 7.8 performance fixture (`pnpm db:perf-seed`) already
// loaded against the local stack — this is NOT `packages/db/seed.sql`'s tiny
// demo-cafe fixture, which is far too small to expose a bad plan. Skips
// (never fails) when either the local stack or the perf fixture isn't
// present, same posture as every other packages/db/tests/*.test.ts file
// hitting the "no reachable local Postgres" wall documented in PROGRESS.md.
import { describe, it, expect, beforeAll } from "vitest";
import type { Client } from "pg";
import { connect, isReachable } from "../helpers/db";

const P95_TARGET_MS = 2000;
const CI_FAIL_THRESHOLD_MS = 3000;
const PERF_STORE_SLUG = "perf-fixture-store";

interface TimedPlan {
  planLines: string[];
  wallTimeMs: number;
}

async function explainAnalyze(client: Client, sql: string, params: unknown[]): Promise<TimedPlan> {
  const start = performance.now();
  const result = await client.query<{ "QUERY PLAN": string }>(
    `explain (analyze, buffers, format text) ${sql}`,
    params,
  );
  const wallTimeMs = performance.now() - start;
  const planLines = result.rows.map((r) => r["QUERY PLAN"]);
  return { planLines, wallTimeMs };
}

function assertNoSeqScanOn(planLines: string[], tables: string[]): void {
  for (const table of tables) {
    const offending = planLines.find((line) =>
      new RegExp(`Seq Scan on\\s+\\S*\\b${table}\\b`, "i").test(line),
    );
    expect(
      offending,
      `Expected no Seq Scan on "${table}", found: ${offending ?? "(none)"}\nFull plan:\n${planLines.join("\n")}`,
    ).toBeUndefined();
  }
}

function assertWithinBudget(wallTimeMs: number, label: string): void {
  expect(
    wallTimeMs,
    `${label} took ${wallTimeMs.toFixed(0)}ms, over the ${CI_FAIL_THRESHOLD_MS}ms CI-fail threshold`,
  ).toBeLessThan(CI_FAIL_THRESHOLD_MS);
  if (wallTimeMs > P95_TARGET_MS) {
    // Over the 2s p95 target but under the 3s CI-fail threshold: warn, don't
    // fail — this is the headroom band the WBS's own step 5 describes.
    console.warn(`${label}: ${wallTimeMs.toFixed(0)}ms exceeds the ${P95_TARGET_MS}ms p95 target (not failing).`);
  }
}

describe("WBS 7.8 — reporting query performance", () => {
  let reachable = false;
  let fixturePresent = false;
  let storeId: string | undefined;

  beforeAll(async () => {
    reachable = await isReachable();
    if (!reachable) return;
    const client = await connect();
    try {
      const result = await client.query<{ id: string }>(
        "select id from stores where slug = $1",
        [PERF_STORE_SLUG],
      );
      fixturePresent = result.rows.length > 0;
      storeId = result.rows[0]?.id;
    } finally {
      await client.end();
    }
  });

  describe("WBS 7.1 — dashboard summary (fetchDashboardSummary.ts)", () => {
    it("revenue query: orders by store_id + status + created_at window", async () => {
      if (!reachable || !fixturePresent) return;
      const client = await connect();
      try {
        const { planLines, wallTimeMs } = await explainAnalyze(
          client,
          `select id, total_satang, status from orders
           where store_id = $1
             and status in ('ACCEPTED','PREPARING','READY','COLLECTED')
             and created_at >= now() - interval '1 day'
             and created_at < now()`,
          [storeId],
        );
        assertNoSeqScanOn(planLines, ["orders"]);
        assertWithinBudget(wallTimeMs, "7.1 revenue query");
      } finally {
        await client.end();
      }
    });

    it("working queue query: orders by store_id + working statuses", async () => {
      if (!reachable || !fixturePresent) return;
      const client = await connect();
      try {
        const { planLines, wallTimeMs } = await explainAnalyze(
          client,
          `select id, total_satang, status from orders
           where store_id = $1
             and status in ('ACCEPTED','PREPARING','READY')`,
          [storeId],
        );
        assertNoSeqScanOn(planLines, ["orders"]);
        assertWithinBudget(wallTimeMs, "7.1 working queue query");
      } finally {
        await client.end();
      }
    });

    it("order_items cost rollup for today's revenue orders", async () => {
      if (!reachable || !fixturePresent) return;
      const client = await connect();
      try {
        const orderIdsResult = await client.query<{ id: string }>(
          `select id from orders
           where store_id = $1
             and status in ('ACCEPTED','PREPARING','READY','COLLECTED')
             and created_at >= now() - interval '1 day'`,
          [storeId],
        );
        const orderIds = orderIdsResult.rows.map((r) => r.id);
        if (orderIds.length === 0) return; // nothing sold "today" in the fixture window
        const { planLines, wallTimeMs } = await explainAnalyze(
          client,
          `select quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang
           from order_items where order_id = any($1::uuid[])`,
          [orderIds],
        );
        assertNoSeqScanOn(planLines, ["order_items"]);
        assertWithinBudget(wallTimeMs, "7.1 order_items cost rollup");
      } finally {
        await client.end();
      }
    });

    it("purchase_invoices expense query for today", async () => {
      if (!reachable || !fixturePresent) return;
      const client = await connect();
      try {
        const { wallTimeMs } = await explainAnalyze(
          client,
          `select total_satang from purchase_invoices
           where store_id = $1 and review_status = 'confirmed' and invoice_date = current_date`,
          [storeId],
        );
        assertWithinBudget(wallTimeMs, "7.1 purchase_invoices expense query");
      } finally {
        await client.end();
      }
    });
  });

  // WBS 7.5 (daily P&L), 7.6 (profit per dish), 7.7 (period comparison) are
  // not implemented yet as of this entry (WBS 7.8) — their queries do not
  // exist to measure. qa_engineer: fill these in against the real query as
  // each entry lands, per the WBS's own "Adding a new report requires adding
  // its plan to the same document [and this harness]" acceptance line. Do
  // not fabricate a plan for a query that doesn't exist.
  describe.skip("WBS 7.5 — daily P&L (pending, not yet implemented)", () => {
    it.todo("measure the daily_financials read / live-fallback query once WBS 7.5 lands");
  });

  describe.skip("WBS 7.6 — profit per dish (pending, not yet implemented)", () => {
    it.todo("measure the order_items x menu_items rollup once WBS 7.6 lands");
  });

  describe.skip("WBS 7.7 — period comparison (pending, not yet implemented)", () => {
    it.todo("measure the two-window comparison query once WBS 7.7 lands");
  });
});
