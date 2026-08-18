# Observability, logging and alerting

WBS 3.11. Covers `packages/shared/src/log.ts` (structured logging + mandatory
redaction), `packages/shared/src/alert.ts` (debounced incident alerting),
Sentry wiring, and correlation ids. Read this before adding a log line that
touches a database row, a secret, or anything cost-shaped.

## Why this exists

A failed payment confirmation or a stuck job needs to be diagnosable without
a database session — but the logs themselves must never become an RL-3 leak.
Two rules carry real risk and are enforced in code, not left to call-site
discipline:

1. **Never log a secret.** A stray `console.log(job)` must not be how the
   `service_role` key ends up in Render's or Supabase's log dashboard.
2. **Never log a whole row.** An `orders` row joined to `order_items` carries
   `unit_cost_snapshot_satang`. A merchant-only field reaching a log line is
   an RL-3 leak even when the code path that read the row was legitimate.

**Supabase free tier retains logs for about one day.** Anything needed for a
post-incident writeup later must be captured to an external sink (Sentry) at
the moment it happens — you cannot go back and pull it from Supabase a week
later.

## Log schema

Every log line is one JSON object, one per line, shaped:

```json
{
  "ts": "2026-08-18T23:09:58.076Z",
  "level": "info | warn | error | debug",
  "runtime": "public | console | worker | edge | system",
  "msg": "human-readable message",
  "correlationId": "…",
  "storeId": "…",
  "orderId": "…",
  "jobId": "…"
}
```

`runtime` matters — it's what the RL-3 redaction rule below keys off. Extra
fields beyond the ones shown are allowed (see the 12-key cap below), but
`ts`/`level`/`runtime`/`msg` are always present.

Produced by `createLogger(runtime, base?, emit?)` in `packages/shared/src/log.ts`:

```ts
import { createLogger } from "@brewledger/shared/dist/log";

const log = createLogger("worker");
log.info("job claimed", { jobId: job.id, jobType: job.job_type });

const jobLog = log.child({ jobId: job.id, correlationId: job.payload.correlation_id });
jobLog.error("handler threw", { error: message });
```

## Redaction rules, and why each one exists

Applied to every field object before it reaches the emitter — there is no
logging path that bypasses this.

| Rule | Scope | Why |
|---|---|---|
| Drop any key matching `/key\|secret\|token\|password\|authorization\|service_role/i` | Every runtime, always | A credential in a log line is a credential leak regardless of which surface logged it. |
| Drop any key matching `/cost\|margin\|profit\|unit_cost\|snapshot\|fee_satang/i` | Only when `runtime === "public"` | RL-3: a Customer Web request must never cause cost/margin data to reach a log sink — not even redacted-with-a-marker, not at any log level. **Scoped deliberately** — `console`, `worker`, `edge`, and `system` runtimes legitimately need to see cost fields to diagnose a costing bug (WBS 6.x/7.x); global redaction would make those entries un-diagnosable. Re-read the WBS 3.11 text before "fixing" this to be global — it names `runtime === 'public'` specifically. |
| Reject a fields object with more than 12 top-level keys | The plain `log.info/warn/error/debug` path only | The failure mode this catches is a whole database row (or something row-shaped) passed straight to a log call. `logRow()` is the sanctioned escape hatch — see below. |
| Never spread a row | Always | `logRow(level, msg, row, allowedKeys)` picks only the named keys off `row`. Nothing else on the row can reach the log line, so a row growing a new cost/PII column later cannot silently start leaking through an old call site that just did `log.info("x", row)`. |

`redact()` is exported standalone (not just embedded in the logger) so
`packages/shared/src/alert.ts`'s webhook payloads and the worker's Sentry
`beforeSend` hook apply the identical rule rather than a second
hand-rolled copy.

Unit tests for every rule above (secret redaction, cost redaction scoped to
`public`, cost *not* redacted for other runtimes, the 12-key rejection,
`logRow`'s allow-list behavior, nested/circular objects) live in
`packages/shared/tests/log.test.ts`.

## Tracing one payment end to end by correlation id

**Design description — steps 1 and 2 below are not wired yet.** See "what's
live vs. deferred" at the bottom of this section.

1. `apps/shop` (or `apps/console`) generates one UUID per outbound request to
   a Supabase Edge Function and sends it as the `x-correlation-id` header.
2. The Edge Function reads that header (generating one itself if the caller
   omitted it — a request should never become untraceable just because a
   caller forgot the header), and includes it on every log line and Sentry
   scope for the life of the request.
3. If the Edge Function enqueues async work, it writes the same id onto
   `job_queue.payload.correlation_id` — this is the handoff point between two
   different processes.
4. `worker/` reads `job.payload.correlation_id` off the claimed job and
   threads it through `log.child({ correlationId })` for every line produced
   while handling that job.

To trace one payment: grep the correlation id across the Vercel Edge Function
log stream, the Supabase Edge Function log stream, and the Render worker's
`/healthz`-adjacent stdout/stderr (or Sentry, once wired — see below, given
Supabase's ~1 day retention). One id, three runtimes, one incident.

**What's live vs. deferred:**
- **Deferred.** Step 1 (header generation in apps/shop/apps/console) and
  step 2 (reading/propagating it in `supabase/functions/*`) are not wired.
  Neither Next.js app has a real request-issuing screen yet — Phase 4/5
  (auth, menu, checkout) haven't started; both apps are coming-soon pages.
  Wiring live header propagation into pages that issue no real backend
  requests would be dead code with nothing to verify it against. Build this
  as part of the first WBS entry that adds a real `fetch` from either app to
  an Edge Function.
- **Live.** `createLogger(...).child({ correlationId })` (step 4's consumer
  side) exists today in `packages/shared/src/log.ts` and is exercised by
  `packages/shared/tests/log.test.ts`'s `child()` tests. `worker/` is ready
  to thread a correlation id through the moment a job's payload carries one
  — no worker code change needed when step 3 lands.

## Sentry: live today vs. deferred

No Sentry DSN exists yet — the WBS 3.11 manual step (create the Sentry
account, three projects, capture the DSNs) has not been done. See the WBS
dictionary entry's ขั้นตอนที่ต้องทำเอง for that step.

- **Live:** `worker/` has a real `@sentry/node` dependency
  (`worker/src/sentry.ts`). `initSentry()` reads `SENTRY_DSN` from the
  environment and is a complete no-op — logs one line and returns — when it
  is unset, so its absence cannot crash worker startup (unlike the
  hard-required secrets `loadWorkerConfig()` validates; observability is not
  a correctness dependency and must degrade gracefully). Once set, `beforeSend`
  applies the exact same `redact()` rule as every log line, with
  `runtime: "worker"` — cost fields are NOT stripped there, matching the
  logger's RL-3 scoping. Release is tagged from `RENDER_GIT_COMMIT`.
  `worker/src/queue.ts`'s `markFailed` calls `captureError()` on every job
  failure (both retryable and terminal).
- **Scaffolded, dormant:** `apps/shop/sentry.{client,server,edge}.config.ts`
  and `apps/console/sentry.{client,server,edge}.config.ts` exist with the
  intended `Sentry.init(...)` calls fully written but commented out, and
  `@sentry/nextjs` is deliberately **not** installed in either app yet — see
  each file's header comment for the exact steps to bring it live (install
  the package, uncomment, wrap `next.config.ts` with `withSentryConfig`,
  possibly re-run the SDK's setup wizard since its expected file layout can
  move across major versions). Do this once Phase 4/5 lands a real screen —
  wiring a live SDK against a placeholder coming-soon page would be
  unverifiable dead code today. `apps/console`'s scoped `redact(event,
  "console")` deliberately does NOT strip cost fields (unlike `apps/shop`'s
  `redact(event, "public")`) — the Owner Console is the one surface allowed
  to see them.
- **Not done:** the Edge Functions error reporter (WBS 3.11 calls for "a
  lightweight fetch-based error reporter; do not pull a heavy SDK into the
  Deno bundle") is not built in this pass — no DSN exists to send to yet, and
  `supabase/functions/*`'s existing `public-*` functions have no error path
  currently worth instrumenting beyond what their own tests already assert.
  Build this alongside the Sentry activation above once a DSN exists.

## Alerting

`packages/shared/src/alert.ts`. Three conditions are named in the WBS
dictionary, debounced per `(condition, storeId)` with a 15-minute window so
one incident produces exactly one message, not one per retry:

| Condition | Status | Notes |
|---|---|---|
| `job_failed_final` — a job reached its final retry (5 attempts) and stayed failed | **Live** | Wired into `worker/src/queue.ts`'s `markFailed`, the same terminal-failure branch that has existed since WBS 3.3. |
| `payment_webhook_failed` — a payment webhook fails signature verification or is dead-lettered | **Not applicable today.** | The WBS 3.11 dictionary text assumes a payment gateway webhook. The RL-1 payment-model revision (see `BrewLedger_WBS_Dictionary.md`, the section beginning "This entry previously implemented an idempotent gateway webhook handler," around line 3745) removed the gateway entirely — there is no webhook, and "the system cannot observe that money arrived" by design. `webhook_events`/`dead_letter_webhooks` are explicitly dropped from that entry's schema. Whatever WBS 5.x actually builds for the merchant payment-confirmation failure mode will call `sendAlert()` with its own condition name; `alert.ts` does not assume what that name is. |
| `ocr_quota_exhausted` — the Float16 OCR daily credit is exhausted | **Not built** (WBS 6.2) | No OCR integration exists yet. The generic `sendAlert()`/`AlertDebouncer` utility is ready for it. |

`ALERT_WEBHOOK_URL` — same env var name WBS 3.10 documents (a Discord webhook
URL, per that entry's manual step), so both entries converge on one secret.
WBS 3.10 has not landed in this repo as of this writing; `alert.ts` reads the
var directly via `process.env.ALERT_WEBHOOK_URL` at the call site rather than
through a `packages/shared/src/config.ts` schema, for the same
graceful-degradation reason as `SENTRY_DSN`: its absence must log a warning
and drop the alert, not fail a required-config assertion at startup.

**Known limitation:** `AlertDebouncer`'s state is a plain in-memory `Map`,
correct for exactly one worker process — the only thing WBS 3.3/3.9
provisioned. If Render is ever scaled to more than one instance, each
instance keeps its own debounce window and could each send one alert for the
same incident. If that happens, move the debounce state to a shared store
(a Postgres table, or Redis) keyed the same way — `(condition, storeId)`,
15-minute window. Not done proactively because there is exactly one instance
today and premature shared-state infrastructure is its own maintenance cost.

## Ops route (`/console/_ops`) — not built, forward pointer only

The WBS dictionary asks for a route at `apps/console/_ops`, "merchant-scoped,
visible only to a merchant flagged `is_internal`," showing:

- Queue depth by status
- Jobs failed in the last 24h, with `last_error`
- Dead-lettered webhooks (see the payment-model note above — there may be
  nothing here until WBS 5.x defines a real dead-letter concept for the
  no-gateway payment model)
- Timestamp of the last successful backup and keep-alive run (WBS 3.10)

**Deliberately not built in this pass.** `apps/console` has no auth system
at all yet — WBS 4.1/4.2 (Phase 4) have not started, so there is no session,
no route guard, and no `is_internal` flag to check. Building this route now
would mean either (a) shipping it fully unprotected on a live Vercel
deployment — a real regression, this app is already deployed — or (b) faking
an auth check that gets silently forgotten and left insecure once real auth
lands. Neither is acceptable. Build this once WBS 4.1/4.2 land a real session
and a `merchants.is_internal` column/flag to gate on; `getQueueDepth()` in
`worker/src/queue.ts` already exists as a building block for the queue-depth
figure, and `job_queue.last_error` already exists as a column for the
failed-jobs list.
