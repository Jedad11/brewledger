import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { StoreProfileForm } from "./StoreProfileForm";
import type { Database } from "@brewledger/db/types";

type StoreProfileRow = Pick<
  Database["public"]["Tables"]["stores"]["Row"],
  | "id"
  | "name"
  | "pickup_address"
  | "opens_at"
  | "closes_at"
  | "slug"
  | "is_published"
  | "promptpay_verified_at"
>;

export default async function StoreSettingsPage() {
  const merchant = await resolveMerchantCtx();
  // (app)/layout.tsx already redirects a null merchant to /console/login;
  // this defensive check keeps this page safe if it's ever reached another
  // way (see the layout's own header comment for the same posture).
  if (!merchant) {
    redirect("/console/login");
  }

  const supabase = await createClient();

  // RLS (`auth_merchant_id()`, migration 0026) scopes this to the caller's
  // own store(s) -- no explicit merchant/store filter needed. A merchant
  // with zero stores yet gets zero rows back, not an error; see actions.ts's
  // header comment for the INSERT path that creates the first one.
  //
  // storeId comes from resolveMerchantCtx() (lib/merchant.ts), the single
  // place "which stores row is current" gets decided (newest-first when a
  // merchant has more than one -- legal at the schema level on purpose, see
  // docs/db/schema_design.md). Fetching by that id, rather than re-running
  // an `.order().limit(1)` query here, is what keeps this screen unable to
  // disagree with settings/payments, settings/link, menu, and menu/[id]
  // about which row is current -- see redline_reviewer's finding on the
  // store-profile-duplicate-row bug. StoreProfileForm.tsx separately tracks
  // the id it's editing as state so a normal repeat save can't create a
  // second row in the first place.
  const storeId = currentStoreId(merchant);
  const { data: storeRow } = storeId
    ? await supabase
        .from("stores")
        .select("id, name, pickup_address, opens_at, closes_at, slug, is_published, promptpay_verified_at")
        .eq("id", storeId)
        .maybeSingle()
    : { data: null };

  const store = storeRow as StoreProfileRow | null;

  let menuItemDone = false;
  if (store) {
    const { count } = await supabase
      .from("menu_items")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id);
    menuItemDone = (count ?? 0) > 0;
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <h1 className="mb-6 font-serif text-3xl font-bold leading-[1.35] text-ink">
        ข้อมูลร้าน
      </h1>
      <StoreProfileForm
        store={store}
        onboarding={{
          store: !!store?.name && !!store?.pickup_address,
          menu: menuItemDone,
          payments: !!store?.promptpay_verified_at,
        }}
      />
    </main>
  );
}
