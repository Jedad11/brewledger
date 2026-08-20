// WBS 4.4 — unit tests for toggleMenuItemAvailability / reorderMenuItems.
// Mocking pattern mirrors ../settings/store/actions.test.ts (WBS 4.3):
// createClient()/resolveMerchantCtx() mocked at the module boundary, no real
// DB needed for these -- pure ownership-guard-then-Supabase-call control flow.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/merchant", () => ({
  resolveMerchantCtx: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { toggleMenuItemAvailability, reorderMenuItems } from "./actions";

const mockedCreateClient = vi.mocked(createClient);
const mockedResolveMerchantCtx = vi.mocked(resolveMerchantCtx);

const MERCHANT_ID = "22222222-2222-4222-8222-222222222222";
const OWNED_STORE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_STORE_ID = "99999999-9999-4999-8999-999999999999";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";

function buildUnreachableClient() {
  return {
    from: vi.fn(() => {
      throw new Error("must not touch the DB client for a rejected storeId");
    }),
  };
}

describe("toggleMenuItemAvailability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a storeId not owned by the merchant is rejected before any DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [OWNED_STORE_ID], stores: [] });

    const result = await toggleMenuItemAvailability(OTHER_STORE_ID, ITEM_ID, "hidden");

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("the unreachable-client canary confirms no query is attempted for a forged storeId", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [OWNED_STORE_ID], stores: [] });
    mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

    await expect(toggleMenuItemAvailability(OTHER_STORE_ID, ITEM_ID, "hidden")).resolves.toEqual({
      error: expect.any(String),
    });
  });

  it("writes availability='hidden' and scopes the update by both id and store_id", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [OWNED_STORE_ID], stores: [] });
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const updateMock = vi.fn().mockReturnValue({ eq: eq1 });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    const result = await toggleMenuItemAvailability(OWNED_STORE_ID, ITEM_ID, "hidden");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ availability: "hidden" });
    expect(eq1).toHaveBeenCalledWith("id", ITEM_ID);
    expect(eq2).toHaveBeenCalledWith("store_id", OWNED_STORE_ID);
  });

  it("writes availability='available' just as readily -- the toggle is bidirectional", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [OWNED_STORE_ID], stores: [] });
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const updateMock = vi.fn().mockReturnValue({ eq: eq1 });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    const result = await toggleMenuItemAvailability(OWNED_STORE_ID, ITEM_ID, "available");

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ availability: "available" });
  });

  it("a Supabase error surfaces as the generic save-error string, not the raw Postgres message", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [OWNED_STORE_ID], stores: [] });
    const eq2 = vi.fn().mockResolvedValue({ error: { message: "connection reset" } });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const updateMock = vi.fn().mockReturnValue({ eq: eq1 });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    const result = await toggleMenuItemAvailability(OWNED_STORE_ID, ITEM_ID, "hidden");

    expect(result).toEqual({ error: expect.any(String) });
    expect("ok" in result).toBe(false);
  });
});

describe("reorderMenuItems", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a storeId not owned by the merchant is rejected before any DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [OWNED_STORE_ID], stores: [] });

    const result = await reorderMenuItems(OTHER_STORE_ID, ["a", "b"]);

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("writes sort_order = array index for every id in the ordered list", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [OWNED_STORE_ID], stores: [] });

    const updateCalls: unknown[] = [];
    const eqCalls: Array<[string, unknown]> = [];
    const fromMock = vi.fn(() => ({
      update: (row: unknown) => {
        updateCalls.push(row);
        return {
          eq: (col1: string, val1: unknown) => {
            eqCalls.push([col1, val1]);
            return {
              eq: (col2: string, val2: unknown) => {
                eqCalls.push([col2, val2]);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      },
    }));
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    const result = await reorderMenuItems(OWNED_STORE_ID, ["item-c", "item-a", "item-b"]);

    expect(result).toEqual({ ok: true });
    expect(updateCalls).toEqual([{ sort_order: 0 }, { sort_order: 1 }, { sort_order: 2 }]);
    expect(eqCalls).toEqual([
      ["id", "item-c"],
      ["store_id", OWNED_STORE_ID],
      ["id", "item-a"],
      ["store_id", OWNED_STORE_ID],
      ["id", "item-b"],
      ["store_id", OWNED_STORE_ID],
    ]);
  });

  it("any single update failing in the batch surfaces as an overall error", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [OWNED_STORE_ID], stores: [] });

    let call = 0;
    const fromMock = vi.fn(() => ({
      update: () => ({
        eq: () => ({
          eq: () => {
            call += 1;
            return Promise.resolve(call === 2 ? { error: { message: "boom" } } : { error: null });
          },
        }),
      }),
    }));
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    const result = await reorderMenuItems(OWNED_STORE_ID, ["a", "b", "c"]);

    expect(result).toEqual({ error: expect.any(String) });
  });
});
