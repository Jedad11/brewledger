// Structured logging + mandatory redaction (WBS 3.11).
//
// One canonical logger, used from every runtime (apps/shop, apps/console,
// supabase/functions/*, worker/). Deliberately built on `console.log` /
// `console.error` rather than `process.stdout.write` — `process` is not
// typed in this package (no @types/node dependency; see package.json) and
// does not exist at all in the Deno Edge Function runtime or the browser.
// `console` is the one logging primitive that exists, identically, in all
// four targets.
//
// Two things carry real RL-3 risk, per the WBS 3.11 statement of work:
//   1. A secret reaching a log sink (Render's dashboard, Supabase's Edge
//      Function logs, Sentry) is a credential leak.
//   2. A whole database row reaching a log line — a joined query result can
//      carry cost/margin columns nobody meant to log — is an RL-3 leak even
//      though the *code path* that read the row was legitimate.
// Both are enforced here, not left to call-site discipline, because
// call-site discipline is exactly what a rushed `console.log(job)` during
// an incident forgets.
//
// --- Correlation id propagation contract (WBS 3.11 deliverable 2) ----------
// The intended end-to-end trace, once live:
//   1. apps/shop / apps/console generates one UUID per outbound request to
//      an Edge Function and sends it as the `x-correlation-id` header.
//   2. Every supabase/functions/* handler reads that header (or generates
//      one if absent — a request should never be untraceable just because
//      the caller forgot the header) and includes it on every log line and
//      Sentry scope for the life of the request.
//   3. Any Edge Function that enqueues async work writes the same id onto
//      `job_queue.payload.correlation_id` so the worker, picking the job up
//      later and on a different process, continues the same trace instead
//      of starting a new one.
//   4. worker/ reads `job.payload.correlation_id` and threads it through
//      `createLogger("worker", { correlationId })` (see child() below) for
//      every log line produced while handling that job.
// A payment (or any request) is then traceable end to end by grepping one
// id across three runtimes' log sinks.
//
// STATUS: this contract is documented and this module supports it (accepts
// and carries `correlationId` through `child()`), but steps 1 and 2 are NOT
// wired into apps/shop / apps/console / supabase/functions/* yet. Neither
// Next.js app has a real request-issuing screen built (Phase 4/5 — auth,
// menu, checkout — have not started; both apps are coming-soon pages only).
// Wiring live header-generation/propagation into pages that issue no real
// backend requests would be dead code with nothing to verify it against.
// Deferred to the first WBS entry that adds a real fetch from apps/shop or
// apps/console to an Edge Function. worker/'s half of the contract (step 4)
// IS wired — see worker/src/queue.ts and worker/src/log.ts.

export type Runtime = "public" | "console" | "worker" | "edge" | "system";
type Level = "debug" | "info" | "warn" | "error";

// Secrets: dropped in every log line, from every runtime, no exceptions.
const SECRET_KEY = /key|secret|token|password|authorization|service_role/i;

// Cost-shaped fields: dropped ONLY when runtime === "public" (RL-3). A
// Customer Web request must never cause cost/margin data to reach a log
// sink, not even redacted-with-a-marker — it must not appear at all.
// Console/worker/edge/system runtimes legitimately need this data to
// diagnose a costing bug, so it is NOT redacted there — re-read WBS 3.11:
// the rule is scoped to `runtime === 'public'` specifically, not global.
const COST_KEY = /cost|margin|profit|unit_cost|snapshot|fee_satang/i;

const SECRET_REDACTED = "[redacted:secret]";
const COST_REDACTED = "[redacted:rl-3-public]";

const MAX_KEYS = 12;

export class TooManyKeysError extends Error {
  constructor(keyCount: number) {
    super(
      `log() was given ${keyCount} fields (max ${MAX_KEYS}) — this looks like a whole ` +
        `row was passed in, which is exactly what WBS 3.11 forbids (a row can carry ` +
        `fields that must never reach a log line unreviewed). Use logRow(level, msg, ` +
        `row, allowedKeys) to log an explicit, named allow-list of fields instead.`,
    );
    this.name = "TooManyKeysError";
  }
}

function redactValue(value: unknown, runtime: Runtime, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redactValue(v, runtime, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) {
      out[k] = SECRET_REDACTED;
      continue;
    }
    if (runtime === "public" && COST_KEY.test(k)) {
      out[k] = COST_REDACTED;
      continue;
    }
    out[k] = redactValue(v, runtime, seen);
  }
  return out;
}

// Exported standalone so callers (alert.ts, Sentry beforeSend hooks) can
// apply the exact same rule to a payload that isn't going through the
// logger's line-shape.
export function redact(value: unknown, runtime: Runtime = "system"): unknown {
  return redactValue(value, runtime, new WeakSet());
}

export interface LogFields {
  storeId?: string;
  orderId?: string;
  jobId?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export interface LogLine {
  ts: string;
  level: Level;
  runtime: Runtime;
  msg: string;
  correlationId?: string;
  [key: string]: unknown;
}

export type Emitter = (line: LogLine) => void;

const defaultEmitter: Emitter = (line) => {
  const text = JSON.stringify(line);
  // eslint-disable-next-line no-console
  if (line.level === "error" || line.level === "warn") console.error(text);
  // eslint-disable-next-line no-console
  else console.log(text);
};

function pickAllowedKeys(
  row: Record<string, unknown>,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) out[k] = row[k];
  }
  return out;
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /**
   * The ONLY sanctioned way to log data sourced from a full database row
   * (an `orders` row, a joined `order_items` row, anything from
   * `packages/db`). Picks exactly `allowedKeys` off `row` — nothing else on
   * the row ever reaches the log line, so a row growing a new cost/PII
   * column later cannot silently start leaking through an old call site.
   * Bypasses the >12-key rejection by design: the caller has already named
   * every field explicitly.
   */
  logRow(
    level: Level,
    msg: string,
    row: Record<string, unknown>,
    allowedKeys: readonly string[],
    fields?: LogFields,
  ): void;
  /** Returns a logger with `defaults` merged onto every line it emits. */
  child(defaults: Partial<LogFields>): Logger;
}

export function createLogger(
  runtime: Runtime,
  base: Partial<LogFields> = {},
  emit: Emitter = defaultEmitter,
): Logger {
  function emitLine(level: Level, msg: string, merged: Record<string, unknown>): void {
    const redacted = redactValue(merged, runtime, new WeakSet()) as Record<string, unknown>;
    emit({
      ts: new Date().toISOString(),
      level,
      runtime,
      msg,
      ...redacted,
    });
  }

  function log(level: Level, msg: string, fields: LogFields = {}): void {
    const merged = { ...base, ...fields };
    const keyCount = Object.keys(merged).length;
    if (keyCount > MAX_KEYS) {
      throw new TooManyKeysError(keyCount);
    }
    emitLine(level, msg, merged);
  }

  return {
    debug: (msg, fields) => log("debug", msg, fields),
    info: (msg, fields) => log("info", msg, fields),
    warn: (msg, fields) => log("warn", msg, fields),
    error: (msg, fields) => log("error", msg, fields),
    logRow(level, msg, row, allowedKeys, fields = {}) {
      const picked = pickAllowedKeys(row, allowedKeys);
      emitLine(level, msg, { ...base, ...fields, ...picked });
    },
    child(defaults) {
      return createLogger(runtime, { ...base, ...defaults }, emit);
    },
  };
}
