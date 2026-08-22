// WBS 7.5 — nightly 'daily_aggregate' job, writing daily_financials per
// store per business_date. Self-perpetuating, same shape as
// expireOrders.ts's own sweep (WBS 5.6): every run re-enqueues its own next
// run first, so the schedule survives even if the aggregation body below
// throws for one store. Scheduled for the next 01:00 Asia/Bangkok wall-clock
// instant rather than a fixed interval (see nextRunDelayMs below) — the
// worker's own machine clock is not assumed to be in Bangkok time.
//
// THE RULE THAT MATTERS MOST HERE (WBS 7.5's own words): an item with no
// cost snapshot is NOT free. The SQL below only sums COGS and net profit
// over order_items rows where unit_cost_snapshot_satang IS NOT NULL, and
// stores NULL (not 0) for both total_cogs_satang and net_profit_satang when
// zero lines that day are tracked — see the `case when tracked_count > 0`
// branches. RL-2.
//
// RL-2 formula note: net_profit_satang here is
//   trackedRevenue - trackedCogs - other_expense
// (tracked lines only on BOTH sides), NOT the WBS Dictionary's own literal
// prose "gross_revenue(ALL lines) - total_cogs(tracked only) - expense" —
// that formula lets an untracked line's full price inflate profit while
// wearing zero cost, the exact 100%-margin illusion RL-2 forbids. This
// matches apps/console's fetchDashboardSummary.ts (WBS 7.1) and
// fetchPnlDay.ts (WBS 7.5)'s own live-computation formula, so a merchant
// never sees the dashboard, the live "today" P&L view, and this nightly
// aggregate disagree about what today's profit was.
//
// No gateway fee term: WBS 4.8 already dropped merchants.absorb_gateway_fee,
// orders.gateway_fee_satang, and orders.fee_borne_by. Nothing here computes
// or stores one.
//
// ON CONFLICT DO UPDATE (not DO NOTHING): re-running this for a date already
// aggregated is safe and idempotent, because every column it reads
// (order_items.unit_cost_snapshot_satang / unit_price_snapshot_satang) is
// frozen at sale (trigger-protected) and never changes after the fact — a
// re-run byte-identically reproduces the same row. That is also the
// property the WBS 7.5 Acceptance criterion "historical days never change
// when ingredient costs change afterwards" is actually testing: this query
// never reads ingredients.current_unit_cost_satang at all.
import { pool } from "../db";
import { log } from "../log";
import { previousBusinessDateBoundsUtc } from "../businessDate";
import type { Job, JobHandler } from "./types";

const AGGREGATE_TIMEZONE = "Asia/Bangkok";
const AGGREGATE_HOUR = 1; // 01:00 local, per the WBS 7.5 Claude Code Prompt

const REVENUE_STATUSES = ["ACCEPTED", "PREPARING", "READY", "COLLECTED"];

// Milliseconds until the next 01:00 Asia/Bangkok wall-clock instant, however
// far off that is right now (never negative, never zero — always the NEXT
// occurrence, even if it is currently exactly 01:00:00). Exported so
// index.ts's own startup seed can schedule the FIRST run for that same
// instant instead of "immediately on process start" (unlike expire_orders,
// this job should not fire every time the worker redeploys).
export function msUntilNextRun(now: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: AGGREGATE_TIMEZONE,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === "24" ? 0 : Number(parts.hour);
  const nowSecondsOfDay = hour * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  const targetSecondsOfDay = AGGREGATE_HOUR * 3600;
  let deltaSeconds = targetSecondsOfDay - nowSecondsOfDay;
  if (deltaSeconds <= 0) deltaSeconds += 24 * 3600;
  return deltaSeconds * 1000;
}

async function aggregateStore(storeId: string, timezone: string): Promise<void> {
  const { businessDate, startUtc, endUtc } = previousBusinessDateBoundsUtc(timezone);

  await pool.query(
    `with revenue_orders as (
       select id, total_satang
         from orders
        where store_id = $1
          and status = any($2::text[])
          and created_at >= $3::timestamptz
          and created_at <  $4::timestamptz
     ),
     items as (
       select oi.quantity, oi.unit_price_snapshot_satang, oi.unit_cost_snapshot_satang
         from order_items oi
         join revenue_orders ro on ro.id = oi.order_id
     ),
     item_agg as (
       select
         count(*) filter (where unit_cost_snapshot_satang is not null)  as tracked_count,
         count(*) filter (where unit_cost_snapshot_satang is null)      as untracked_count,
         coalesce(sum(unit_price_snapshot_satang * quantity)
           filter (where unit_cost_snapshot_satang is not null), 0)     as tracked_revenue,
         coalesce(sum(unit_cost_snapshot_satang * quantity)
           filter (where unit_cost_snapshot_satang is not null), 0)     as tracked_cogs
       from items
     ),
     expense_agg as (
       select coalesce(sum(total_satang), 0) as other_expense
         from purchase_invoices
        where store_id = $1 and review_status = 'confirmed' and invoice_date = $5::date
     ),
     revenue_agg as (
       select coalesce(sum(total_satang), 0) as gross_revenue, count(*) as order_count
         from revenue_orders
     )
     insert into daily_financials
       (store_id, business_date, gross_revenue_satang, total_cogs_satang,
        untracked_item_count, other_expense_satang, net_profit_satang, order_count)
     select
       $1,
       $5::date,
       revenue_agg.gross_revenue,
       case when item_agg.tracked_count > 0 then item_agg.tracked_cogs else null end,
       item_agg.untracked_count,
       expense_agg.other_expense,
       case when item_agg.tracked_count > 0
            then item_agg.tracked_revenue - item_agg.tracked_cogs - expense_agg.other_expense
            else null end,
       revenue_agg.order_count
     from revenue_agg, item_agg, expense_agg
     on conflict (store_id, business_date) do update set
       gross_revenue_satang = excluded.gross_revenue_satang,
       total_cogs_satang    = excluded.total_cogs_satang,
       untracked_item_count = excluded.untracked_item_count,
       other_expense_satang = excluded.other_expense_satang,
       net_profit_satang    = excluded.net_profit_satang,
       order_count          = excluded.order_count`,
    [storeId, REVENUE_STATUSES, startUtc.toISOString(), endUtc.toISOString(), businessDate],
  );
}

async function allStoreTimezones(): Promise<Array<{ id: string; timezone: string }>> {
  const { rows } = await pool.query<{ id: string; timezone: string }>(`select id, timezone from stores`);
  return rows;
}

export const dailyAggregate: JobHandler = async (job: Job) => {
  // Scheduled FIRST, same reasoning as expireOrders.ts: if the aggregation
  // loop below throws for one store, the nightly chain for every future
  // night must not break with it.
  const delayMs = msUntilNextRun(new Date());
  await pool.query(
    `insert into job_queue (job_type, payload, run_after)
     values ('daily_aggregate', '{}'::jsonb, now() + ($1 || ' milliseconds')::interval)`,
    [String(delayMs)],
  );

  const stores = job.store_id
    ? [{ id: job.store_id, timezone: await storeTimezone(job.store_id) }].filter(
        (s): s is { id: string; timezone: string } => s.timezone !== null,
      )
    : await allStoreTimezones();

  let succeeded = 0;
  for (const store of stores) {
    try {
      await aggregateStore(store.id, store.timezone);
      succeeded++;
    } catch (err) {
      log.error("daily_aggregate: failed for store", {
        store_id: store.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // One bad store must not abort the sweep for the rest.
    }
  }

  log.info("daily_aggregate completed", { job_id: job.id, store_count: stores.length, succeeded });
};

async function storeTimezone(storeId: string): Promise<string | null> {
  const { rows } = await pool.query<{ timezone: string }>(`select timezone from stores where id = $1`, [storeId]);
  return rows[0]?.timezone ?? null;
}
