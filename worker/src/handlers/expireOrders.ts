// WBS 5.6 — "An order not confirmed within its window expires automatically
// and returns its slot to the pool." No cron/pg_cron infrastructure exists
// in this repo (render.yaml runs one `web` service; the poller in
// worker/src/queue.ts only claims rows already sitting in job_queue). This
// handler is deliberately SELF-PERPETUATING: every run re-enqueues its own
// next run one minute out, so the sweep keeps going as long as the worker
// process is up, using the same job_queue table and poller every other job
// type already goes through -- no second scheduling mechanism invented.
// worker/src/index.ts seeds the first run at process startup.
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

  const client = await pool.connect();
  let expiredCount = 0;
  try {
    await client.query("BEGIN");

    // One statement, not a SELECT-then-UPDATE: the UPDATE's own WHERE
    // clause (status = 'PENDING_PAYMENT') is the same idempotency guard
    // console_confirm_payment/console_reject_payment use (packages/db/
    // migrations/0031_payment_confirmation.sql) -- an order a merchant
    // confirms or rejects between sweeps simply no longer matches and is
    // left untouched, no race window to close by hand here.
    const { rows } = await client.query<{ id: string; pickup_slot_id: string | null }>(
      `update orders
          set status = 'EXPIRED'
        where status = 'PENDING_PAYMENT'
          and expires_at < now()
        returning id, pickup_slot_id`,
    );

    for (const row of rows) {
      if (row.pickup_slot_id) {
        await client.query(`select release_pickup_slot($1)`, [row.pickup_slot_id]);
      }
      expiredCount++;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  log.info("expire_orders swept", { job_id: job.id, expired_count: expiredCount });
};
