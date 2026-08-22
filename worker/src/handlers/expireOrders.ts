// WBS 5.6 — "An order not confirmed within its window expires automatically
// and returns its slot to the pool." No cron/pg_cron infrastructure exists
// in this repo (render.yaml runs one `web` service; the poller in
// worker/src/queue.ts only claims rows already sitting in job_queue). This
// handler is deliberately SELF-PERPETUATING: every run re-enqueues its own
// next run one minute out, so the sweep keeps going as long as the worker
// process is up, using the same job_queue table and poller every other job
// type already goes through -- no second scheduling mechanism invented.
// worker/src/index.ts seeds the first run at process startup.
//
// WBS 5.7 refactor: the sweep body no longer writes orders.status directly.
// A bulk `UPDATE ... RETURNING` could never call a per-row plpgsql guard, so
// this is now a per-row loop through transition_order() (packages/db/
// migrations/0032_order_status_history.sql) over this worker's own raw pg
// connection -- the same way it already calls release_pickup_slot. See
// docs/db/wbs_5_7_lifecycle_design.md §6.
import { pool } from "../db";
import { log } from "../log";
import type { Job, JobHandler } from "./types";

const SWEEP_INTERVAL_MINUTES = 1;

export const expireOrders: JobHandler = async (job: Job) => {
  // Scheduled FIRST, before the sweep body runs: if the sweep below throws,
  // queue.ts's own retry/backoff still applies to THIS job, but the chain of
  // future sweeps is not broken by it -- a duplicate "next" job on retry is
  // harmless (see comment on the UPDATE below), a missing one would silently
  // stop the sweep forever after 5 failed attempts.
  await pool.query(
    `insert into job_queue (job_type, payload, run_after)
     values ('expire_orders', '{}'::jsonb, now() + ($1 || ' minutes')::interval)`,
    [String(SWEEP_INTERVAL_MINUTES)],
  );

  // Read-only select, capped at 100 per the WBS 5.7 prompt -- this handler
  // re-enqueues itself every minute (above), so a store with more than 100
  // simultaneously-expired orders is caught up within a few more sweeps
  // rather than this run holding an unbounded, long-running transaction.
  const { rows } = await pool.query<{ id: string }>(
    `select id from orders
      where status = 'PENDING_PAYMENT' and expires_at < now()
      limit 100`,
  );

  let expiredCount = 0;
  for (const { id } of rows) {
    try {
      // Each call is already one atomic unit -- transition_order()'s own
      // body is a single implicit Postgres transaction (its FOR UPDATE row
      // lock, the map check, release_pickup_slot, and the history write all
      // happen inside it) -- so no outer BEGIN/COMMIT is needed around this
      // loop, and one bad row cannot leave another half-transitioned.
      await pool.query(`select transition_order($1, 'EXPIRED', null, 'system')`, [id]);
      expiredCount++;
    } catch (err) {
      if ((err as { code?: string }).code === "BL001") {
        // The row left PENDING_PAYMENT between the select above and this
        // call -- e.g. a merchant's own "ยังไม่ได้รับเงิน" (console_reject_payment)
        // or a confirm racing the same order. Not a sweep failure.
        log.info("expire_orders: order already left PENDING_PAYMENT, skipping", { order_id: id });
        continue;
      }
      log.error("expire_orders: transition failed for order", { order_id: id, error: String(err) });
      // Do not rethrow -- one bad row must not abort the sweep for the
      // other rows in this batch.
    }
  }

  log.info("expire_orders swept", { job_id: job.id, expired_count: expiredCount });
};
