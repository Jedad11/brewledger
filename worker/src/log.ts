type Level = "debug" | "info" | "warn" | "error";

const SECRET_KEY = /key|secret|token|password|authorization/i;

// Strips any object key matching SECRET_KEY before it can reach a log line.
// Recurses into nested objects/arrays; primitives pass through unchanged.
// This is the only thing standing between a stray `console.log(job)` and
// the service_role key ending up in the Render log dashboard.
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, seen);
  }
  return out;
}

interface LogFields {
  job_id?: string;
  job_type?: string;
  [key: string]: unknown;
}

function emit(level: Level, msg: string, fields: LogFields = {}): void {
  const line = {
    level,
    ts: new Date().toISOString(),
    msg,
    ...(redact(fields) as Record<string, unknown>),
  };
  const out = level === "error" ? process.stderr : process.stdout;
  out.write(JSON.stringify(line) + "\n");
}

export const log = {
  debug: (msg: string, fields?: LogFields) => emit("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};
