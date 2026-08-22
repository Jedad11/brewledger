"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import type { BaseUnit } from "@brewledger/costing/dist/units";

// WBS 6.5 — ingredient create/edit + delete/archive. Mirrors menu/actions.ts's
// isOwnedStore-before-any-query shape (WBS 4.2: never trust a client-supplied
// store_id).
const SAVE_ERROR = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
const NAME_REQUIRED = "กรอกชื่อวัตถุดิบ";
const DELETE_BLOCKED =
  "ลบไม่ได้เพราะมีการใช้วัตถุดิบนี้ในสูตรหรือมีประวัติซื้อ/สต๊อกแล้ว กด \"ซ่อน\" แทนได้";
const BASE_UNIT_LOCKED =
  "เปลี่ยนหน่วยพื้นฐานไม่ได้แล้ว เพราะมีบิลซื้อหรือรายการสต๊อกที่อ้างอิงวัตถุดิบนี้อยู่ — การเปลี่ยนจะทำให้ตัวเลขต้นทุนเก่าคลาดเคลื่อน";

const BASE_UNITS: readonly BaseUnit[] = ["g", "ml", "piece"];

function isOwnedStore(merchant: { storeIds: string[] }, storeId: string): boolean {
  return merchant.storeIds.includes(storeId);
}

export interface SaveIngredientInput {
  ingredientId: string | null;
  storeId: string;
  name: string;
  baseUnit: BaseUnit;
  lowStockThreshold: number | null;
  packSize: number | null;
}

export type SaveIngredientResult = { ok: true; ingredientId: string } | { error: string };

export async function saveIngredient(input: SaveIngredientInput): Promise<SaveIngredientResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: SAVE_ERROR };
  if (!isOwnedStore(merchant, input.storeId)) {
    console.error(`saveIngredient: rejected storeId ${input.storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: SAVE_ERROR };
  }

  const name = input.name.trim();
  if (!name) return { error: NAME_REQUIRED };
  if (!BASE_UNITS.includes(input.baseUnit)) return { error: SAVE_ERROR };
  if (input.lowStockThreshold !== null && !(input.lowStockThreshold >= 0)) return { error: SAVE_ERROR };
  if (input.packSize !== null && !(input.packSize > 0)) return { error: SAVE_ERROR };

  const supabase = await createClient();

  if (input.ingredientId) {
    // Second layer in front of the 0041 trigger (prevent_base_unit_change_if_referenced):
    // check whether base_unit is actually referenced BEFORE attempting the
    // write, so a locked field the merchant somehow submitted anyway gets a
    // clear Thai message instead of a raw Postgres exception string. The
    // trigger stays the real backstop -- this is UX, not the enforcement.
    const [{ data: existing }, { count: purchaseRefs }, { count: ledgerRefs }] = await Promise.all([
      supabase.from("ingredients").select("base_unit").eq("id", input.ingredientId).eq("store_id", input.storeId).maybeSingle(),
      supabase
        .from("purchase_line_items")
        .select("id", { count: "exact", head: true })
        .eq("ingredient_id", input.ingredientId),
      supabase
        .from("stock_ledger")
        .select("id", { count: "exact", head: true })
        .eq("ingredient_id", input.ingredientId),
    ]);

    const referenced = (purchaseRefs ?? 0) > 0 || (ledgerRefs ?? 0) > 0;
    if (existing && referenced && existing.base_unit !== input.baseUnit) {
      return { error: BASE_UNIT_LOCKED };
    }

    const { error } = await supabase
      .from("ingredients")
      .update({
        name,
        base_unit: input.baseUnit,
        low_stock_threshold: input.lowStockThreshold,
        pack_size: input.packSize,
      })
      .eq("id", input.ingredientId)
      .eq("store_id", input.storeId);

    if (error) {
      // Falls back to the DB trigger's own rejection if this second layer
      // above somehow missed a case (e.g. a race with a concurrent purchase
      // confirmation) -- still a clear Thai message, not a raw exception.
      return { error: /base_unit is immutable/.test(error.message) ? BASE_UNIT_LOCKED : SAVE_ERROR };
    }
    return { ok: true, ingredientId: input.ingredientId };
  }

  const { data, error } = await supabase
    .from("ingredients")
    .insert({
      store_id: input.storeId,
      name,
      base_unit: input.baseUnit,
      low_stock_threshold: input.lowStockThreshold,
      pack_size: input.packSize,
    })
    .select("id")
    .single();

  if (error || !data) return { error: SAVE_ERROR };
  return { ok: true, ingredientId: data.id as string };
}

export type DeleteIngredientResult = { ok: true } | { error: string };

/**
 * Hard delete, only when genuinely unreferenced. bom_lines.ingredient_id is
 * ON DELETE RESTRICT (0009) and stock_ledger.ingredient_id was tightened to
 * ON DELETE RESTRICT by this same entry (0041) -- both are a real DB-level
 * backstop -- but this checks first so a blocked delete returns the WBS
 * 6.5-required clear Thai explanation ("กด ซ่อน แทนได้") instead of a raw
 * foreign_key_violation.
 */
export async function deleteIngredient(storeId: string, ingredientId: string): Promise<DeleteIngredientResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: SAVE_ERROR };
  if (!isOwnedStore(merchant, storeId)) {
    console.error(`deleteIngredient: rejected storeId ${storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: SAVE_ERROR };
  }

  const supabase = await createClient();

  const [{ count: bomRefs }, { count: ledgerRefs }] = await Promise.all([
    supabase.from("bom_lines").select("id", { count: "exact", head: true }).eq("ingredient_id", ingredientId),
    supabase.from("stock_ledger").select("id", { count: "exact", head: true }).eq("ingredient_id", ingredientId),
  ]);
  if ((bomRefs ?? 0) > 0 || (ledgerRefs ?? 0) > 0) {
    return { error: DELETE_BLOCKED };
  }

  const { error } = await supabase.from("ingredients").delete().eq("id", ingredientId).eq("store_id", storeId);
  if (error) {
    // 23503 = foreign_key_violation -- defense in depth for the DB-level
    // RESTRICT backstop (bom_lines.ingredient_id, stock_ledger.ingredient_id,
    // both ON DELETE RESTRICT) firing on a reference created in the gap
    // between the count check above and this DELETE (e.g. a concurrent
    // sale). purchase_line_items.ingredient_id is ON DELETE SET NULL
    // (0016), not RESTRICT, so it deliberately never raises here or blocks
    // a delete -- matching the WBS's literal "bom_lines or any ledger row"
    // wording, which does not include purchase_line_items.
    return { error: error.code === "23503" ? DELETE_BLOCKED : SAVE_ERROR };
  }
  return { ok: true };
}

export type ArchiveIngredientResult = { ok: true } | { error: string };

/** "ซ่อน" — soft-hide instead of the delete above when references exist. */
export async function archiveIngredient(storeId: string, ingredientId: string): Promise<ArchiveIngredientResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: SAVE_ERROR };
  if (!isOwnedStore(merchant, storeId)) {
    console.error(`archiveIngredient: rejected storeId ${storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: SAVE_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("ingredients")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", ingredientId)
    .eq("store_id", storeId);

  if (error) return { error: SAVE_ERROR };
  return { ok: true };
}
