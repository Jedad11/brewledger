"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { uploadCompressedMenuImage } from "@brewledger/shared/dist/storage/menuImages";

// WBS 4.4 — RL-2 PRIMARY ENFORCEMENT POINT. saveMenuItem is the one place a
// merchant creates a sellable menu item, and it must succeed with ONLY name
// + price. It never requires an option group or a recipe line, and never
// computes or returns a cost figure -- cost stays unknown (null) until
// WBS 6.9's cost engine exists, and null is exactly what the console renders
// as "—". Do not add validation here that a recipe/BOM exists, or that any
// field beyond name/price is present -- that is precisely the RL-2
// violation this entry exists to prevent.
//
// WBS 6.7 update: `recipe` below is optional bom_lines persistence, bundled
// into this SAME save (interaction_spec.md: "Nothing else confirms. Saving
// a menu item without a recipe never confirms." -- there is no separate
// "save recipe" step). `recipe: null` means the recipe block was never
// opened/touched this save and bom_lines is left completely alone; `recipe:
// []` is a deliberate "no ingredients" edit and clears any existing rows.
const SAVE_ERROR = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
const MIN_PRICE_SATANG = 1;

function isOwnedStore(merchant: { storeIds: string[] }, storeId: string): boolean {
  return merchant.storeIds.includes(storeId);
}

export interface MenuOptionInput {
  name: string;
  priceDeltaSatang: number;
}

export interface MenuOptionGroupInput {
  name: string;
  options: MenuOptionInput[];
}

export interface RecipeLineInput {
  ingredientId: string;
  qtyBaseUnit: number;
}

export interface SaveMenuItemInput {
  itemId: string | null;
  storeId: string;
  name: string;
  priceSatang: number;
  description: string | null;
  optionGroups: MenuOptionGroupInput[];
  /** null = recipe block untouched this save, leave bom_lines alone.
   * See this file's own top comment for why [] is different from null. */
  recipe: RecipeLineInput[] | null;
}

export type SaveMenuItemResult =
  | {
      ok: true;
      item: { id: string; name: string; priceSatang: number; description: string | null; imagePath: string | null };
    }
  | { error: string };

/**
 * Upserts the menu_items row, then fully replaces its option groups/options
 * by inserting the NEW groups/options first and only deleting the OLD
 * menu_option_groups (menu_options cascades, see 0007_menu_options.sql)
 * once every new insert has succeeded. Not wrapped in a single DB
 * transaction: supabase-js has no multi-statement transaction primitive
 * short of a Postgres RPC, and this entry doesn't add one. With insert
 * ordered before delete, a mid-sequence failure (e.g. the third of three
 * new group inserts) leaves the OLD option groups untouched and still
 * live -- the item keeps its previous, intact set rather than a half-
 * written new one. Deleting first would commit whatever new groups
 * inserted before the failure as the final state, silently losing the
 * rest. Flagged for redline_reviewer as an accepted simplification, not
 * an oversight.
 */
export async function saveMenuItem(input: SaveMenuItemInput): Promise<SaveMenuItemResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: SAVE_ERROR };

  if (!isOwnedStore(merchant, input.storeId)) {
    console.error(`saveMenuItem: rejected storeId ${input.storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: SAVE_ERROR };
  }

  const name = input.name.trim();
  if (!name || !Number.isFinite(input.priceSatang) || input.priceSatang < MIN_PRICE_SATANG) {
    return { error: SAVE_ERROR };
  }

  const description = input.description?.trim() || null;
  const supabase = await createClient();

  // WBS 6.7 -- ingredientId comes from the client verbatim. RLS's
  // merchant_rw_bom_lines (0021) only checks store_id in auth_store_ids(),
  // not that ingredient_id's OWNING store matches input.storeId, so without
  // this check a merchant could attach another store's ingredient to their
  // own bom_lines row. Same pattern as console_confirm_purchase_invoice's
  // ingredient-ownership check (0044_console_confirm_purchase_invoice.sql
  // ~186-198). Runs before any write in this function -- the whole save
  // must reject atomically, not save the menu item and then fail on bom_lines.
  if (input.recipe !== null) {
    const ingredientIds = [...new Set(input.recipe.map((r) => r.ingredientId).filter(Boolean))];
    if (ingredientIds.length > 0) {
      const { data: ownedIngredients, error: ingredientsError } = await supabase
        .from("ingredients")
        .select("id")
        .eq("store_id", input.storeId)
        .in("id", ingredientIds);
      if (ingredientsError) return { error: SAVE_ERROR };
      if ((ownedIngredients ?? []).length !== ingredientIds.length) {
        console.error(
          `saveMenuItem: rejected recipe -- one or more ingredientId not owned by store ${input.storeId}`,
        );
        return { error: SAVE_ERROR };
      }
    }
  }

  const row = { name, price_satang: input.priceSatang, description, store_id: input.storeId };

  const { data, error } = input.itemId
    ? await supabase
        .from("menu_items")
        .update(row)
        .eq("id", input.itemId)
        .eq("store_id", input.storeId)
        .select("id, name, price_satang, description, image_path")
        .single()
    : await supabase
        .from("menu_items")
        .insert(row)
        .select("id, name, price_satang, description, image_path")
        .single();

  if (error || !data) return { error: SAVE_ERROR };

  const itemId = data.id as string;

  let oldGroupIds: string[] = [];
  if (input.itemId) {
    const { data: oldGroups, error: oldGroupsError } = await supabase
      .from("menu_option_groups")
      .select("id")
      .eq("menu_item_id", itemId);
    if (oldGroupsError) return { error: SAVE_ERROR };
    oldGroupIds = (oldGroups ?? []).map((g) => g.id as string);
  }

  const groupsToInsert = input.optionGroups
    .map((g) => ({ ...g, name: g.name.trim() }))
    .filter((g) => g.name.length > 0);

  for (let i = 0; i < groupsToInsert.length; i += 1) {
    const group = groupsToInsert[i];
    const { data: groupRow, error: groupError } = await supabase
      .from("menu_option_groups")
      .insert({ store_id: input.storeId, menu_item_id: itemId, name: group.name, sort_order: i })
      .select("id")
      .single();
    if (groupError || !groupRow) return { error: SAVE_ERROR };

    const optionsToInsert = group.options
      .map((o, j) => ({ name: o.name.trim(), priceDeltaSatang: o.priceDeltaSatang, sortOrder: j }))
      .filter((o) => o.name.length > 0);

    if (optionsToInsert.length === 0) continue;

    const { error: optionsError } = await supabase.from("menu_options").insert(
      optionsToInsert.map((o) => ({
        option_group_id: groupRow.id as string,
        name: o.name,
        price_delta_satang: o.priceDeltaSatang,
        sort_order: o.sortOrder,
      })),
    );
    if (optionsError) return { error: SAVE_ERROR };
  }

  if (oldGroupIds.length > 0) {
    const { error: deleteError } = await supabase.from("menu_option_groups").delete().in("id", oldGroupIds);
    if (deleteError) return { error: SAVE_ERROR };
  }

  // WBS 6.7 -- bom_lines has a UNIQUE (menu_item_id, ingredient_id) (0009),
  // so the option-groups pattern above (insert new rows, then delete the
  // old ones) does NOT work here: editing an existing line's quantity for
  // the SAME ingredient would collide with that ingredient's still-present
  // old row before the delete ever runs. Using upsert on that exact
  // constraint instead makes "update this ingredient's quantity" and
  // "add a new ingredient" the same atomic statement, with no window where
  // an existing line could be lost -- then a separate delete removes only
  // the ingredients the merchant actually took OFF the recipe (rows whose
  // id is old but whose ingredient is no longer in the new set).
  if (input.recipe !== null) {
    const seen = new Set<string>();
    const rowsToUpsert = input.recipe.filter(
      (r) => r.ingredientId && r.qtyBaseUnit > 0 && !seen.has(r.ingredientId) && seen.add(r.ingredientId),
    );

    if (rowsToUpsert.length > 0) {
      const { error: bomError } = await supabase.from("bom_lines").upsert(
        rowsToUpsert.map((r) => ({
          store_id: input.storeId,
          menu_item_id: itemId,
          ingredient_id: r.ingredientId,
          qty_base_unit: r.qtyBaseUnit,
        })),
        { onConflict: "menu_item_id,ingredient_id" },
      );
      if (bomError) return { error: SAVE_ERROR };
    }

    const keptIngredientIds = new Set(rowsToUpsert.map((r) => r.ingredientId));
    const { data: existingBomRows, error: existingBomError } = await supabase
      .from("bom_lines")
      .select("id, ingredient_id")
      .eq("menu_item_id", itemId);
    if (existingBomError) return { error: SAVE_ERROR };

    const staleIds = ((existingBomRows ?? []) as { id: string; ingredient_id: string }[])
      .filter((row) => !keptIngredientIds.has(row.ingredient_id))
      .map((row) => row.id);
    if (staleIds.length > 0) {
      const { error: staleDeleteError } = await supabase.from("bom_lines").delete().in("id", staleIds);
      if (staleDeleteError) return { error: SAVE_ERROR };
    }
  }

  return {
    ok: true,
    item: {
      id: itemId,
      name: data.name as string,
      priceSatang: data.price_satang as number,
      description: data.description as string | null,
      imagePath: data.image_path as string | null,
    },
  };
}

/**
 * WBS 6.7, RL-2: one dismissal is permanent for this menu item -- never
 * re-offer a suggestion once this is set. Fire-and-forget from the merchant's
 * point of view: no confirmation step (interaction_spec.md's "nothing else
 * confirms" rule for this screen), and a failure here has no user-visible
 * consequence beyond the suggestion possibly reappearing next visit -- it is
 * never worth surfacing an error banner for a dismiss click, since the worst
 * case is identical to never having dismissed at all.
 */
export type DismissRecipeSuggestionResult = { ok: true } | { error: string };

export async function dismissRecipeSuggestion(itemId: string, storeId: string): Promise<DismissRecipeSuggestionResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: SAVE_ERROR };
  if (!isOwnedStore(merchant, storeId)) {
    console.error(`dismissRecipeSuggestion: rejected storeId ${storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: SAVE_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("menu_items")
    .update({ recipe_suggestion_dismissed_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("store_id", storeId);

  if (error) return { error: SAVE_ERROR };
  return { ok: true };
}

export type UpdateMenuItemImageResult = { ok: true } | { error: string };

export async function updateMenuItemImage(
  itemId: string,
  storeId: string,
  imagePath: string,
): Promise<UpdateMenuItemImageResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: SAVE_ERROR };
  if (!isOwnedStore(merchant, storeId)) {
    console.error(`updateMenuItemImage: rejected storeId ${storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: SAVE_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("menu_items")
    .update({ image_path: imagePath })
    .eq("id", itemId)
    .eq("store_id", storeId);

  if (error) return { error: SAVE_ERROR };
  return { ok: true };
}

const PHOTO_UPLOAD_ERROR = "อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง";

export type UploadMenuItemPhotoResult = { ok: true } | { error: string };

/**
 * Runs the actual Storage write server-side. `compressImage` (WBS 3.8) is
 * DOM-only and stays in the browser -- MenuItemEditorForm compresses the
 * photo client-side and hands the resulting blob over here as FormData --
 * but the write itself must go through this server client. The browser
 * Supabase client can never carry the merchant's session: WBS 4.1's session
 * cookie is httpOnly, invisible to the browser client's document.cookie
 * read, so a browser-client storage call always runs as `anon` and
 * merchant_insert_menu_images (0022_storage_policies.sql, `to authenticated`)
 * rejects it -- "new row violates row-level security policy".
 */
export async function uploadMenuItemPhoto(
  itemId: string,
  storeId: string,
  formData: FormData,
): Promise<UploadMenuItemPhotoResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: PHOTO_UPLOAD_ERROR };
  if (!isOwnedStore(merchant, storeId)) {
    console.error(`uploadMenuItemPhoto: rejected storeId ${storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: PHOTO_UPLOAD_ERROR };
  }

  const blob = formData.get("file");
  if (!(blob instanceof Blob)) return { error: PHOTO_UPLOAD_ERROR };

  const supabase = await createClient();
  let path: string;
  try {
    path = await uploadCompressedMenuImage(supabase, blob, storeId, itemId);
  } catch (err) {
    console.error("uploadMenuItemPhoto: storage upload failed", err);
    return { error: PHOTO_UPLOAD_ERROR };
  }

  return updateMenuItemImage(itemId, storeId, path);
}
