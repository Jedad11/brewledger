import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { PaymentsSettingsForm } from "./PaymentsSettingsForm";
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

  const { data: storeRow } = await supabase
    .from("stores")
    .select("id, name, pickup_address, promptpay_id, promptpay_type, promptpay_verified_at")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

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
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <h1 className="mb-6 font-serif text-3xl font-bold leading-[1.35] text-ink">
        การรับเงิน
      </h1>
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
    </main>
  );
}
