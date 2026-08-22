// WBS 5.1 / 5.3 qa_engineer leg, extended for the image-URL fix landed
// alongside this test file. menu.ts's own header comment says these
// functions are "kept dependency-free and side-effect-free so qa_engineer
// can unit test them directly without a browser or a live Supabase
// project" — this is that coverage. No test file existed for this module
// before this change (confirmed via find).
//
// toPublicMenuItemFromRealtimeRow and applyRealtimeMenuItemChange both
// picked up a new required supabaseUrl parameter as part of the same fix
// that added packages/shared's menuImagePublicUrl — this file's realtime
// row -> DTO mapper had the identical bug (image_path passed straight
// through as imageUrl, with no null handling at all) since it's a
// deliberately independent mirror of toPublicMenuItem, not an import of it
// (RL-3 import boundary — see this file's own header comment).
import { describe, expect, it } from "vitest";
import {
  applyRealtimeMenuItemChange,
  groupItemsByCategory,
  isAbsoluteHttpUrl,
  toPublicMenuItemFromRealtimeRow,
  type RealtimeMenuItemRow,
} from "./menu";
import type { PublicMenuCategory, PublicMenuItem } from "./publicApi";

const SUPABASE_URL = "https://project-ref.supabase.co";
const UUID_STORE = "55555555-5555-4555-8555-555555555555";
const UUID_ITEM_A = "11111111-1111-4111-8111-111111111111";
const UUID_ITEM_B = "22222222-2222-4222-8222-222222222222";
const UUID_CATEGORY = "44444444-4444-4444-8444-444444444444";

function makeRealtimeRow(overrides: Partial<RealtimeMenuItemRow> = {}): RealtimeMenuItemRow {
  return {
    id: UUID_ITEM_A,
    store_id: UUID_STORE,
    category_id: UUID_CATEGORY,
    name: "Latte",
    description: "Espresso with steamed milk",
    image_path: null,
    price_satang: 6500,
    availability: "available",
    sort_order: 0,
    ...overrides,
  };
}

function makeItem(overrides: Partial<PublicMenuItem> = {}): PublicMenuItem {
  return {
    id: UUID_ITEM_A,
    categoryId: UUID_CATEGORY,
    name: "Latte",
    description: null,
    imageUrl: null,
    priceSatang: 6500,
    availability: "available",
    sortOrder: 0,
    ...overrides,
  };
}

describe("toPublicMenuItemFromRealtimeRow — imageUrl", () => {
  it("image_path set produces a real absolute public Storage URL", () => {
    const row = makeRealtimeRow({ image_path: `${UUID_STORE}/${UUID_ITEM_A}.webp` });
    const result = toPublicMenuItemFromRealtimeRow(row, SUPABASE_URL);

    expect(result.imageUrl).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/menu-images/${UUID_STORE}/${UUID_ITEM_A}.webp`,
    );
    expect(isAbsoluteHttpUrl(result.imageUrl!)).toBe(true);
  });

  it("image_path null produces imageUrl: null, not the raw path and not a broken URL", () => {
    const row = makeRealtimeRow({ image_path: null });
    const result = toPublicMenuItemFromRealtimeRow(row, SUPABASE_URL);

    expect(result.imageUrl).toBeNull();
  });

  it("mirrors toPublicMenuItem field-for-field for every other field (regression check on the signature change)", () => {
    const row = makeRealtimeRow({ availability: "out_of_stock", sort_order: 2 });
    const result = toPublicMenuItemFromRealtimeRow(row, SUPABASE_URL);

    expect(result).toEqual({
      id: UUID_ITEM_A,
      categoryId: UUID_CATEGORY,
      name: "Latte",
      description: "Espresso with steamed milk",
      imageUrl: null,
      priceSatang: 6500,
      availability: "out_of_stock",
      sortOrder: 2,
    });
  });
});

describe("applyRealtimeMenuItemChange", () => {
  it("INSERT with image_path set adds the item with a real fetchable imageUrl", () => {
    const current: PublicMenuItem[] = [];
    const result = applyRealtimeMenuItemChange(
      current,
      {
        eventType: "INSERT",
        new: makeRealtimeRow({ image_path: `${UUID_STORE}/${UUID_ITEM_A}.webp` }),
        old: {},
      },
      SUPABASE_URL,
    );

    expect(result).toHaveLength(1);
    expect(result[0].imageUrl).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/menu-images/${UUID_STORE}/${UUID_ITEM_A}.webp`,
    );
  });

  it("INSERT with image_path null adds the item with imageUrl: null", () => {
    const result = applyRealtimeMenuItemChange(
      [],
      { eventType: "INSERT", new: makeRealtimeRow({ image_path: null }), old: {} },
      SUPABASE_URL,
    );

    expect(result).toHaveLength(1);
    expect(result[0].imageUrl).toBeNull();
  });

  it("UPDATE replaces the matching item and threads supabaseUrl through to the rebuilt imageUrl", () => {
    const current = [makeItem({ imageUrl: null })];
    const result = applyRealtimeMenuItemChange(
      current,
      {
        eventType: "UPDATE",
        new: makeRealtimeRow({ image_path: `${UUID_STORE}/${UUID_ITEM_A}.webp`, name: "Iced Latte" }),
        old: makeRealtimeRow({ image_path: null }),
      },
      SUPABASE_URL,
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Iced Latte");
    expect(result[0].imageUrl).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/menu-images/${UUID_STORE}/${UUID_ITEM_A}.webp`,
    );
  });

  it("UPDATE to availability 'hidden' removes the item entirely (regression: unrelated to the imageUrl fix)", () => {
    const current = [makeItem()];
    const result = applyRealtimeMenuItemChange(
      current,
      {
        eventType: "UPDATE",
        new: makeRealtimeRow({ availability: "hidden" }),
        old: makeRealtimeRow({}),
      },
      SUPABASE_URL,
    );

    expect(result).toHaveLength(0);
  });

  it("UPDATE to availability 'out_of_stock' keeps the item visible, greyed via availability field (regression)", () => {
    const current = [makeItem()];
    const result = applyRealtimeMenuItemChange(
      current,
      {
        eventType: "UPDATE",
        new: makeRealtimeRow({ availability: "out_of_stock" }),
        old: makeRealtimeRow({}),
      },
      SUPABASE_URL,
    );

    expect(result).toHaveLength(1);
    expect(result[0].availability).toBe("out_of_stock");
  });

  it("DELETE removes the item by id (regression)", () => {
    const current = [makeItem({ id: UUID_ITEM_A }), makeItem({ id: UUID_ITEM_B })];
    const result = applyRealtimeMenuItemChange(
      current,
      { eventType: "DELETE", new: {}, old: { id: UUID_ITEM_A } },
      SUPABASE_URL,
    );

    expect(result).toEqual([makeItem({ id: UUID_ITEM_B })]);
  });

  it("DELETE with no old.id is a no-op (regression, defensive branch)", () => {
    const current = [makeItem()];
    const result = applyRealtimeMenuItemChange(current, { eventType: "DELETE", new: {}, old: {} }, SUPABASE_URL);

    expect(result).toEqual(current);
  });

  it("an INSERT/UPDATE row missing a required column (e.g. price_satang) is skipped rather than crashing (regression)", () => {
    const current = [makeItem()];
    const incomplete: Partial<RealtimeMenuItemRow> = {
      id: UUID_ITEM_B,
      availability: "available",
      name: "New Item",
      // price_satang, description, image_path, sort_order, category_id deliberately absent
    };
    const result = applyRealtimeMenuItemChange(
      current,
      { eventType: "INSERT", new: incomplete, old: {} },
      SUPABASE_URL,
    );

    expect(result).toEqual(current);
  });
});

describe("groupItemsByCategory (regression — untouched by the imageUrl fix, included for full-file coverage)", () => {
  it("groups items under their matching category, ungrouped items trail", () => {
    const categories: PublicMenuCategory[] = [{ id: UUID_CATEGORY, name: "Coffee", sortOrder: 0 }];
    const items = [makeItem({ id: UUID_ITEM_A, categoryId: UUID_CATEGORY }), makeItem({ id: UUID_ITEM_B, categoryId: null })];

    const groups = groupItemsByCategory(categories, items);

    expect(groups).toHaveLength(2);
    expect(groups[0].category?.id).toBe(UUID_CATEGORY);
    expect(groups[0].items.map((i) => i.id)).toEqual([UUID_ITEM_A]);
    expect(groups[1].category).toBeNull();
    expect(groups[1].items.map((i) => i.id)).toEqual([UUID_ITEM_B]);
  });
});
