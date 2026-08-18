// WBS 3.11 — debounce + alert-send tests. "Five identical failures within
// the window produce one alert" is a named acceptance test in the WBS
// dictionary; it's asserted directly below.
import { describe, expect, it, vi } from "vitest";
import { AlertDebouncer, sendAlert } from "../src/alert";
import { createLogger, type LogLine } from "../src/log";

function fakeLogger(): { logger: ReturnType<typeof createLogger>; lines: LogLine[] } {
  const lines: LogLine[] = [];
  const logger = createLogger("worker", {}, (line) => lines.push(line));
  return { logger, lines };
}

describe("AlertDebouncer", () => {
  it("allows the first occurrence of (condition, storeId)", () => {
    const d = new AlertDebouncer();
    expect(d.shouldAlert("job_failed_final", "store-1")).toBe(true);
  });

  it("suppresses five identical failures within the 15-minute window to a single alert", () => {
    let now = 0;
    const d = new AlertDebouncer(15 * 60 * 1000, () => now);
    const results = [d.shouldAlert("job_failed_final", "store-1")];
    for (let i = 0; i < 4; i += 1) {
      now += 1000; // 1s apart, well within the window
      results.push(d.shouldAlert("job_failed_final", "store-1"));
    }
    expect(results).toEqual([true, false, false, false, false]);
  });

  it("allows a new alert once the window has elapsed", () => {
    let now = 0;
    const d = new AlertDebouncer(15 * 60 * 1000, () => now);
    expect(d.shouldAlert("job_failed_final", "store-1")).toBe(true);
    now += 15 * 60 * 1000; // exactly at the boundary
    expect(d.shouldAlert("job_failed_final", "store-1")).toBe(true);
  });

  it("does not debounce across different storeIds", () => {
    const d = new AlertDebouncer();
    expect(d.shouldAlert("job_failed_final", "store-1")).toBe(true);
    expect(d.shouldAlert("job_failed_final", "store-2")).toBe(true);
  });

  it("does not debounce across different conditions for the same store", () => {
    const d = new AlertDebouncer();
    expect(d.shouldAlert("job_failed_final", "store-1")).toBe(true);
    expect(d.shouldAlert("ocr_quota_exhausted", "store-1")).toBe(true);
  });

  it("treats a null storeId as its own bucket, independent of a real storeId", () => {
    const d = new AlertDebouncer();
    expect(d.shouldAlert("job_failed_final", null)).toBe(true);
    expect(d.shouldAlert("job_failed_final", "store-1")).toBe(true);
  });

  it("reset() clears debounce state", () => {
    const d = new AlertDebouncer();
    expect(d.shouldAlert("job_failed_final", "store-1")).toBe(true);
    expect(d.shouldAlert("job_failed_final", "store-1")).toBe(false);
    d.reset();
    expect(d.shouldAlert("job_failed_final", "store-1")).toBe(true);
  });
});

describe("sendAlert()", () => {
  it("posts to the webhook on the first occurrence", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const { logger } = fakeLogger();
    const debouncer = new AlertDebouncer();
    await sendAlert(
      { condition: "job_failed_final", storeId: "store-1", message: "job x failed after 5 attempts" },
      { webhookUrl: "https://example.test/hook", debouncer, runtime: "worker", logger, fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://example.test/hook");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ condition: "job_failed_final", storeId: "store-1" });
  });

  it("does not call fetch on a debounced repeat", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const { logger } = fakeLogger();
    const debouncer = new AlertDebouncer();
    const payload = { condition: "job_failed_final", storeId: "store-1", message: "m" };
    const opts = { webhookUrl: "https://example.test/hook", debouncer, runtime: "worker" as const, logger, fetchImpl };
    await sendAlert(payload, opts);
    await sendAlert(payload, opts);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not call fetch and does not throw when ALERT_WEBHOOK_URL is unset", async () => {
    const fetchImpl = vi.fn();
    const { logger } = fakeLogger();
    const debouncer = new AlertDebouncer();
    await expect(
      sendAlert(
        { condition: "ocr_quota_exhausted", storeId: "store-1", message: "quota gone" },
        { webhookUrl: undefined, debouncer, runtime: "worker", logger, fetchImpl },
      ),
    ).resolves.toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("swallows a fetch rejection instead of throwing (alerting must not break the job path)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const { logger } = fakeLogger();
    const debouncer = new AlertDebouncer();
    await expect(
      sendAlert(
        { condition: "job_failed_final", storeId: "store-1", message: "m" },
        { webhookUrl: "https://example.test/hook", debouncer, runtime: "worker", logger, fetchImpl },
      ),
    ).resolves.toBeUndefined();
  });

  it("redacts secret-shaped detail fields before posting", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const { logger } = fakeLogger();
    const debouncer = new AlertDebouncer();
    await sendAlert(
      {
        condition: "job_failed_final",
        storeId: "store-1",
        message: "m",
        detail: { apiKey: "sk_live_x", attempts: 5 },
      },
      { webhookUrl: "https://example.test/hook", debouncer, runtime: "worker", logger, fetchImpl },
    );
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.detail.apiKey).toBe("[redacted:secret]");
    expect(body.detail.attempts).toBe(5);
  });

  it("redacts cost-shaped detail fields when runtime is 'public'", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const { logger } = fakeLogger();
    const debouncer = new AlertDebouncer();
    await sendAlert(
      {
        condition: "ocr_quota_exhausted",
        storeId: "store-1",
        message: "m",
        detail: { margin_percent: 42 },
      },
      { webhookUrl: "https://example.test/hook", debouncer, runtime: "public", logger, fetchImpl },
    );
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.detail.margin_percent).toBe("[redacted:rl-3-public]");
  });
});
