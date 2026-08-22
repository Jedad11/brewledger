// WBS 5.8 — regression coverage for the four new Server Actions
// (markOrdersSeen, setNotifySoundMuted, savePushSubscription,
// deletePushSubscription) added to this directory's actions.ts. Mocking
// pattern mirrors settings/payments/actions.test.ts: createClient() and
// resolveMerchantCtx() are mocked at the module boundary; currentStoreId is
// NOT mocked — it's a pure function from lib/merchant.ts and these actions
// derive storeId from the resolved merchant ctx rather than trusting a
// client-supplied storeId at all (there is no storeId argument on any of
// these four actions), so proving the real currentStoreId is what's driving
// the DB call matters here the way it didn't for payments/actions.test.ts
// (which takes storeId as an explicit, ownership-checked input).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/merchant", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/merchant")>("../../../../lib/merchant");
  return { ...actual, resolveMerchantCtx: vi.fn() };
});

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import {
  markOrdersSeen,
  setNotifySoundMuted,
  savePushSubscription,
  deletePushSubscription,
  advanceOrder,
  bulkMarkReady,
} from "./actions";
import { ADVANCE_FAILED, ADVANCE_STALE } from "./copy";

const mockedCreateClient = vi.mocked(createClient);
const mockedResolveMerchantCtx = vi.mocked(resolveMerchantCtx);

const STORE_ID = "33333333-3333-4333-8333-333333333333";
const MERCHANT_CTX = {
  merchantId: "22222222-2222-4222-8222-222222222222",
  subscriptionTier: "free" as const,
  storeIds: [STORE_ID],
  stores: [{ id: STORE_ID, slug: "test-store", name: "Test Store", isPublished: true }],
};

function buildFromMock() {
  const calls: { table: string; op: string; arg?: unknown }[] = [];
  const updateEqMock = vi.fn().mockResolvedValue({ error: null });
  const updateMock = vi.fn((row: Record<string, unknown>) => {
    calls.push({ table: "?", op: "update", arg: row });
    return { eq: updateEqMock };
  });
  const upsertMock = vi.fn((row: Record<string, unknown>, opts: unknown) => {
    calls.push({ table: "?", op: "upsert", arg: { row, opts } });
    return Promise.resolve({ error: null });
  });
  const deleteEqSecondMock = vi.fn().mockResolvedValue({ error: null });
  const deleteEqFirstMock = vi.fn(() => ({ eq: deleteEqSecondMock }));
  const deleteMock = vi.fn(() => ({ eq: deleteEqFirstMock }));

  const fromMock = vi.fn((table: string) => ({
    update: updateMock,
    upsert: upsertMock,
    delete: deleteMock,
    __table: table,
  }));

  return { client: { from: fromMock }, fromMock, updateMock, updateEqMock, upsertMock, deleteMock, deleteEqFirstMock, deleteEqSecondMock };
}

describe("WBS 5.8 orders Server Actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("markOrdersSeen", () => {
    it("no merchant/store resolved -> ok:false, no DB call", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(null);
      const result = await markOrdersSeen();
      expect(result).toEqual({ ok: false });
      expect(mockedCreateClient).not.toHaveBeenCalled();
    });

    it("updates stores.orders_last_seen_at on the caller's OWN store to a fresh timestamp", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(MERCHANT_CTX);
      const { client, fromMock, updateMock, updateEqMock } = buildFromMock();
      mockedCreateClient.mockResolvedValue(client as never);

      const before = Date.now();
      const result = await markOrdersSeen();
      const after = Date.now();

      expect(result).toEqual({ ok: true });
      expect(fromMock).toHaveBeenCalledWith("stores");
      const updatedRow = updateMock.mock.calls[0][0] as { orders_last_seen_at: string };
      const ts = new Date(updatedRow.orders_last_seen_at).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
      expect(updateEqMock).toHaveBeenCalledWith("id", STORE_ID);
    });
  });

  describe("setNotifySoundMuted", () => {
    it("persists the toggle value on the caller's own store row", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(MERCHANT_CTX);
      const { client, updateMock, updateEqMock } = buildFromMock();
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await setNotifySoundMuted(true);

      expect(result).toEqual({ ok: true });
      expect(updateMock).toHaveBeenCalledWith({ notify_sound_muted: true });
      expect(updateEqMock).toHaveBeenCalledWith("id", STORE_ID);
    });
  });

  describe("savePushSubscription", () => {
    it("upserts store_id + endpoint + keys, keyed on (store_id, endpoint)", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(MERCHANT_CTX);
      const { client, upsertMock } = buildFromMock();
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await savePushSubscription({
        endpoint: "https://push.example/abc",
        p256dh: "p256dh-value",
        authKey: "auth-value",
        userAgent: "Mozilla/5.0 test",
      });

      expect(result).toEqual({ ok: true });
      expect(upsertMock).toHaveBeenCalledWith(
        {
          store_id: STORE_ID,
          endpoint: "https://push.example/abc",
          p256dh: "p256dh-value",
          auth_key: "auth-value",
          user_agent: "Mozilla/5.0 test",
        },
        { onConflict: "store_id,endpoint" },
      );
    });

    it("no merchant/store resolved -> ok:false, no DB call", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(null);
      const result = await savePushSubscription({ endpoint: "e", p256dh: "p", authKey: "a" });
      expect(result).toEqual({ ok: false });
      expect(mockedCreateClient).not.toHaveBeenCalled();
    });
  });

  describe("deletePushSubscription", () => {
    it("deletes scoped to store_id AND endpoint — never a bare endpoint match across stores", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(MERCHANT_CTX);
      const { client, deleteEqFirstMock, deleteEqSecondMock } = buildFromMock();
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await deletePushSubscription("https://push.example/abc");

      expect(result).toEqual({ ok: true });
      expect(deleteEqFirstMock).toHaveBeenCalledWith("store_id", STORE_ID);
      expect(deleteEqSecondMock).toHaveBeenCalledWith("endpoint", "https://push.example/abc");
    });
  });
});

// WBS 5.9 — advanceOrder / bulkMarkReady. Both bridge to a real console-*
// Edge Function over `fetch` (postConsoleFunction, this same actions.ts
// file) rather than a Supabase client call, so the mocking boundary here is
// global fetch + createClient().auth.getSession() (the session that
// supplies the Bearer token), NOT the `.from(...)` chain buildFromMock()
// above stubs — so this level proves "does the Server Action build the
// right request and interpret the HTTP contract console-advance-order/
// console-bulk-ready-orders/index.ts (this same change) documents in their
// own header comments — 200 ok:true/false, 409 ILLEGAL_TRANSITION,
// 403/404/400/500 — correctly," with the mock standing in for the network
// hop. The Edge Function bodies' actual HTTP contract is exercised live,
// over real HTTP, in supabase/functions/_tests/tenant_isolation.test.ts.
const SUPABASE_URL = "http://127.0.0.1:54321";
const SUPABASE_ANON_KEY = "test-anon-key";
const ACCESS_TOKEN = "test-access-token";

function mockSessionClient(hasSession = true) {
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: hasSession ? { access_token: ACCESS_TOKEN } : null },
      }),
    },
  };
  mockedCreateClient.mockResolvedValue(client as never);
  return client;
}

function mockFetchResponse(status: number, json: unknown) {
  return { status, json: vi.fn().mockResolvedValue(json) } as unknown as Response;
}

describe("WBS 5.9 orders Server Actions", () => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
  });

  describe("advanceOrder", () => {
    it("no session -> ok:false, ADVANCE_FAILED, fetch never called", async () => {
      mockSessionClient(false);
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as never;

      const result = await advanceOrder("order-1", "PREPARING");

      expect(result).toEqual({ ok: false, error: ADVANCE_FAILED });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("posts to console-advance-order with the merchant's Bearer token, apikey, and {orderId, to} body", async () => {
      mockSessionClient(true);
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(200, { ok: true, already: false }));
      globalThis.fetch = fetchMock as never;

      const result = await advanceOrder("order-1", "PREPARING");

      expect(result).toEqual({ ok: true, already: false });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SUPABASE_URL}/functions/v1/console-advance-order`);
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect((init.headers as Record<string, string>).apikey).toBe(SUPABASE_ANON_KEY);
      expect(JSON.parse(init.body as string)).toEqual({ orderId: "order-1", to: "PREPARING" });
    });

    it("a second (idempotent) call reports already:true, not surfaced as an error", async () => {
      mockSessionClient(true);
      globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(200, { ok: true, already: true })) as never;

      const result = await advanceOrder("order-1", "PREPARING");

      expect(result).toEqual({ ok: true, already: true });
    });

    it("409 (ILLEGAL_TRANSITION — another tab/device already moved this order) maps to ADVANCE_STALE, a MORE specific message than the generic failure copy", async () => {
      mockSessionClient(true);
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockFetchResponse(409, { ok: false, code: "ILLEGAL_TRANSITION" })) as never;

      const result = await advanceOrder("order-1", "READY");

      expect(result).toEqual({ ok: false, error: ADVANCE_STALE });
      expect(ADVANCE_STALE).not.toBe(ADVANCE_FAILED); // distinct Thai copy, not folded into the generic message
    });

    it("a non-409 failure (e.g. 403 FORBIDDEN) maps to the generic ADVANCE_FAILED, never leaking the raw error code to the merchant", async () => {
      mockSessionClient(true);
      globalThis.fetch = vi.fn().mockResolvedValue(mockFetchResponse(403, { ok: false, code: "FORBIDDEN" })) as never;

      const result = await advanceOrder("order-1", "PREPARING");

      expect(result).toEqual({ ok: false, error: ADVANCE_FAILED });
    });

    it("a network failure (fetch throws) is caught and reported as ADVANCE_FAILED, not an unhandled rejection", async () => {
      mockSessionClient(true);
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as never;

      const result = await advanceOrder("order-1", "PREPARING");

      expect(result).toEqual({ ok: false, error: ADVANCE_FAILED });
    });
  });

  describe("bulkMarkReady", () => {
    it("empty orderIds -> ok:true, empty results, no fetch call at all", async () => {
      mockSessionClient(true);
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as never;

      const result = await bulkMarkReady([]);

      expect(result).toEqual({ ok: true, results: [] });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("posts orderIds to console-bulk-ready-orders and returns the PER-ORDER results array verbatim, naming which ones failed — not collapsed into one boolean", async () => {
      mockSessionClient(true);
      const backendResults = [
        { orderId: "order-a", ok: true },
        { orderId: "order-b", ok: false, code: "ILLEGAL_TRANSITION" },
        { orderId: "order-c", ok: true },
      ];
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(200, { ok: true, results: backendResults }));
      globalThis.fetch = fetchMock as never;

      const result = await bulkMarkReady(["order-a", "order-b", "order-c"]);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.results).toEqual(backendResults);
        const failed = result.results.filter((r) => !r.ok);
        expect(failed.map((r) => r.orderId)).toEqual(["order-b"]); // the specific failing order is nameable
      }
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${SUPABASE_URL}/functions/v1/console-bulk-ready-orders`);
      expect(JSON.parse(init.body as string)).toEqual({ orderIds: ["order-a", "order-b", "order-c"] });
    });

    it("a total request failure (network error / non-200 / malformed body) -> ok:false, ADVANCE_FAILED — distinct shape from a partial per-order failure", async () => {
      mockSessionClient(true);
      globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as never;

      const result = await bulkMarkReady(["order-a"]);

      expect(result).toEqual({ ok: false, error: ADVANCE_FAILED });
    });
  });
});
