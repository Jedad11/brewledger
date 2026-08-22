import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { StoreLinkQR } from "./StoreLinkQR";
import { PAGE_TITLE } from "./copy";
import { SettingsSubNav } from "@/components/SettingsSubNav";
import type { Database } from "@brewledger/db/types";

type StoreRow = Pick<Database["public"]["Tables"]["stores"]["Row"], "name" | "slug" | "is_published">;

export default async function StoreLinkPage() {
  const merchant = await resolveMerchantCtx();
  // (app)/layout.tsx already redirects a null merchant to /console/login;
  // this defensive check keeps this page safe if it's ever reached another
  // way, matching the store/payments settings pages' own posture.
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
    ? await supabase.from("stores").select("name, slug, is_published").eq("id", storeId).maybeSingle()
    : { data: null };

  const store = storeRow as StoreRow | null;

  return (
    <>
      <SettingsSubNav />
      <header className="oc-top">
        <div>
          <h1>{PAGE_TITLE}</h1>
        </div>
      </header>
      <div className="oc-body">
        <StoreLinkQR
          store={store ? { name: store.name, slug: store.slug, isPublished: store.is_published } : null}
        />
      </div>
    </>
  );
}
