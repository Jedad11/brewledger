// WBS 5.3 qa_engineer leg — regression coverage for updateSlotCapacity() and
// applyDefaultCapacity() (actions.ts), the merchant capacity console screen's
// two writes. Mocking pattern mirrors settings/payments/actions.test.ts and
// settings/store/actions.test.ts: createClient()/resolveMerchantCtx() mocked
// at the module boundary, a hand-built chainable fake standing in for the
// Supabase query builder.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/merchant", () => ({
  resolveMerchantCtx: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { applyDefaultCapacity, updateSlotCapacity } from "./actions";

const mockedCreateClient = vi.mocked(createClient);
const mockedResolveMerchantCtx = vi.mocked(resolveMerchantCtx);

const MERCHANT_ID = "22222222-2222-4222-8222-222222222222";
const OWNED_STORE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_MERCHANTS_STORE_ID = "99999999-9999-4999-8999-999999999999";
const SLOT_ID = "44444444-4444-4444-8444-444444444444";

const BASE_MERCHANT_CTX = {
  merchantId: MERCHANT_ID,
  subscriptionTier: "free" as const,
  storeIds: [OWNED_STORE_ID],
  stores: [],
};

/** A client whose from() throws if reached -- proves rejection happened before any DB call. */
function buildUnreachableClient() {
  const fromMock = vi.fn(() => {
    throw new Error("must not touch the DB client here");
  });
  return { from: fromMock };
}

describe("updateSlotCapacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a storeId NOT in the merchant's storeIds is rejected before any DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

    const result = await updateSlotCapacity(OTHER_MERCHANTS_STORE_ID, SLOT_ID, 5);

    expect("ok" in result).toBe(false);
  });

  it("resolveMerchantCtx() returning null is rejected without a DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue(null);

    const result = await updateSlotCapacity(OWNED_STORE_ID, SLOT_ID, 5);

    expect("ok" in result).toBe(false);
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("a non-positive capacity is rejected before any DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

    const result = await updateSlotCapacity(OWNED_STORE_ID, SLOT_ID, 0);

    expect("ok" in result).toBe(false);
  });

  it("a non-integer capacity is rejected before any DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

    const result = await updateSlotCapacity(OWNED_STORE_ID, SLOT_ID, 2.5);

    expect("ok" in result).toBe(false);
  });

  it("a valid update scopes by BOTH slotId and storeId, and returns ok", async () => {
    const eqSlotMock = vi.fn();
    const eqStoreMock = vi.fn().mockResolvedValue({ error: null });
    eqSlotMock.mockReturnValue({ eq: eqStoreMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqSlotMock });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });

    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    const result = await updateSlotCapacity(OWNED_STORE_ID, SLOT_ID, 5);

    expect(result).toEqual({ ok: true });
    expect(fromMock).toHaveBeenCalledWith("pickup_slots");
    expect(updateMock).toHaveBeenCalledWith({ capacity: 5 });
    expect(eqSlotMock).toHaveBeenCalledWith("id", SLOT_ID);
    expect(eqStoreMock).toHaveBeenCalledWith("store_id", OWNED_STORE_ID);
  });

  it("a 23514 (CHECK constraint violation) from the DB is reported as the specific capacity-invalid error, not the generic save error", async () => {
    const eqSlotMock = vi.fn();
    const eqStoreMock = vi.fn().mockResolvedValue({ error: { code: "23514", message: "violates check constraint" } });
    eqSlotMock.mockReturnValue({ eq: eqStoreMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqSlotMock });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });

    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    // A capacity that would drop below the slot's current booked_count is
    // caught server-side by pickup_slots' own `check (booked_count <=
    // capacity)` (0010_pickup_slots.sql) -- this proves that 23514 is
    // surfaced as the specific "จำนวนต้องมากกว่า 0"-family error rather than
    // the generic SAVE_ERROR, so a merchant sees why, not just "failed."
    const result = await updateSlotCapacity(OWNED_STORE_ID, SLOT_ID, 1);

    expect("ok" in result).toBe(false);
    if ("error" in result) {
      expect(result.error).not.toBe("");
    }
  });
});

describe("applyDefaultCapacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a storeId NOT in the merchant's storeIds is rejected before any DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

    const result = await applyDefaultCapacity(OTHER_MERCHANTS_STORE_ID, 5);

    expect("ok" in result).toBe(false);
  });

  it("a non-positive capacity is rejected before any DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

    const result = await applyDefaultCapacity(OWNED_STORE_ID, -1);

    expect("ok" in result).toBe(false);
  });

  function buildApplyMock(opts: {
    storeUpdateErr?: { code?: string; message: string } | null;
    eligibleRows: { id: string; booked_count: number }[];
    bulkUpdateErr?: { message: string } | null;
    bulkUpdateCount?: number | null;
  }) {
    // stores.update(...).eq(...)
    const storesEqMock = vi.fn().mockResolvedValue({ error: opts.storeUpdateErr ?? null });
    const storesUpdateMock = vi.fn().mockReturnValue({ eq: storesEqMock });

    // pickup_slots.select(...).eq(...).eq(...).gt(...)
    const selectGtMock = vi.fn().mockResolvedValue({ data: opts.eligibleRows, error: null });
    const selectEq2Mock = vi.fn().mockReturnValue({ gt: selectGtMock });
    const selectEq1Mock = vi.fn().mockReturnValue({ eq: selectEq2Mock });
    const selectMock = vi.fn().mockReturnValue({ eq: selectEq1Mock });

    // pickup_slots.update(...,{count}).in(...)
    const inMock = vi
      .fn()
      .mockResolvedValue({ error: opts.bulkUpdateErr ?? null, count: opts.bulkUpdateCount ?? null });
    const bulkUpdateMock = vi.fn().mockReturnValue({ in: inMock });

    const fromMock = vi.fn((table: string) => {
      if (table === "stores") return { update: storesUpdateMock };
      if (table === "pickup_slots") return { select: selectMock, update: bulkUpdateMock };
      throw new Error(`unexpected table: ${table}`);
    });

    return { from: fromMock, storesUpdateMock, selectMock, bulkUpdateMock, inMock };
  }

  it("persists the new default on stores AND bulk-updates every eligible future open slot, reporting the count", async () => {
    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    const mock = buildApplyMock({
      eligibleRows: [
        { id: "s1", booked_count: 0 },
        { id: "s2", booked_count: 1 },
      ],
      bulkUpdateCount: 2,
    });
    mockedCreateClient.mockResolvedValue(mock as never);

    const result = await applyDefaultCapacity(OWNED_STORE_ID, 5);

    expect(result).toEqual({ ok: true, updated: 2, skipped: 0 });
    expect(mock.storesUpdateMock).toHaveBeenCalledWith({ default_slot_capacity: 5 });
    expect(mock.bulkUpdateMock).toHaveBeenCalledWith({ capacity: 5 }, { count: "exact" });
    expect(mock.inMock).toHaveBeenCalledWith("id", ["s1", "s2"]);
  });

  it("skips (does not include in the .in() call) a slot already booked past the new, lower capacity", async () => {
    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    const mock = buildApplyMock({
      eligibleRows: [
        { id: "s1", booked_count: 0 }, // updatable: 0 <= 1
        { id: "s2", booked_count: 3 }, // NOT updatable: 3 > 1 -- would violate the CHECK constraint
      ],
      bulkUpdateCount: 1,
    });
    mockedCreateClient.mockResolvedValue(mock as never);

    const result = await applyDefaultCapacity(OWNED_STORE_ID, 1);

    expect(result).toEqual({ ok: true, updated: 1, skipped: 1 });
    expect(mock.inMock).toHaveBeenCalledWith("id", ["s1"]);
  });

  it("no eligible slots at all: still persists the default, reports zero updated/skipped, never calls the bulk update", async () => {
    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    const mock = buildApplyMock({ eligibleRows: [] });
    mockedCreateClient.mockResolvedValue(mock as never);

    const result = await applyDefaultCapacity(OWNED_STORE_ID, 5);

    expect(result).toEqual({ ok: true, updated: 0, skipped: 0 });
    expect(mock.bulkUpdateMock).not.toHaveBeenCalled();
  });

  it("every eligible slot already booked past the new capacity: zero updated, all skipped, never calls the bulk update", async () => {
    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    const mock = buildApplyMock({ eligibleRows: [{ id: "s1", booked_count: 5 }] });
    mockedCreateClient.mockResolvedValue(mock as never);

    const result = await applyDefaultCapacity(OWNED_STORE_ID, 1);

    expect(result).toEqual({ ok: true, updated: 0, skipped: 1 });
    expect(mock.bulkUpdateMock).not.toHaveBeenCalled();
  });

  it("the stores update failing returns an error and never reads/writes pickup_slots", async () => {
    mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
    const mock = buildApplyMock({
      storeUpdateErr: { message: "connection reset" },
      eligibleRows: [],
    });
    mockedCreateClient.mockResolvedValue(mock as never);

    const result = await applyDefaultCapacity(OWNED_STORE_ID, 5);

    expect("ok" in result).toBe(false);
    expect(mock.selectMock).not.toHaveBeenCalled();
  });
});
