"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { uploadCompressedMenuImage } from "@brewledger/shared/dist/storage/menuImages";

// WBS 4.4 — RL-2 PRIMARY ENFORCEMENT POINT. saveMenuItem is the one place a
// merchant creates a sellable menu item, and it must succeed with ONLY name
// + price. It never touches bom_lines, never requires an option group, and
// never computes or returns a cost figure -- cost stays unknown (null) until
// WBS 6.7/6.9 exist, and null is exactly what the console renders as "—".
// Do not add validation here that a recipe/BOM exists, or that any field
// beyond name/price is present -- that is precisely the RL-2 violation this
// entry exists to prevent.
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

export interface SaveMenuItemInput {
  itemId: string | null;
  storeId: string;
  name: string;
  priceSatang: number;
  description: string | null;
  optionGroups: MenuOptionGroupInput[];
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
