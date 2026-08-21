import { createServer } from "node:http";
import { pool } from "./db";
import { log } from "./log";
import { getQueueDepth, startPolling, stopPolling } from "./queue";
import { flushSentry, initSentry } from "./sentry";

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

server.listen(PORT, () => {
  log.info("worker http server listening", { port: PORT });
  ensureExpireOrdersScheduled()
    .catch((err) =>
      log.error("failed to seed expire_orders sweep", {
        error: err instanceof Error ? err.message : String(err),
      }),
    )
    .finally(() => startPolling());
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
