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
type StoreRow = Pick<
  Database["public"]["Tables"]["stores"]["Row"],
  "id" | "slug" | "name" | "is_published" | "created_at"
>;

// Single canonical way to read "the merchant's current store id" anywhere in
// the Console. A merchant owning more than one stores row is legal at the
// schema level (docs/db/schema_design.md); resolveMerchantCtx below sorts
// `stores` newest-first so `stores[0]` is that canonical row everywhere --
// every page that needs "the current store" calls this instead of
// re-deriving its own ordering (`.order("created_at", ...)` with its own
// ascending/descending choice, or an unordered `storeIds[0]`), which is
// exactly how settings/payments, settings/link, menu, and menu/[id] used to
// each disagree with settings/store about which row was current. See
// redline_reviewer's finding on the store-profile-duplicate-row bug.
export function currentStoreId(merchant: Pick<MerchantCtx, "stores">): string | null {
  return merchant.stores[0]?.id ?? null;
}

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
    .select("id, slug, name, is_published, created_at")
    .in("id", storeIds);
  if (storesErr) return null;

  // Newest-first: matches the convention settings/store/page.tsx already
  // reviewed and shipped for "which duplicate row wins." Sorted here, once,
  // in JS rather than via `.order()` on the query so this stays a plain
  // `.in()` await -- the exact shape apps/console/src/lib/merchant.test.ts
  // already mocks -- instead of adding a query-builder method every existing
  // mock chain would also need to grow.
  //
  // Ordinal string comparison, not localeCompare: PostgREST trims
  // trailing-zero fractional seconds off timestamptz (e.g. "...T10:30:00+00:00"
  // for an exact-second row vs "...T10:30:00.000001+00:00" a microsecond
  // later), and default-locale localeCompare doesn't treat that ISO-8601
  // punctuation the way ordinal `<` does -- it can rank the exact-second row
  // as newer than the one microseconds after it. `<` on the raw strings
  // matches Postgres's own timestamp ordering because ISO-8601 is
  // lexicographically sortable.
  const sortedStoreRows = [...((storeRows ?? []) as StoreRow[])].sort((a, b) => {
    const aCreated = a.created_at ?? "";
    const bCreated = b.created_at ?? "";
    if (aCreated === bCreated) return 0;
    return aCreated < bCreated ? 1 : -1;
  });

  return {
    merchantId: merchant.id,
    subscriptionTier,
    storeIds,
    stores: sortedStoreRows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      isPublished: row.is_published,
    })),
  };
}
