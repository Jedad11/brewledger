// Optional Sentry wiring (WBS 3.11). SENTRY_DSN is deliberately NOT part of
// loadWorkerConfig()'s required set (worker/src/db.ts) — observability must
// degrade gracefully when absent, unlike the hard-required secrets there.
// WBS 3.9 already caused one real production incident from an over-strict
// startup config; this file must never be the cause of a second one.
//
// No DSN exists yet (the WBS 3.11 manual step — creating the Sentry project
// and capturing the DSN — has not been done). Until SENTRY_DSN is set in
// the Render environment, initSentry() no-ops and captureError() falls back
// to the structured logger, so nothing here changes worker behavior today.
import * as Sentry from "@sentry/node";
import { redact } from "@brewledger/shared/dist/log";
import { log } from "./log";

let initialized = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    log.info("SENTRY_DSN not set — Sentry disabled, structured logs remain the only sink");
    return;
  }

  Sentry.init({
    dsn,
    release: process.env.RENDER_GIT_COMMIT ?? undefined,
    environment: process.env.RENDER_SERVICE_ID ? "production" : "local",
    tracesSampleRate: 0.1,
    // Same redaction rule as every log line (packages/shared/src/log.ts).
    // runtime "worker": cost fields are NOT stripped here, matching the
    // logger's scoping — only runtime "public" strips cost-shaped keys.
    beforeSend(event) {
      return redact(event, "worker") as typeof event;
    },
  });
  initialized = true;
  log.info("Sentry initialized", { release: process.env.RENDER_GIT_COMMIT ?? "unknown" });
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (initialized) {
    Sentry.captureException(err, context ? { extra: redact(context, "worker") as Record<string, unknown> } : undefined);
  }
}

export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (initialized) {
    await Sentry.close(timeoutMs);
  }
}
