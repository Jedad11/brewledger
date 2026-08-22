import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { PaymentsSettingsForm } from "./PaymentsSettingsForm";
import { SettingsSubNav } from "@/components/SettingsSubNav";
import type { PromptPayType } from "@brewledger/shared/dist/promptpay/normalize";
import type { Database } from "@brewledger/db/types";

type StoreRow = Pick<
  Database["public"]["Tables"]["stores"]["Row"],
  "id" | "name" | "pickup_address" | "promptpay_id" | "promptpay_type" | "promptpay_verified_at"
>;

export default async function PaymentsSettingsPage() {
  const merchant = await resolveMerchantCtx();
  // (app)/layout.tsx already redirects a null merchant to /console/login;
  // this defensive check keeps this page safe if it's ever reached another
  // way (see settings/store/page.tsx's own header comment for the same
  // posture).
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
        .select("id, name, pickup_address, promptpay_id, promptpay_type, promptpay_verified_at")
        .eq("id", storeId)
        .maybeSingle()
    : { data: null };

  const store = storeRow as StoreRow | null;

  let menuItemDone = false;
  if (store) {
    const { count } = await supabase
      .from("menu_items")
      .select("id", { count: "exact", head: true })
      .eq("store_id", store.id);
    menuItemDone = (count ?? 0) > 0;
  }

  return (
    <>
      <SettingsSubNav />
      <h1>การรับเงิน</h1>
      <div className="oc-body">
        <PaymentsSettingsForm
          storeId={store?.id ?? null}
          initial={{
            promptpayId: store?.promptpay_id ?? null,
            promptpayType: (store?.promptpay_type as PromptPayType | null) ?? null,
            promptpayVerifiedAt: store?.promptpay_verified_at ?? null,
          }}
          onboarding={{
            store: !!store?.name && !!store?.pickup_address,
            menu: menuItemDone,
          }}
        />
      </div>
    </>
  );
}
