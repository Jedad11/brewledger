// @vitest-environment jsdom
//
// WBS 5.8 — the two acceptance-critical Tests bullets that live in this
// hook: (1) a new paid order appears within 10s via the visible-tab poll
// alone (push permission is irrelevant to this hook — it never reads
// Notification.permission, which is exactly why the poll is a mandatory
// fallback and not gated on permission state), and (2) realtime + poll
// arriving together render one card per order id, never two.
//
// fetchWorkingQueue (the shared query function) is mocked wholesale: this
// suite is about the hook's OWN merge/trigger behaviour, not about Supabase
// query shape (fetchWorkingQueue.ts has no test of its own here since it
// needs a real Postgres — same "no local stack reachable" environment
// caveat as packages/db/tests/*).
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkingOrder } from "./fetchWorkingQueue";

const fetchWorkingQueue = vi.fn<(...args: unknown[]) => Promise<WorkingOrder[]>>();
vi.mock("./fetchWorkingQueue", () => ({
  fetchWorkingQueue: (...args: unknown[]) => fetchWorkingQueue(...args),
}));

import { useOrdersFeed } from "./useOrdersFeed";

function order(id: string): WorkingOrder {
  return {
    id,
    code: `ORD-${id}`,
    status: "ACCEPTED",
    customerName: "ทดสอบ",
    pickupSlotId: null,
    pickupTime: "08:00",
    totalSatang: 6000,
    cups: 1,
    items: [],
    arrivedAt: "2026-08-22T08:00:00.000Z",
  };
}

function makeFakeChannel() {
  const handlers: Array<(payload: unknown) => void> = [];
  const channel = {
    on: vi.fn((_event: string, _filter: unknown, cb: (payload: unknown) => void) => {
      handlers.push(cb);
      return channel;
    }),
    subscribe: vi.fn(() => channel),
  };
  return { channel, fire: () => handlers.forEach((h) => h({})) };
}

// A fake client structurally nowhere near the real SupabaseClient — only
// the two methods useOrdersFeed actually calls (channel/removeChannel) are
// under test here, same "stub only what's used" idiom actions.test.ts's own
// buildPaymentsMock() uses for .from(). One cast at this single boundary,
// not repeated at every call site.
function makeFakeSupabase() {
  const { channel, fire } = makeFakeChannel();
  const supabase = {
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(),
  } as unknown as SupabaseClient;
  return { supabase, fireRealtimeEvent: fire };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchWorkingQueue.mockReset();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useOrdersFeed", () => {
  it("REQUIRED: a new order appears within 10s via the visible-tab poll alone (no realtime event needed)", async () => {
    const { supabase } = makeFakeSupabase();
    const initial: WorkingOrder[] = [order("a")];
    fetchWorkingQueue.mockResolvedValue([order("a"), order("b")]); // "b" is new

    const { result } = renderHook(() =>
      useOrdersFeed(supabase, "store-1", initial, undefined),
    );

    expect(result.current.map((o) => o.id)).toEqual(["a"]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(result.current.map((o) => o.id)).toEqual(["a", "b"]);
    expect(fetchWorkingQueue).toHaveBeenCalled();
  });

  it("does NOT poll while the tab is hidden", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const { supabase } = makeFakeSupabase();
    fetchWorkingQueue.mockResolvedValue([order("a")]);

    renderHook(() =>
      useOrdersFeed(supabase, "store-1", [], undefined),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fetchWorkingQueue).not.toHaveBeenCalled();
  });

  it("REQUIRED: realtime and poll arriving together render one card per order id, never two", async () => {
    const { supabase, fireRealtimeEvent } = makeFakeSupabase();
    fetchWorkingQueue.mockResolvedValue([order("a"), order("b")]);

    const { result } = renderHook(() =>
      useOrdersFeed(supabase, "store-1", [], undefined),
    );

    // Realtime event and the 10s poll tick both land in the same window.
    await act(async () => {
      fireRealtimeEvent();
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(result.current).toHaveLength(2);
    const ids = result.current.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("onRefreshed reports which ids are genuinely new (previousIds excludes them)", async () => {
    const { supabase } = makeFakeSupabase();
    fetchWorkingQueue.mockResolvedValue([order("a"), order("b")]);
    const onRefreshed = vi.fn();

    renderHook(() =>
      useOrdersFeed(supabase, "store-1", [order("a")], onRefreshed),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(onRefreshed).toHaveBeenCalled();
    const [nextOrders, previousIds] = onRefreshed.mock.calls[0] as [WorkingOrder[], Set<string>];
    expect(nextOrders.map((o) => o.id)).toEqual(["a", "b"]);
    expect(previousIds.has("a")).toBe(true);
    expect(previousIds.has("b")).toBe(false);
  });
});
