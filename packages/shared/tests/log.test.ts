// WBS 3.11 — redaction is the acceptance criterion for this entry (RL-3:
// no secret, no whole row, no cost/margin field for a Customer Web
// request), so every rule gets its own assertion rather than one combined
// smoke test.
import { describe, expect, it } from "vitest";
import { createLogger, redact, TooManyKeysError, type LogLine } from "../src/log";

function captured(): { lines: LogLine[]; emit: (line: LogLine) => void } {
  const lines: LogLine[] = [];
  return { lines, emit: (line) => lines.push(line) };
}

describe("redact()", () => {
  it("drops top-level secret-shaped keys, from any runtime", () => {
    const out = redact(
      { apiKey: "sk_live_123", service_role: "eyJ", password: "hunter2", ok: "fine" },
      "worker",
    ) as Record<string, unknown>;
    expect(out.apiKey).toBe("[redacted:secret]");
    expect(out.service_role).toBe("[redacted:secret]");
    expect(out.password).toBe("[redacted:secret]");
    expect(out.ok).toBe("fine");
  });

  it("drops secret-shaped keys nested inside objects and arrays", () => {
    const out = redact(
      { job: { payload: { token: "abc" }, items: [{ authorization: "Bearer x" }] } },
      "worker",
    ) as any;
    expect(out.job.payload.token).toBe("[redacted:secret]");
    expect(out.job.items[0].authorization).toBe("[redacted:secret]");
  });

  it("matches key names case-insensitively (Authorization, SECRET_KEY, ApiToken)", () => {
    const out = redact({ Authorization: "x", SECRET_KEY: "y", ApiToken: "z" }, "worker") as Record<
      string,
      unknown
    >;
    expect(out.Authorization).toBe("[redacted:secret]");
    expect(out.SECRET_KEY).toBe("[redacted:secret]");
    expect(out.ApiToken).toBe("[redacted:secret]");
  });

  it("redacts cost-shaped keys when runtime is 'public' (RL-3)", () => {
    const out = redact(
      {
        unit_cost_snapshot_satang: 1200,
        margin_percent: 42,
        profit_satang: 300,
        fee_satang: 10,
        cost_of_goods: 900,
        display_name: "latte",
      },
      "public",
    ) as Record<string, unknown>;
    expect(out.unit_cost_snapshot_satang).toBe("[redacted:rl-3-public]");
    expect(out.margin_percent).toBe("[redacted:rl-3-public]");
    expect(out.profit_satang).toBe("[redacted:rl-3-public]");
    expect(out.fee_satang).toBe("[redacted:rl-3-public]");
    expect(out.cost_of_goods).toBe("[redacted:rl-3-public]");
    expect(out.display_name).toBe("latte");
  });

  it("does NOT redact cost-shaped keys for non-public runtimes (console/worker/edge/system)", () => {
    for (const runtime of ["console", "worker", "edge", "system"] as const) {
      const out = redact({ unit_cost_snapshot_satang: 1200, margin_percent: 42 }, runtime) as Record<
        string,
        unknown
      >;
      expect(out.unit_cost_snapshot_satang).toBe(1200);
      expect(out.margin_percent).toBe(42);
    }
  });

  it("still redacts secrets under runtime 'public', independent of the cost rule", () => {
    const out = redact({ apiKey: "x", unit_cost_satang: 100 }, "public") as Record<string, unknown>;
    expect(out.apiKey).toBe("[redacted:secret]");
    expect(out.unit_cost_satang).toBe("[redacted:rl-3-public]");
  });

  it("handles circular references without throwing", () => {
    const obj: Record<string, unknown> = { name: "x" };
    obj.self = obj;
    expect(() => redact(obj, "worker")).not.toThrow();
    const out = redact(obj, "worker") as Record<string, unknown>;
    expect(out.self).toBe("[circular]");
  });

  it("passes primitives and null through unchanged", () => {
    expect(redact(null, "public")).toBeNull();
    expect(redact(42, "public")).toBe(42);
    expect(redact("hello", "public")).toBe("hello");
  });
});

describe("createLogger() — plain fields path", () => {
  it("emits a JSON-shaped line with ts, level, runtime, msg", () => {
    const { lines, emit } = captured();
    const logger = createLogger("worker", {}, emit);
    logger.info("job claimed", { jobId: "j1" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", runtime: "worker", msg: "job claimed", jobId: "j1" });
    expect(typeof lines[0].ts).toBe("string");
  });

  it("rejects a fields object with more than 12 keys", () => {
    const { emit } = captured();
    const logger = createLogger("worker", {}, emit);
    const wholeRow: Record<string, unknown> = {};
    for (let i = 0; i < 13; i += 1) wholeRow[`field${i}`] = i;
    expect(() => logger.info("oops", wholeRow)).toThrow(TooManyKeysError);
  });

  it("allows exactly 12 keys (boundary, not off-by-one)", () => {
    const { lines, emit } = captured();
    const logger = createLogger("worker", {}, emit);
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < 12; i += 1) fields[`field${i}`] = i;
    expect(() => logger.info("ok", fields)).not.toThrow();
    expect(lines).toHaveLength(1);
  });

  it("counts base (child) fields toward the 12-key cap", () => {
    const { emit } = captured();
    const base = createLogger("worker", {}, emit);
    const child = base.child({ storeId: "s1", correlationId: "c1" });
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < 11; i += 1) fields[`field${i}`] = i; // 11 + 2 base = 13
    expect(() => child.info("oops", fields)).toThrow(TooManyKeysError);
  });

  it("applies public cost redaction on the emitted line, not just nested objects", () => {
    const { lines, emit } = captured();
    const logger = createLogger("public", {}, emit);
    logger.warn("order status read", { unit_cost_satang: 500, orderId: "o1" });
    expect(lines[0].unit_cost_satang).toBe("[redacted:rl-3-public]");
    expect(lines[0].orderId).toBe("o1");
  });

  it("routes error/warn to console.error and info/debug to console.log", () => {
    // Uses the real defaultEmitter (no custom emit) to prove wiring, not just the field logic.
    const logSpy = vi_spy("log");
    const errSpy = vi_spy("error");
    const logger = createLogger("worker");
    logger.info("hi");
    logger.error("bye");
    expect(logSpy.calls.length).toBe(1);
    expect(errSpy.calls.length).toBe(1);
    logSpy.restore();
    errSpy.restore();
  });
});

describe("createLogger().logRow()", () => {
  it("picks only the named allow-listed keys off a row", () => {
    const { lines, emit } = captured();
    const logger = createLogger("worker", {}, emit);
    const row = {
      id: "o1",
      status: "paid",
      unit_cost_snapshot_satang: 1200,
      customer_phone: "0812345678",
      internal_notes: "sensitive",
    };
    logger.logRow("info", "order updated", row, ["id", "status"]);
    expect(lines[0].id).toBe("o1");
    expect(lines[0].status).toBe("paid");
    expect(lines[0].unit_cost_snapshot_satang).toBeUndefined();
    expect(lines[0].customer_phone).toBeUndefined();
    expect(lines[0].internal_notes).toBeUndefined();
  });

  it("bypasses the >12-key rejection since the caller explicitly named every field", () => {
    const { lines, emit } = captured();
    const logger = createLogger("worker", {}, emit);
    const row: Record<string, unknown> = {};
    const keys: string[] = [];
    for (let i = 0; i < 15; i += 1) {
      row[`field${i}`] = i;
      keys.push(`field${i}`);
    }
    expect(() => logger.logRow("info", "wide but explicit", row, keys)).not.toThrow();
    expect(Object.keys(lines[0]).length).toBeGreaterThan(12);
  });

  it("still applies public cost redaction to allow-listed fields", () => {
    const { lines, emit } = captured();
    const logger = createLogger("public", {}, emit);
    const row = { id: "o1", unit_cost_snapshot_satang: 1200 };
    logger.logRow("info", "row", row, ["id", "unit_cost_snapshot_satang"]);
    expect(lines[0].unit_cost_snapshot_satang).toBe("[redacted:rl-3-public]");
  });

  it("silently ignores an allowed key absent from the row", () => {
    const { lines, emit } = captured();
    const logger = createLogger("worker", {}, emit);
    logger.logRow("info", "row", { id: "o1" }, ["id", "missing_field"]);
    expect("missing_field" in lines[0]).toBe(false);
  });
});

describe("createLogger().child()", () => {
  it("merges child defaults onto every emitted line", () => {
    const { lines, emit } = captured();
    const base = createLogger("worker", {}, emit);
    const child = base.child({ jobId: "j1", correlationId: "c1" });
    child.info("job step");
    expect(lines[0]).toMatchObject({ jobId: "j1", correlationId: "c1" });
  });

  it("lets a per-call field override a child default", () => {
    const { lines, emit } = captured();
    const base = createLogger("worker", {}, emit);
    const child = base.child({ jobId: "j1" });
    child.info("job step", { jobId: "j2" });
    expect(lines[0].jobId).toBe("j2");
  });
});

// Minimal console spy helper — avoids pulling in vi.spyOn typing gymnastics
// for a two-call assertion.
function vi_spy(method: "log" | "error"): { calls: unknown[][]; restore: () => void } {
  const calls: unknown[][] = [];
  const original = console[method];
  console[method] = ((...args: unknown[]) => {
    calls.push(args);
  }) as typeof console.log;
  return {
    calls,
    restore: () => {
      console[method] = original;
    },
  };
}
