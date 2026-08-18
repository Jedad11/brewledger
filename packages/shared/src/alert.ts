// Debounced incident alerting (WBS 3.11 deliverable 4).
//
// Three conditions are named in the WBS dictionary:
//   1. a payment webhook fails signature verification or is dead-lettered
//   2. a job reaches its final retry and stays failed
//   3. the Float16 OCR daily credit is exhausted
//
// Only #2 has a real call site today (worker/src/queue.ts's markFailed,
// live since WBS 3.3). #1 and #3 do not exist yet:
//   - #1 assumed a payment gateway webhook. ADR-008 / the RL-1 payment
//     model revision (see BrewLedger_WBS_Dictionary.md around line 3745,
//     "the system cannot observe that money arrived") removed the gateway
//     entirely — there is no webhook to fail signature verification on.
//     Whatever WBS 5.x actually builds for the merchant payment-confirmation
//     failure mode will call sendAlert() with its own condition name; this
//     module does not assume what that name is.
//   - #3 is WBS 6.2 (Typhoon OCR integration), not started.
// This module is deliberately generic — a (condition, storeId) string pair
// and a message — so whichever real code lands later just calls
// `sendAlert()` rather than needing this file touched again.
//
// Debounce is a plain in-memory Map keyed by (condition, storeId), scoped to
// one AlertDebouncer instance. That is correct for a single Render worker
// instance (the only thing WBS 3.3/3.9 provisioned) but NOT correct if
// Render is ever scaled to >1 instance — each instance would keep its own
// window and could each send one alert for the same incident. If that
// happens, move the debounce state to a shared store (e.g. a Postgres table
// or Redis) keyed the same way. Noting this now rather than after it causes
// alert spam.
import { redact, type Logger, type Runtime } from "./log";

export type AlertCondition = "payment_webhook_failed" | "job_failed_final" | "ocr_quota_exhausted";

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;

export class AlertDebouncer {
  private readonly lastAlertedAt = new Map<string, number>();

  constructor(
    private readonly windowMs: number = DEFAULT_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  private key(condition: string, storeId: string | null): string {
    return `${condition}::${storeId ?? "-"}`;
  }

  /** True the first time (condition, storeId) is seen, or once the window has elapsed. */
  shouldAlert(condition: string, storeId: string | null): boolean {
    const k = this.key(condition, storeId);
    const t = this.now();
    const last = this.lastAlertedAt.get(k);
    if (last !== undefined && t - last < this.windowMs) return false;
    this.lastAlertedAt.set(k, t);
    return true;
  }

  /** Test/ops escape hatch — clears all debounce state. */
  reset(): void {
    this.lastAlertedAt.clear();
  }
}

export interface AlertPayload {
  condition: AlertCondition | (string & {});
  storeId?: string | null;
  message: string;
  detail?: Record<string, unknown>;
}

export interface SendAlertOptions {
  webhookUrl: string | undefined;
  debouncer: AlertDebouncer;
  runtime: Runtime;
  logger: Logger;
  fetchImpl?: typeof fetch;
}

// Fire-and-forget by design (callers are on the worker's job-processing
// path or an Edge Function's error path — neither should block on a
// third-party webhook). Never throws; a broken alert channel must not take
// down job processing itself.
export async function sendAlert(payload: AlertPayload, options: SendAlertOptions): Promise<void> {
  const { webhookUrl, debouncer, runtime, logger, fetchImpl = fetch } = options;
  const storeId = payload.storeId ?? null;

  if (!debouncer.shouldAlert(payload.condition, storeId)) {
    logger.debug("alert debounced", { condition: payload.condition, storeId: storeId ?? undefined });
    return;
  }

  if (!webhookUrl) {
    logger.warn("ALERT_WEBHOOK_URL not set — dropping alert", {
      condition: payload.condition,
      storeId: storeId ?? undefined,
    });
    return;
  }

  const body = redact(
    {
      condition: payload.condition,
      storeId,
      message: payload.message,
      detail: payload.detail ?? {},
    },
    runtime,
  );

  try {
    const res = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.error("alert webhook responded with a non-2xx status", {
        condition: payload.condition,
        status: res.status,
      });
    }
  } catch (err) {
    logger.error("alert webhook request failed", {
      condition: payload.condition,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
