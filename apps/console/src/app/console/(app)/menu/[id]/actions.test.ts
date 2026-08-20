// WBS 4.4 — unit tests for saveMenuItem / updateMenuItemImage. Mocking
// pattern mirrors ../../settings/store/actions.test.ts (WBS 4.3).
//
// The FIRST describe block is this entry's core RL-2 acceptance criterion,
// unit-tested at the level this entry actually owns (the Server Action a
// merchant's "Save" tap calls): "a menu item saves with only a name and a
// price ... An item with no BOM shows cost as '—' and never as 0 anywhere in
// the console." A real end-to-end "insert an item, then complete a full sale
// of it" already exists as a DB-level test --
// packages/db/tests/schema.test.ts's "WBS 3.5 — RL-2 zero-BOM insert and
// sale" -- because no order-creation Edge Function exists yet (WBS 5.x is
// unbuilt; see CLAUDE.md's migration table). That test proves
// unit_cost_snapshot_satang is NULL, never 0, for a zero-BOM item sold
// through a real order_items insert. This file proves the complementary
// half: saveMenuItem itself never requires, reads, writes, or defaults a
// cost/BOM field -- there is no code path here that COULD produce a 0.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/merchant", () => ({
  resolveMerchantCtx: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { saveMenuItem, updateMenuItemImage, type SaveMenuItemInput } from "./actions";

const mockedCreateClient = vi.mocked(createClient);
const mockedResolveMerchantCtx = vi.mocked(resolveMerchantCtx);

const MERCHANT_ID = "22222222-2222-4222-8222-222222222222";
const OWNED_STORE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_STORE_ID = "99999999-9999-4999-8999-999999999999";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";

const BASE_INPUT: SaveMenuItemInput = {
  itemId: null,
  storeId: OWNED_STORE_ID,
  name: "ลาเต้เย็น",
  priceSatang: 6000,
  description: null,
  optionGroups: [],
};

/** A minimal client whose menu_items insert/select/single chain succeeds and
 * captures the exact row passed to `.insert()`. `menu_option_groups`/
 * `menu_options` calls return an empty-success shape too, so a test can
 * assert nothing beyond the item row was required to reach `ok: true`. */
function buildSuccessClient(opts: { insertedItemRows: Array<Record<string, unknown>> } ) {
  const fromMock = vi.fn((table: string) => {
    if (table === "menu_items") {
      return {
        insert: (row: Record<string, unknown>) => {
          opts.insertedItemRows.push(row);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: ITEM_ID, name: row.name, price_satang: row.price_satang, description: row.description, image_path: null },
                  error: null,
                }),
            }),
          };
        },
        update: (row: Record<string, unknown>) => {
          opts.insertedItemRows.push(row);
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { id: ITEM_ID, name: row.name, price_satang: row.price_satang, description: row.description, image_path: null },
                      error: null,
                    }),
                }),
              }),
            }),
          };
        },
      };
    }
    if (table === "menu_option_groups") {
      return {
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        delete: () => ({ in: () => Promise.resolve({ error: null }) }),
        insert: () => ({
          select: () => ({ single: () => Promise.resolve({ data: { id: "group-1" }, error: null }) }),
        }),
      };
    }
    if (table === "menu_options") {
      return { insert: () => Promise.resolve({ error: null }) };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return { from: fromMock };
}

function buildUnreachableClient() {
  return {
    from: vi.fn(() => {
      throw new Error("must not touch the DB client for a rejected storeId");
    }),
  };
}

describe("saveMenuItem — RL-2: name + price only must succeed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("succeeds with only name and price -- description null, no option groups, no BOM/cost field anywhere in the call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    const insertedItemRows: Array<Record<string, unknown>> = [];
    mockedCreateClient.mockResolvedValue(buildSuccessClient({ insertedItemRows }) as never);

    const result = await saveMenuItem(BASE_INPUT);

    expect(result).toEqual({
      ok: true,
      item: { id: ITEM_ID, name: "ลาเต้เย็น", priceSatang: 6000, description: null, imagePath: null },
    });
    // The exact row sent to Postgres carries no cost/bom/margin-shaped key —
    // proves this code path cannot default an unknown cost to 0.
    expect(insertedItemRows[0]).toEqual({
      name: "ลาเต้เย็น",
      price_satang: 6000,
      description: null,
      store_id: OWNED_STORE_ID,
    });
    expect(Object.keys(insertedItemRows[0])).not.toEqual(
      expect.arrayContaining(["cost", "cost_satang", "unit_cost_satang", "margin"]),
    );
  });

  it("also succeeds with a full payload (description + option groups with zero/negative deltas) -- optional fields are optional, not forbidden", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    const insertedItemRows: Array<Record<string, unknown>> = [];
    mockedCreateClient.mockResolvedValue(buildSuccessClient({ insertedItemRows }) as never);

    const result = await saveMenuItem({
      ...BASE_INPUT,
      description: "นมสดกับเอสเพรสโซ่สองช็อต",
      optionGroups: [
        {
          name: "ร้อน / เย็น / ปั่น",
          options: [
            { name: "ร้อน", priceDeltaSatang: 0 },
            { name: "เย็น", priceDeltaSatang: 500 },
            { name: "ปั่น", priceDeltaSatang: -200 },
          ],
        },
      ],
    });

    expect(result).toEqual({ ok: true, item: expect.objectContaining({ id: ITEM_ID }) });
  });

  it("blank name is rejected without a DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });

    const result = await saveMenuItem({ ...BASE_INPUT, name: "   " });

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("price <= 0 is rejected without a DB call -- price is required, unlike everything else", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });

    const result = await saveMenuItem({ ...BASE_INPUT, priceSatang: 0 });

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("a storeId not owned by the merchant is rejected before any DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });

    const result = await saveMenuItem({ ...BASE_INPUT, storeId: OTHER_STORE_ID });

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("the unreachable-client canary confirms no query is attempted for a forged storeId", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

    await expect(saveMenuItem({ ...BASE_INPUT, storeId: OTHER_STORE_ID })).resolves.toEqual({
      error: expect.any(String),
    });
  });

  function buildItemUpdateFrom(insertedItemRows: Array<Record<string, unknown>>) {
    return (row: Record<string, unknown>) => {
      insertedItemRows.push(row);
      return {
        eq: (col1: string, val1: unknown) => {
          expect(col1).toBe("id");
          expect(val1).toBe(ITEM_ID);
          return {
            eq: (col2: string, val2: unknown) => {
              expect(col2).toBe("store_id");
              expect(val2).toBe(OWNED_STORE_ID);
              return {
                select: () => ({
                  single: () =>
                    Promise.resolve({
                      data: { id: ITEM_ID, name: row.name, price_satang: row.price_satang, description: row.description, image_path: null },
                      error: null,
                    }),
                }),
              };
            },
          };
        },
      };
    };
  }

  it("editing an existing item (itemId set) goes through update, scoped by id AND store_id, inserts the new option groups, then deletes the OLD groups by id -- new-before-old", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    const insertedItemRows: Array<Record<string, unknown>> = [];
    const OLD_GROUP_IDS = ["old-group-1", "old-group-2"];
    const deleteInMock = vi.fn().mockResolvedValue({ error: null });
    const callOrder: string[] = [];
    const fromMock = vi.fn((table: string) => {
      if (table === "menu_items") {
        return { update: buildItemUpdateFrom(insertedItemRows) };
      }
      if (table === "menu_option_groups") {
        return {
          select: () => ({
            eq: (col: string, val: unknown) => {
              expect(col).toBe("menu_item_id");
              expect(val).toBe(ITEM_ID);
              return Promise.resolve({ data: OLD_GROUP_IDS.map((id) => ({ id })), error: null });
            },
          }),
          insert: () => ({
            select: () => ({
              single: () => {
                callOrder.push("insert-new-group");
                return Promise.resolve({ data: { id: "new-group-1" }, error: null });
              },
            }),
          }),
          delete: () => ({
            in: (col: string, ids: unknown) => {
              expect(col).toBe("id");
              callOrder.push("delete-old-groups");
              return deleteInMock(ids);
            },
          }),
        };
      }
      if (table === "menu_options") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    });
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    const result = await saveMenuItem({
      ...BASE_INPUT,
      itemId: ITEM_ID,
      optionGroups: [{ name: "ร้อน / เย็น", options: [{ name: "เย็น", priceDeltaSatang: 500 }] }],
    });

    expect(result).toEqual({ ok: true, item: expect.objectContaining({ id: ITEM_ID }) });
    expect(callOrder).toEqual(["insert-new-group", "delete-old-groups"]);
    expect(deleteInMock).toHaveBeenCalledWith(OLD_GROUP_IDS);
  });

  it("a later option-group insert failing leaves the PREVIOUS option groups intact -- old groups are never deleted, and the partial new insert is not the saved state", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    const insertedItemRows: Array<Record<string, unknown>> = [];
    const OLD_GROUP_IDS = ["old-group-1", "old-group-2"];
    const deleteMock = vi.fn();
    let insertCallCount = 0;
    const fromMock = vi.fn((table: string) => {
      if (table === "menu_items") {
        return { update: buildItemUpdateFrom(insertedItemRows) };
      }
      if (table === "menu_option_groups") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: OLD_GROUP_IDS.map((id) => ({ id })), error: null }),
          }),
          insert: () => ({
            select: () => ({
              single: () => {
                insertCallCount += 1;
                if (insertCallCount === 3) {
                  return Promise.resolve({ data: null, error: { message: "transient failure" } });
                }
                return Promise.resolve({ data: { id: `new-group-${insertCallCount}` }, error: null });
              },
            }),
          }),
          delete: deleteMock,
        };
      }
      if (table === "menu_options") {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      throw new Error(`unexpected table: ${table}`);
    });
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    const result = await saveMenuItem({
      ...BASE_INPUT,
      itemId: ITEM_ID,
      optionGroups: [
        { name: "กลุ่ม 1", options: [{ name: "ตัวเลือก 1", priceDeltaSatang: 0 }] },
        { name: "กลุ่ม 2", options: [{ name: "ตัวเลือก 2", priceDeltaSatang: 0 }] },
        { name: "กลุ่ม 3", options: [{ name: "ตัวเลือก 3", priceDeltaSatang: 0 }] },
      ],
    });

    expect(result).toEqual({ error: expect.any(String) });
    // The old groups are the merchant's saved state until every new insert
    // succeeds -- a failed 3rd insert must never trigger the delete step,
    // or the previous, still-working option groups would be lost.
    expect(deleteMock).not.toHaveBeenCalled();
    expect(insertCallCount).toBe(3);
  });
});

describe("updateMenuItemImage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a storeId not owned by the merchant is rejected before any DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });

    const result = await updateMenuItemImage(ITEM_ID, OTHER_STORE_ID, `${OTHER_STORE_ID}/${ITEM_ID}.webp`);

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("writes image_path scoped by id and store_id", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const updateMock = vi.fn().mockReturnValue({ eq: eq1 });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    const path = `${OWNED_STORE_ID}/${ITEM_ID}.webp`;
    const result = await updateMenuItemImage(ITEM_ID, OWNED_STORE_ID, path);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledWith({ image_path: path });
    expect(eq1).toHaveBeenCalledWith("id", ITEM_ID);
    expect(eq2).toHaveBeenCalledWith("store_id", OWNED_STORE_ID);
  });
});
