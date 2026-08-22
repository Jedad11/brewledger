import { createServer } from "node:http";
import { pool } from "./db";
import { log } from "./log";
import { getQueueDepth, startPolling, stopPolling } from "./queue";
import { flushSentry, initSentry } from "./sentry";
import { msUntilNextRun } from "./handlers/dailyAggregate";

initSentry();

const PORT = Number(process.env.PORT ?? 10000);
const startedAt = Date.now();

// The ONLY HTTP surface on this service. Render Free spins down after 15
// minutes idle and cold-starts in 30-60 seconds — this process must never
// serve a customer-blocking request. Do not add another route here; async
// work is pulled from job_queue by the poller, not pushed over HTTP.
const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    getQueueDepth()
      .then((queueDepth) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            sha: process.env.RENDER_GIT_COMMIT ?? null,
            queueDepth,
            uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
          }),
        );
      })
      .catch((err) => {
        log.error("healthz failed", { error: err instanceof Error ? err.message : String(err) });
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false }));
      });
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

// WBS 5.6 — seeds the self-perpetuating 'expire_orders' sweep (see
// handlers/expireOrders.ts's own header) exactly once per process start.
// The WHERE NOT EXISTS guard matters on every redeploy: Render restarts
// this process often (deploys, spin-down/wake), and without it each restart
// would add a second concurrent sweep chain rather than resuming the one
// already running.
async function ensureExpireOrdersScheduled(): Promise<void> {
  await pool.query(
    `insert into job_queue (job_type, payload)
     select 'expire_orders', '{}'::jsonb
     where not exists (
       select 1 from job_queue where job_type = 'expire_orders' and status in ('pending', 'processing')
     )`,
  );
}

// WBS 7.5 — same guard as ensureExpireOrdersScheduled above: seed the
// self-perpetuating 'daily_aggregate' sweep (handlers/dailyAggregate.ts)
// exactly once per process start, so a Render redeploy resumes the existing
// nightly chain instead of adding a second one. Unlike expire_orders, the
// FIRST run is deferred to the next 01:00 Asia/Bangkok instant, not fired
// immediately — a redeploy at 14:00 must not re-aggregate today mid-day.
async function ensureDailyAggregateScheduled(): Promise<void> {
  const delayMs = msUntilNextRun(new Date());
  await pool.query(
    `insert into job_queue (job_type, payload, run_after)
     select 'daily_aggregate', '{}'::jsonb, now() + ($1 || ' milliseconds')::interval
     where not exists (
       select 1 from job_queue where job_type = 'daily_aggregate' and status in ('pending', 'processing')
     )`,
    [String(delayMs)],
  );
}

server.listen(PORT, () => {
  log.info("worker http server listening", { port: PORT });
  Promise.all([
    ensureExpireOrdersScheduled().catch((err) =>
      log.error("failed to seed expire_orders sweep", {
        error: err instanceof Error ? err.message : String(err),
      }),
    ),
    ensureDailyAggregateScheduled().catch((err) =>
      log.error("failed to seed daily_aggregate sweep", {
        error: err instanceof Error ? err.message : String(err),
      }),
    ),
  ]).finally(() => startPolling());
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info("shutdown signal received", { signal });
  server.close();
  await stopPolling();
  await pool.end();
  await flushSentry();
  log.info("shutdown complete", { signal });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
