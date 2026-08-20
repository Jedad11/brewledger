"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";

// WBS 4.4 — availability toggle and reorder for the menu list. Both actions
// check `storeId` against the caller's own `merchant.storeIds` BEFORE any
// Supabase call, per WBS 4.2's rule that a console handler may never accept
// a client-supplied store_id and trust it — RLS (merchant_rw_menu_items)
// backs this up independently, but this is the explicit second layer, same
// shape as isOwnedStoreId in .../settings/store/actions.ts.
const SAVE_ERROR = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";

function isOwnedStore(merchant: { storeIds: string[] }, storeId: string): boolean {
  return merchant.storeIds.includes(storeId);
}

export type AvailabilityValue = "available" | "hidden";

export type ActionResult = { ok: true } | { error: string };

/**
 * Binary UI toggle ("พร้อมขาย") mapped onto the 3-value `availability`
 * column: ON -> 'available', OFF -> 'hidden' (removed from the anon-visible
 * Customer Web menu per 0021_rls.sql's `anon_read_published_menu_items`
 * policy). 'out_of_stock' is a real third schema value this toggle does not
 * expose — no screen in this WBS entry sets it; it's reserved for a future
 * stock-driven auto-flag, not user-facing here.
 */
export async function toggleMenuItemAvailability(
  storeId: string,
  itemId: string,
  next: AvailabilityValue,
): Promise<ActionResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: SAVE_ERROR };
  if (!isOwnedStore(merchant, storeId)) {
    console.error(`toggleMenuItemAvailability: rejected storeId ${storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: SAVE_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("menu_items")
    .update({ availability: next })
    .eq("id", itemId)
    .eq("store_id", storeId);

  if (error) return { error: SAVE_ERROR };
  return { ok: true };
}

/**
 * Full-list reorder: the client computes the new order locally (arrow-button
 * swap) and sends the complete ordered id list; this just writes
 * `sort_order = index` for each id. Simpler and more robust than a pairwise
 * swap endpoint — it can't drift from what the client actually shows.
 */
export async function reorderMenuItems(storeId: string, orderedItemIds: string[]): Promise<ActionResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: SAVE_ERROR };
  if (!isOwnedStore(merchant, storeId)) {
    console.error(`reorderMenuItems: rejected storeId ${storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: SAVE_ERROR };
  }

  const supabase = await createClient();
  const results = await Promise.all(
    orderedItemIds.map((itemId, index) =>
      supabase.from("menu_items").update({ sort_order: index }).eq("id", itemId).eq("store_id", storeId),
    ),
  );

  if (results.some((r) => r.error)) return { error: SAVE_ERROR };
  return { ok: true };
}
