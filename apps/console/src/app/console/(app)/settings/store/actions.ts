"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { generateSlugBase, slugify, withCollisionSuffix } from "@/lib/slug";
import { PUBLISH_REQUIRES_PROMPTPAY_VERIFICATION } from "./copy";

// WBS 4.3 — create/update the merchant's store profile.
//
// Both UPDATE and INSERT (a merchant's first store -- the "blank state" the
// WBS entry's acceptance criterion describes) work under merchant_rw_stores,
// keyed off `merchant_id in (select auth_merchant_id())`
// (packages/db/migrations/0026_stores_insert_bootstrap_fix.sql). The
// original policy routed through auth_store_ids(), which queries stores
// itself -- self-referential, so a brand-new row's WITH CHECK could never be
// satisfied before the row existed. auth_merchant_id() reads only merchants,
// so INSERT and UPDATE both just work; see docs/db/rls_design.md §3 for the
// full design note.
//
// Slug uniqueness has the same shape of problem: the merchant's own
// RLS-scoped client cannot read another merchant's *unpublished* store slug
// to check it live (verified: a second merchant's unpublished slug returns
// zero rows even by exact match). So collision handling here works by
// attempting the write and reacting to Postgres's own unique-constraint
// error (`stores_slug_key`, SQLSTATE 23505), not a live pre-check query --
// this needs no RLS change and matches the WBS's own "-2, -3 on collision"
// wording either way.
const SAVE_ERROR = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
const UNIQUE_VIOLATION = "23505";
const MAX_SLUG_ATTEMPTS = 20;

// redline_reviewer (post-4.3 audit): WBS 4.2's central rule -- no console
// handler may accept a client-supplied store_id and trust it -- applies to
// Server Actions too, not just Edge Functions. RLS (merchant_rw_stores)
// already blocks a cross-tenant write, but WBS 4.2 requires an explicit
// second layer IN the handler, checked before the row is even queried, so
// a mismatch is its own code path rather than folding into whatever error
// Postgres happens to return. Mirrors assertOwnedStore/ForbiddenStoreError
// in supabase/functions/_shared/console/auth.ts in intent; can't reuse that
// code directly (different runtime, and this Server Action returns a
// result object rather than throwing to produce an HTTP 403). No distinct
// user-facing copy exists for this state in state_matrix.md -- it isn't a
// reachable state through the UI, only a defence against a forged request
// -- so it reuses SAVE_ERROR's text but never its code path.
function isOwnedStoreId(merchant: { storeIds: string[] }, storeId: string | null): boolean {
  return storeId === null || merchant.storeIds.includes(storeId);
}

export interface StoreProfileInput {
  storeId: string | null;
  name: string;
  pickupAddress: string;
  opensAt: string;
  closesAt: string;
  slug: string;
  isPublished: boolean;
}

export type SaveStoreProfileResult =
  | { ok: true; store: { id: string; slug: string } }
  | { error: string };

export async function saveStoreProfile(
  input: StoreProfileInput,
): Promise<SaveStoreProfileResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    return { error: SAVE_ERROR };
  }

  if (!isOwnedStoreId(merchant, input.storeId)) {
    console.error(
      `saveStoreProfile: rejected storeId ${input.storeId} -- not in merchant ${merchant.merchantId}'s storeIds`,
    );
    return { error: SAVE_ERROR };
  }

  const name = input.name.trim();
  const pickupAddress = input.pickupAddress.trim();
  if (!name || !pickupAddress || !input.opensAt || !input.closesAt) {
    return { error: SAVE_ERROR };
  }

  const slugBase = slugify(input.slug) || generateSlugBase(name);
  const supabase = await createClient();

  // RL-1 / WBS 4.5: gate publishing on a verified PromptPay identifier.
  // A brand-new store (no storeId yet) cannot possibly have one, so it's
  // rejected without a query; an existing store's current value is read
  // fresh here rather than trusted from the client, since a stale page
  // load could otherwise let a merchant publish on an identifier they
  // never actually verified.
  if (input.isPublished) {
    if (!input.storeId) {
      return { error: PUBLISH_REQUIRES_PROMPTPAY_VERIFICATION };
    }
    const { data: paymentsRow } = await supabase
      .from("stores")
      .select("promptpay_verified_at")
      .eq("id", input.storeId)
      .single();
    if (!paymentsRow?.promptpay_verified_at) {
      return { error: PUBLISH_REQUIRES_PROMPTPAY_VERIFICATION };
    }
  }

  for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
    const slug = withCollisionSuffix(slugBase, attempt);
    const row = {
      name,
      pickup_address: pickupAddress,
      opens_at: input.opensAt,
      closes_at: input.closesAt,
      timezone: "Asia/Bangkok",
      slug,
      is_published: input.isPublished,
    };

    const { data, error } = input.storeId
      ? await supabase
          .from("stores")
          .update(row)
          .eq("id", input.storeId)
          .select("id, slug")
          .single()
      : await supabase
          .from("stores")
          .insert({ ...row, merchant_id: merchant.merchantId })
          .select("id, slug")
          .single();

    if (!error && data) {
      // WBS 5.3 "on demand when store hours change" -- best-effort, never
      // blocks the save the merchant is actually waiting on. Regenerating
      // for a store whose hours didn't change is a harmless no-op (the
      // underlying generate_pickup_slots_for_store call is idempotent), so
      // this fires on every successful save rather than diffing old vs new
      // opens_at/closes_at.
      const { error: enqueueError } = await supabase.rpc("enqueue_generate_slots_job", {
        p_store_id: data.id,
      });
      if (enqueueError) {
        console.error(`saveStoreProfile: enqueue_generate_slots_job failed for store ${data.id}`, enqueueError);
      }
      return { ok: true, store: { id: data.id as string, slug: data.slug as string } };
    }

    if (error?.code === UNIQUE_VIOLATION) {
      continue;
    }

    return { error: SAVE_ERROR };
  }

  return { error: SAVE_ERROR };
}
