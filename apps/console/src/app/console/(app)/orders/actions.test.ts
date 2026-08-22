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
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/merchant", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/merchant")>("../../../../lib/merchant");
  return { ...actual, resolveMerchantCtx: vi.fn() };
});

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { markOrdersSeen, setNotifySoundMuted, savePushSubscription, deletePushSubscription } from "./actions";

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
