// WBS 4.2 — server-side merchant + store resolution for the Owner Console.
//
// Mirrors supabase/functions/_shared/console/auth.ts's verifyConsoleRequest
// exactly: same auth_store_ids() RPC (the one RLS itself is built on, per
// docs/security/rls.md), same merchants lookup by auth_user_id. Kept as a
// second implementation rather than a shared import because the two run in
// different runtimes against different client constructions (this one reads
// the httpOnly session cookie via @supabase/ssr's server client, the Edge
// guard reads an Authorization header via a bare supabase-js client) -- but
// the RPC being reused, not re-derived, is what keeps "which stores does
// this user own" a single source of truth across both.
//
// proxy.ts already guarantees every request reaching (app)/layout.tsx has a
// valid session (deny-by-default, redirects to /console/login otherwise);
// this resolver still handles a null user defensively (returns null) rather
// than assuming that invariant, since a null merchant here must never throw
// past the layout and flash a broken authenticated shell.
import { createClient } from "@/lib/supabase/server";
import type { MerchantCtx } from "@brewledger/shared/dist/merchant";
import type { Database } from "@brewledger/db/types";

// The server Supabase client (lib/supabase/server.ts) isn't constructed with
// the Database generic, so `.from("stores")` itself returns `any` -- this
// type is used to annotate the row shape by hand at the one call site below,
// which is enough to catch a typo'd or renamed column without carrying the
// generic through every client call in the app.
type StoreRow = Pick<Database["public"]["Tables"]["stores"]["Row"], "id" | "slug" | "name" | "is_published">;

export async function resolveMerchantCtx(): Promise<MerchantCtx | null> {
  const supabase = await createClient();

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return null;

  const { data: storeIdRows, error: storeIdsErr } = await supabase.rpc("auth_store_ids");
  if (storeIdsErr) return null;
  // auth_store_ids() is `returns setof uuid` -- a scalar set-returning
  // function -- so PostgREST (and supabase-js .rpc()) returns a plain
  // array of UUID strings, not an array of { auth_store_ids: string }
  // row objects. No .map needed; only a type-narrowing cast for the
  // untyped RPC return. (Same fix as verifyConsoleRequest in
  // supabase/functions/_shared/console/auth.ts.)
  const storeIds = (storeIdRows ?? []) as string[];

  const { data: merchant, error: merchantErr } = await supabase
    .from("merchants")
    .select("id, subscription_tier")
    .eq("auth_user_id", userData.user.id)
    .single();
  if (merchantErr || !merchant) return null;
  // WBS 4.7 — subscription_tier has a NOT NULL default of 'free' (migration
  // 0002), so this cast is safe without a runtime fallback; the check
  // constraint there is the single source of truth for the value set, not
  // duplicated here.
  const subscriptionTier = merchant.subscription_tier as MerchantCtx["subscriptionTier"];

  if (storeIds.length === 0) {
    return { merchantId: merchant.id, subscriptionTier, storeIds, stores: [] };
  }

  const { data: storeRows, error: storesErr } = await supabase
    .from("stores")
    .select("id, slug, name, is_published")
    .in("id", storeIds);
  if (storesErr) return null;

  return {
    merchantId: merchant.id,
    subscriptionTier,
    storeIds,
    stores: (storeRows ?? []).map((row: StoreRow) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      isPublished: row.is_published,
    })),
  };
}
