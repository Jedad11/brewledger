import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { getHandler } from "./handlers";
import type { Job } from "./handlers/types";
import { log } from "./log";
import { captureError } from "./sentry";
import { AlertDebouncer, sendAlert } from "@brewledger/shared/dist/alert";

const POLL_INTERVAL_MS = 30_000;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_SECONDS = 30;

// WBS 3.11: one alert per (condition, storeId) per 15-minute window, so a
// job that keeps landing back in the queue and failing again doesn't spam
// the channel with one message per attempt. In-memory, scoped to this
// process — see packages/shared/src/alert.ts's header for the >1-instance
// caveat. ALERT_WEBHOOK_URL is intentionally read directly from
// process.env rather than through the WBS 3.9 config loaders: it is
// observability, not a correctness dependency, and must degrade to a
// no-op (see sendAlert) rather than crash worker startup when absent —
// unlike the hard-required secrets in loadWorkerConfig().
const jobFailedAlerts = new AlertDebouncer();

export const workerId = `${process.env.RENDER_INSTANCE_ID ?? "local"}-${randomUUID().slice(0, 8)}`;

let stopping = false;
let inFlight: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastKnownQueueDepth = 0;

// Only known status atomically claimed by FOR UPDATE SKIP LOCKED — two
// worker instances can never claim the same row. Do not replace this with
// a read-then-write ("optimistic") pattern; see WBS 3.3.
async function claimJob(): Promise<Job | null> {
  const { rows } = await pool.query<Job & { status: string }>(
    `UPDATE job_queue SET status='processing', attempts=attempts+1,
            claimed_at=now(), claimed_by=$1
     WHERE id = (
       SELECT id FROM job_queue
       WHERE status='pending' AND (run_after IS NULL OR run_after <= now())
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, store_id, job_type, payload, attempts`,
    [workerId],
  );
  return rows[0] ?? null;
}

// AggregateError (thrown by Node's happy-eyeballs dual-stack connect when
// every attempt fails, e.g. an IPv6-only host from a v4-only egress) has
// `.message === ""` at the top level — the real reason lives in `.errors`.
// Without this, every DB-unreachable failure logs as an unhelpful `{"error":""}`.
function describeError(err: unknown): string {
  if (err instanceof AggregateError) {
    return err.errors.map((e) => (e instanceof Error ? e.message : String(e))).join("; ");
  }
  return err instanceof Error ? err.message : String(err);
}

function backoffSeconds(attempts: number): number {
  return Math.min(BASE_BACKOFF_SECONDS * 2 ** (attempts - 1), 3600);
}

async function markDone(jobId: string): Promise<void> {
  await pool.query(
    `UPDATE job_queue SET status='done', processed_at=now() WHERE id=$1`,
    [jobId],
  );
}

async function markFailed(job: Job, error: unknown): Promise<void> {
  const message = describeError(error);
  if (job.attempts < MAX_ATTEMPTS) {
    const delay = backoffSeconds(job.attempts);
    await pool.query(
      `UPDATE job_queue
       SET status='pending', last_error=$2, run_after=now() + ($3 || ' seconds')::interval
       WHERE id=$1`,
      [job.id, message, String(delay)],
    );
  } else {
    await pool.query(
      `UPDATE job_queue SET status='failed', last_error=$2, processed_at=now() WHERE id=$1`,
      [job.id, message],
    );
    await sendAlert(
      {
        condition: "job_failed_final",
        storeId: job.store_id,
        message: `job ${job.id} (${job.job_type}) failed permanently after ${MAX_ATTEMPTS} attempts`,
        detail: { jobId: job.id, jobType: job.job_type, attempts: job.attempts, lastError: message },
      },
      {
        webhookUrl: process.env.ALERT_WEBHOOK_URL,
        debouncer: jobFailedAlerts,
        runtime: "worker",
        logger: log,
      },
    );
  }
}

async function processOne(): Promise<boolean> {
  const job = await claimJob();
  if (!job) return false;

  const handler = getHandler(job.job_type);
  if (!handler) {
    log.error("no handler registered for job_type", { job_id: job.id, job_type: job.job_type });
    await markFailed(job, new Error(`no handler registered for job_type '${job.job_type}'`));
    return true;
  }

  try {
    log.info("job claimed", { job_id: job.id, job_type: job.job_type, attempts: job.attempts });
    await handler(job);
    await markDone(job.id);
    log.info("job done", { job_id: job.id, job_type: job.job_type });
  } catch (err) {
    log.error("job failed", {
      job_id: job.id,
      job_type: job.job_type,
      error: describeError(err),
    });
    captureError(err, { job_id: job.id, job_type: job.job_type, attempts: job.attempts });
    await markFailed(job, err);
  }
  return true;
}

async function tick(): Promise<void> {
  if (stopping) return;
  const work = (async () => {
    try {
      // Drain everything currently pending before sleeping again, instead of
      // claiming exactly one job per 30s tick.
      while (!stopping && (await processOne())) {
        /* keep draining */
      }
    } catch (err) {
      log.error("poller tick error", { error: describeError(err) });
    }
  })();
  inFlight = work;
  await work;
  inFlight = null;
  if (!stopping) {
    timer = setTimeout(tick, POLL_INTERVAL_MS);
  }
}

export function startPolling(): void {
  log.info("poller started", { worker_id: workerId, interval_ms: POLL_INTERVAL_MS });
  void tick();
}

// Stops claiming new jobs and waits for the current in-flight job to finish.
// Render sends SIGTERM on deploy and on spin-down — this is what keeps a job
// from being abandoned mid-processing.
export async function stopPolling(): Promise<void> {
  stopping = true;
  if (timer) clearTimeout(timer);
  if (inFlight) {
    log.info("waiting for in-flight job to finish before shutdown");
    await inFlight;
  }
  log.info("poller stopped", { worker_id: workerId });
}

export async function getQueueDepth(): Promise<number> {
  try {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM job_queue WHERE status='pending' AND (run_after IS NULL OR run_after <= now())`,
    );
    lastKnownQueueDepth = Number(rows[0]?.count ?? 0);
  } catch (err) {
    log.error("queue depth check failed", { error: describeError(err) });
  }
  return lastKnownQueueDepth;
}
