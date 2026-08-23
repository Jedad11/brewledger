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
import {
  saveMenuItem,
  updateMenuItemImage,
  dismissRecipeSuggestion,
  type SaveMenuItemInput,
  type RecipeLineInput,
} from "./actions";

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
  // WBS 6.7 added `recipe` to this input; `null` here reproduces this
  // suite's original scope exactly -- "the recipe block was never touched
  // this save" -- so every pre-existing case below still exercises the same
  // bom_lines-untouched path it always has. bom_lines-specific coverage for
  // the new upsert/cleanup path this entry adds belongs in its own test,
  // not folded into these pre-existing cases.
  recipe: null,
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

// WBS 6.7 — redline_reviewer HIGH finding: "Zero test coverage for the new
// bom_lines upsert/delete-stale logic and dismissRecipeSuggestion." Covers
// cases (a)-(f) from that finding exactly.
//
// The bom_lines mock below is deliberately NOT a rubber-stamp
// `{ error: null }` responder (that would pass regardless of whether
// saveMenuItem used upsert or the option-groups insert-then-delete pattern,
// proving nothing about case (b)). It is a tiny in-memory table keyed by
// ingredient_id that reproduces bom_lines' own real constraint
// (`UNIQUE(menu_item_id, ingredient_id)`, 0009_bom_lines.sql) and real
// `ON CONFLICT (menu_item_id, ingredient_id) DO UPDATE` semantics: upserting
// a row whose ingredient_id already exists updates that SAME row in place;
// it never creates a second row and never raises a unique_violation. A
// version of saveMenuItem that reverted to the option-groups "insert new,
// then delete old" pattern for bom_lines would call this mock's `.insert`
// method, which does not exist here — the test fails with a thrown "table
// bom_lines has no insert handler" rather than silently passing.
describe("saveMenuItem — WBS 6.7: bom_lines recipe persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  const ING_1 = "55555555-5555-4555-8555-555555555501";
  const ING_2 = "55555555-5555-4555-8555-555555555502";
  const BOM_ROW_1 = "66666666-6666-4666-8666-666666666601";
  const BOM_ROW_2 = "66666666-6666-4666-8666-666666666602";

  interface FakeBomRow {
    id: string;
    ingredient_id: string;
    qty_base_unit: number;
    store_id: string;
    menu_item_id: string;
  }

  /** Models bom_lines' real UNIQUE(menu_item_id, ingredient_id) + upsert
   * semantics — see the describe-level comment above for why. */
  function buildBomLinesTable(opts: {
    existingRows: FakeBomRow[];
    upsertCalls: Array<{ rows: Record<string, unknown>[]; onConflict?: string }>;
    deleteInCalls: string[][];
  }) {
    const store = new Map<string, FakeBomRow>(opts.existingRows.map((r) => [r.ingredient_id, r]));
    let nextRowSuffix = 900;

    return {
      upsert: (rows: Record<string, unknown>[], config?: { onConflict?: string }) => {
        opts.upsertCalls.push({ rows, onConflict: config?.onConflict });
        for (const row of rows) {
          const ingredientId = row.ingredient_id as string;
          const existing = store.get(ingredientId);
          if (existing) {
            // Real ON CONFLICT ... DO UPDATE: same row, quantity changed in
            // place. NOT a second row, NOT a unique_violation.
            store.set(ingredientId, { ...existing, qty_base_unit: row.qty_base_unit as number });
          } else {
            nextRowSuffix += 1;
            store.set(ingredientId, {
              id: `bom-new-${nextRowSuffix}`,
              ingredient_id: ingredientId,
              qty_base_unit: row.qty_base_unit as number,
              store_id: row.store_id as string,
              menu_item_id: row.menu_item_id as string,
            });
          }
        }
        return Promise.resolve({ error: null });
      },
      select: () => ({
        eq: () =>
          Promise.resolve({
            data: Array.from(store.values()).map((r) => ({ id: r.id, ingredient_id: r.ingredient_id })),
            error: null,
          }),
      }),
      delete: () => ({
        in: (_col: string, ids: string[]) => {
          opts.deleteInCalls.push(ids);
          for (const [key, row] of store) {
            if (ids.includes(row.id)) store.delete(key);
          }
          return Promise.resolve({ error: null });
        },
      }),
      snapshot: () => new Map(store),
    };
  }

  function buildIngredientsTable(ownedIds: string[]) {
    return {
      select: () => ({
        eq: () => ({
          in: (_col: string, ids: string[]) =>
            Promise.resolve({ data: ownedIds.filter((id) => ids.includes(id)).map((id) => ({ id })), error: null }),
        }),
      }),
    };
  }

  /** A menu_items `.update()` chain for the ITEM_ID edit path — same shape
   * as the first describe block's own `buildItemUpdateFrom`, duplicated
   * locally rather than reaching into that nested function's closure. */
  function buildMenuItemsUpdateHandler() {
    return {
      update: (row: Record<string, unknown>) => ({
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
      }),
    };
  }

  const EMPTY_OPTION_GROUPS_HANDLER = {
    select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
  };

  function buildRecipeSaveClient(opts: {
    existingBomRows: FakeBomRow[];
    ownedIngredientIds: string[];
    upsertCalls: Array<{ rows: Record<string, unknown>[]; onConflict?: string }>;
    deleteInCalls: string[][];
  }) {
    const bomTable = buildBomLinesTable({
      existingRows: opts.existingBomRows,
      upsertCalls: opts.upsertCalls,
      deleteInCalls: opts.deleteInCalls,
    });
    const fromMock = vi.fn((table: string) => {
      if (table === "ingredients") return buildIngredientsTable(opts.ownedIngredientIds);
      if (table === "menu_items") return buildMenuItemsUpdateHandler();
      if (table === "menu_option_groups") return EMPTY_OPTION_GROUPS_HANDLER;
      if (table === "bom_lines") return bomTable;
      throw new Error(`unexpected table: ${table}`);
    });
    return { from: fromMock, bomTable };
  }

  function recipeInput(recipe: RecipeLineInput[]): SaveMenuItemInput {
    return { ...BASE_INPUT, itemId: ITEM_ID, recipe };
  }

  it("(a) adding a new ingredient line to an existing recipe upserts both lines and deletes nothing", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    const upsertCalls: Array<{ rows: Record<string, unknown>[]; onConflict?: string }> = [];
    const deleteInCalls: string[][] = [];
    const { from, bomTable } = buildRecipeSaveClient({
      existingBomRows: [{ id: BOM_ROW_1, ingredient_id: ING_1, qty_base_unit: 18, store_id: OWNED_STORE_ID, menu_item_id: ITEM_ID }],
      ownedIngredientIds: [ING_1, ING_2],
      upsertCalls,
      deleteInCalls,
    });
    mockedCreateClient.mockResolvedValue({ from } as never);

    const result = await saveMenuItem(
      recipeInput([
        { ingredientId: ING_1, qtyBaseUnit: 18 },
        { ingredientId: ING_2, qtyBaseUnit: 150 }, // the new line
      ]),
    );

    expect(result).toEqual({ ok: true, item: expect.objectContaining({ id: ITEM_ID }) });
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].onConflict).toBe("menu_item_id,ingredient_id");
    expect(upsertCalls[0].rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ingredient_id: ING_1, qty_base_unit: 18 }),
        expect.objectContaining({ ingredient_id: ING_2, qty_base_unit: 150 }),
      ]),
    );
    expect(deleteInCalls).toHaveLength(0); // the pre-existing line is kept, not stale
    expect(bomTable.snapshot().size).toBe(2);
  });

  it("(b) editing an existing line's quantity for the SAME ingredient upserts in place -- no unique-constraint collision, no duplicate row", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    const upsertCalls: Array<{ rows: Record<string, unknown>[]; onConflict?: string }> = [];
    const deleteInCalls: string[][] = [];
    const { from, bomTable } = buildRecipeSaveClient({
      existingBomRows: [{ id: BOM_ROW_1, ingredient_id: ING_1, qty_base_unit: 18, store_id: OWNED_STORE_ID, menu_item_id: ITEM_ID }],
      ownedIngredientIds: [ING_1],
      upsertCalls,
      deleteInCalls,
    });
    mockedCreateClient.mockResolvedValue({ from } as never);

    // Same ingredient (ING_1) as the pre-existing line, only the quantity
    // changes -- this is exactly the case an insert-then-delete pattern
    // would hit bom_lines' UNIQUE(menu_item_id, ingredient_id) on, since the
    // old row for ING_1 is still present when the new insert for ING_1
    // would run.
    const result = await saveMenuItem(recipeInput([{ ingredientId: ING_1, qtyBaseUnit: 25 }]));

    expect(result).toEqual({ ok: true, item: expect.objectContaining({ id: ITEM_ID }) });
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].onConflict).toBe("menu_item_id,ingredient_id");
    expect(deleteInCalls).toHaveLength(0); // ING_1 is kept, never marked stale

    // The proof: exactly ONE row for ING_1 afterward, with the NEW quantity
    // -- not two rows, not an error. Our bom_lines mock only allows this
    // because it models real ON CONFLICT DO UPDATE semantics; a mock that
    // just returned `{ error: null }` unconditionally would pass here even
    // if saveMenuItem used plain `.insert()` (which would 23505 for real).
    const finalRows = Array.from(bomTable.snapshot().values());
    expect(finalRows).toHaveLength(1);
    expect(finalRows[0]).toEqual(expect.objectContaining({ ingredient_id: ING_1, qty_base_unit: 25 }));
  });

  it("(g) a duplicate ingredientId within one request is deduped before upsert -- never two rows for the same conflict key in one call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    const upsertCalls: Array<{ rows: Record<string, unknown>[]; onConflict?: string }> = [];
    const deleteInCalls: string[][] = [];
    const { from } = buildRecipeSaveClient({
      existingBomRows: [],
      ownedIngredientIds: [ING_1],
      upsertCalls,
      deleteInCalls,
    });
    mockedCreateClient.mockResolvedValue({ from } as never);

    // Two lines claiming the SAME ingredient in one request -- real ON
    // CONFLICT DO UPDATE would 21000 ("command cannot affect row a second
    // time") if both reached upsert() together. saveMenuItem must dedup
    // before calling upsert, not rely on the DB to reject it.
    const result = await saveMenuItem(
      recipeInput([
        { ingredientId: ING_1, qtyBaseUnit: 18 },
        { ingredientId: ING_1, qtyBaseUnit: 99 },
      ]),
    );

    expect(result).toEqual({ ok: true, item: expect.objectContaining({ id: ITEM_ID }) });
    expect(upsertCalls).toHaveLength(1);
    const rowsForIng1 = upsertCalls[0].rows.filter((r) => r.ingredient_id === ING_1);
    expect(rowsForIng1).toHaveLength(1); // never two rows for the same conflict key in one call
  });

  it("(c) removing a line deletes only that line's row -- the kept line is untouched", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    const upsertCalls: Array<{ rows: Record<string, unknown>[]; onConflict?: string }> = [];
    const deleteInCalls: string[][] = [];
    const { from, bomTable } = buildRecipeSaveClient({
      existingBomRows: [
        { id: BOM_ROW_1, ingredient_id: ING_1, qty_base_unit: 18, store_id: OWNED_STORE_ID, menu_item_id: ITEM_ID },
        { id: BOM_ROW_2, ingredient_id: ING_2, qty_base_unit: 150, store_id: OWNED_STORE_ID, menu_item_id: ITEM_ID },
      ],
      ownedIngredientIds: [ING_1, ING_2],
      upsertCalls,
      deleteInCalls,
    });
    mockedCreateClient.mockResolvedValue({ from } as never);

    // ING_2's line is removed from the recipe; ING_1 stays.
    const result = await saveMenuItem(recipeInput([{ ingredientId: ING_1, qtyBaseUnit: 18 }]));

    expect(result).toEqual({ ok: true, item: expect.objectContaining({ id: ITEM_ID }) });
    expect(deleteInCalls).toEqual([[BOM_ROW_2]]); // ONLY the removed line's row id, never BOM_ROW_1
    const finalRows = Array.from(bomTable.snapshot().values());
    expect(finalRows).toHaveLength(1);
    expect(finalRows[0].ingredient_id).toBe(ING_1);
  });

  it("(e) a storeId not owned by the merchant is rejected before any DB call, even with a non-null recipe", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });

    const result = await saveMenuItem({
      ...recipeInput([{ ingredientId: ING_1, qtyBaseUnit: 18 }]),
      storeId: OTHER_STORE_ID,
    });

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("(f) a recipe line whose ingredientId is NOT owned by input.storeId is rejected atomically -- zero writes, not just a skipped bom_lines write", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    // Only ING_1 comes back as owned by OWNED_STORE_ID; ING_2 does not --
    // simulates ING_2 actually belonging to a different store.
    const fromMock = vi.fn((table: string) => {
      if (table === "ingredients") return buildIngredientsTable([ING_1]);
      // The whole save must reject before touching menu_items or bom_lines
      // at all -- proven the same way the existing "unreachable client"
      // canary proves it for the storeId-ownership check.
      throw new Error(`must not touch table "${table}" when a recipe ingredient is not owned`);
    });
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    const result = await saveMenuItem(
      recipeInput([
        { ingredientId: ING_1, qtyBaseUnit: 18 },
        { ingredientId: ING_2, qtyBaseUnit: 150 }, // not owned by OWNED_STORE_ID
      ]),
    );

    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("dismissRecipeSuggestion — WBS 6.7", () => {
  beforeEach(() => vi.clearAllMocks());

  it("(d) writes recipe_suggestion_dismissed_at scoped by id AND store_id", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
    const updateMock = vi.fn().mockReturnValue({ eq: eq1 });
    const fromMock = vi.fn().mockReturnValue({ update: updateMock });
    mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

    const result = await dismissRecipeSuggestion(ITEM_ID, OWNED_STORE_ID);

    expect(result).toEqual({ ok: true });
    expect(updateMock).toHaveBeenCalledTimes(1);
    const [[payload]] = updateMock.mock.calls;
    expect(typeof payload.recipe_suggestion_dismissed_at).toBe("string");
    expect(Number.isNaN(Date.parse(payload.recipe_suggestion_dismissed_at))).toBe(false);
    expect(eq1).toHaveBeenCalledWith("id", ITEM_ID);
    expect(eq2).toHaveBeenCalledWith("store_id", OWNED_STORE_ID);
  });

  it("(e) a storeId not owned by the merchant is rejected before any DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, subscriptionTier: "free", storeIds: [OWNED_STORE_ID], stores: [] });

    const result = await dismissRecipeSuggestion(ITEM_ID, OTHER_STORE_ID);

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });
});
