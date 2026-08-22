// WBS 4.4 — menu list: /console/menu. RL-2 primary enforcement point (see
// this route's own actions.ts and [id]/actions.ts header comments). Fetches
// data server-side only; all interactivity (reorder, availability toggle,
// navigation) lives in MenuListClient.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { MenuListClient, type MenuListItem } from "./MenuListClient";
import { SettingsSubNav } from "@/components/SettingsSubNav";
import type { Database } from "@brewledger/db/types";

type StoreRow = Pick<
  Database["public"]["Tables"]["stores"]["Row"],
  "id" | "name" | "pickup_address" | "promptpay_verified_at"
>;

type MenuItemRow = Pick<
  Database["public"]["Tables"]["menu_items"]["Row"],
  "id" | "name" | "price_satang" | "availability" | "image_path" | "sort_order"
>;

export default async function MenuListPage() {
  const merchant = await resolveMerchantCtx();
  // (app)/layout.tsx already redirects a null merchant to /console/login;
  // this defensive check keeps this page safe if it's ever reached another
  // way, matching the store settings page's own posture.
  if (!merchant) {
    redirect("/console/login");
  }

  const supabase = await createClient();

  // storeId is resolved once, in lib/merchant.ts's currentStoreId(), so this
  // screen can't disagree with settings/store (or any other console page)
  // about which stores row is current when a merchant has more than one --
  // see that helper's header comment.
  const storeId = currentStoreId(merchant);
  const { data: storeRow } = storeId
    ? await supabase
        .from("stores")
        .select("id, name, pickup_address, promptpay_verified_at")
        .eq("id", storeId)
        .maybeSingle()
    : { data: null };
  const store = storeRow as StoreRow | null;

  let items: MenuListItem[] = [];
  if (store) {
    const { data: itemRows } = await supabase
      .from("menu_items")
      .select("id, name, price_satang, availability, image_path, sort_order")
      .eq("store_id", store.id)
      .order("sort_order", { ascending: true });

    items = ((itemRows ?? []) as MenuItemRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      priceSatang: row.price_satang,
      availability: row.availability,
      imageUrl: row.image_path
        ? supabase.storage.from("menu-images").getPublicUrl(row.image_path).data.publicUrl
        : null,
    }));
  }

  return (
    <>
      <SettingsSubNav />
      <h1>เมนู</h1>
      <div className="oc-body">
        <MenuListClient
          storeId={store?.id ?? null}
          items={items}
          onboarding={{
            store: !!store?.name && !!store?.pickup_address,
            menu: items.length > 0,
            payments: !!store?.promptpay_verified_at,
          }}
        />
      </div>
    </>
  );
}
