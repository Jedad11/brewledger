"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { SAVE_ERROR, CAPACITY_INVALID } from "./copy";

// WBS 5.3 — merchant capacity console screen. Mirrors settings/store/actions.ts's
// ownership-check-before-query shape (WBS 4.2's rule: never trust a
// client-supplied store_id) rather than relying on merchant_rw_pickup_slots/
// merchant_rw_stores RLS alone.
function isOwnedStoreId(merchant: { storeIds: string[] }, storeId: string): boolean {
  return merchant.storeIds.includes(storeId);
}

export type CapacityActionResult = { ok: true } | { error: string };

export async function updateSlotCapacity(
  storeId: string,
  slotId: string,
  capacity: number,
): Promise<CapacityActionResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant || !isOwnedStoreId(merchant, storeId)) {
    return { error: SAVE_ERROR };
  }
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return { error: CAPACITY_INVALID };
  }

  const supabase = await createClient();
  // stores_default_slot_capacity_positive has no equivalent CHECK on
  // pickup_slots.capacity beyond `> 0` (0010_pickup_slots.sql) and
  // `booked_count <= capacity` -- a capacity edit that would drop below the
  // slot's current booked_count is rejected by that pre-existing DB
  // constraint (23514), not re-validated here, so this is the single source
  // of truth rather than a duplicated client-side guess at booked_count.
  const { error } = await supabase
    .from("pickup_slots")
    .update({ capacity })
    .eq("id", slotId)
    .eq("store_id", storeId);

  if (error) {
    return { error: error.code === "23514" ? CAPACITY_INVALID : SAVE_ERROR };
  }
  return { ok: true };
}

export type ApplyDefaultCapacityResult = { ok: true; updated: number; skipped: number } | { error: string };

export async function applyDefaultCapacity(
  storeId: string,
  capacity: number,
): Promise<ApplyDefaultCapacityResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant || !isOwnedStoreId(merchant, storeId)) {
    return { error: SAVE_ERROR };
  }
  if (!Number.isInteger(capacity) || capacity <= 0) {
    return { error: CAPACITY_INVALID };
  }

  const supabase = await createClient();

  // 1. Persist the default so slots the nightly/on-demand generation job
  //    (generate_pickup_slots_for_store, packages/db/migrations/0028)
  //    creates AFTER this point use the new value -- otherwise "bulk
  //    default" would only ever reach slots that already exist today.
  const { error: storeError } = await supabase
    .from("stores")
    .update({ default_slot_capacity: capacity })
    .eq("id", storeId);
  if (storeError) {
    return { error: storeError.code === "23514" ? CAPACITY_INVALID : SAVE_ERROR };
  }

  // 2. Apply immediately to every future, still-open slot that ALREADY
  //    exists, per the WBS 5.3 acceptance criterion "the merchant can
  //    change capacity per slot and the change takes effect immediately."
  //    A slot already booked past the new, lower capacity would violate
  //    `check (booked_count <= capacity)` -- rather than let one such row
  //    fail the whole bulk UPDATE, those rows are excluded from the WHERE
  //    clause up front (booked_count <= capacity) and reported back as
  //    "skipped" so the merchant sees why a slot didn't change, instead of
  //    a silent partial failure.
  const { data: eligible, error: selectError } = await supabase
    .from("pickup_slots")
    .select("id, booked_count")
    .eq("store_id", storeId)
    .eq("is_open", true)
    .gt("slot_start", new Date().toISOString());
  if (selectError) {
    return { error: SAVE_ERROR };
  }

  const rows = eligible ?? [];
  const updatableIds = rows.filter((r) => (r.booked_count as number) <= capacity).map((r) => r.id as string);
  const skipped = rows.length - updatableIds.length;

  if (updatableIds.length === 0) {
    return { ok: true, updated: 0, skipped };
  }

  const { error: updateError, count } = await supabase
    .from("pickup_slots")
    .update({ capacity }, { count: "exact" })
    .in("id", updatableIds);
  if (updateError) {
    return { error: SAVE_ERROR };
  }

  return { ok: true, updated: count ?? updatableIds.length, skipped };
}
