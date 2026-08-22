// WBS 5.8 — "last-seen marker persists across reload" (the WBS entry's own
// Tests bullet). The persistence itself is a DB round-trip (stores.
// orders_last_seen_at, written by markOrdersSeen in actions.test.ts, read
// fresh on every server render in page.tsx) — this file proves the pure
// comparison page.tsx/InboxClient.tsx both key off of is correct, which is
// what "survives a reload" actually depends on: a reload re-fetches
// lastSeenAt from the server and re-runs isUnseen against it, so a wrong
// comparison here would silently un-hide (or over-hide) the marker on every
// single reload regardless of what's persisted.
import { describe, expect, it } from "vitest";
import { isUnseen } from "./unseen";

describe("isUnseen", () => {
  it("a null cursor (store has never acknowledged) marks every order unseen", () => {
    expect(isUnseen("2026-08-22T08:00:00.000Z", null)).toBe(true);
  });

  it("an order that arrived AFTER the cursor is unseen", () => {
    expect(isUnseen("2026-08-22T08:05:00.000Z", "2026-08-22T08:00:00.000Z")).toBe(true);
  });

  it("an order that arrived BEFORE the cursor is seen", () => {
    expect(isUnseen("2026-08-22T07:55:00.000Z", "2026-08-22T08:00:00.000Z")).toBe(false);
  });

  it("an order that arrived AT exactly the cursor is seen (not strictly after)", () => {
    const t = "2026-08-22T08:00:00.000Z";
    expect(isUnseen(t, t)).toBe(false);
  });

  // Regression: arrivedAt (PostgREST, microsecond precision, offset suffix
  // e.g. "+00:00") and lastSeenAt (InboxClient's handleAck(), `new Date()
  // .toISOString()` — millisecond precision, "Z" suffix) are two different
  // ISO-8601 serializations. The 4 cases above only ever compare two
  // ".000Z"-suffixed strings against each other and would pass even against
  // a bare `arrivedAt > lastSeenAt` string comparison, so they never
  // exercised the format mismatch at all.
  describe("mixed ISO-8601 serializations (arrivedAt: PostgREST offset format, lastSeenAt: toISOString() Z format)", () => {
    it("an order that arrived AFTER the cursor is unseen — microsecond-precision +00:00 vs millisecond-precision Z", () => {
      const lastSeenAt = "2026-08-22T08:00:00.000Z";
      const arrivedAt = "2026-08-22T08:00:00.500123+00:00"; // 500ms later
      expect(isUnseen(arrivedAt, lastSeenAt)).toBe(true);
    });

    it("an order that arrived BEFORE the cursor is seen — microsecond-precision +00:00 vs millisecond-precision Z", () => {
      const lastSeenAt = "2026-08-22T08:00:00.500Z";
      const arrivedAt = "2026-08-22T08:00:00.100456+00:00"; // 400ms earlier
      expect(isUnseen(arrivedAt, lastSeenAt)).toBe(false);
    });

    // A real regression guard, not just format coverage: this case FAILS
    // under a bare `arrivedAt > lastSeenAt` string comparison (verified:
    // "2026-08-22T14:59:59.900123+07:00" > "2026-08-22T08:00:00.000Z" is
    // true as a string, since '1' (the hour digit) outranks '0' — even
    // though 14:59:59.900+07:00 is 07:59:59.900Z, 100ms BEFORE the cursor).
    // Only a real instant-based comparison gets this right, which is why
    // the fix parses both sides with `new Date(...).getTime()` instead of
    // comparing the raw strings.
    it("an order timestamped with a non-UTC offset is correctly ordered against a Z cursor", () => {
      const lastSeenAt = "2026-08-22T08:00:00.000Z";
      const arrivedAt = "2026-08-22T14:59:59.900123+07:00"; // = 2026-08-22T07:59:59.900Z, 100ms before
      expect(isUnseen(arrivedAt, lastSeenAt)).toBe(false);
    });
  });
});
