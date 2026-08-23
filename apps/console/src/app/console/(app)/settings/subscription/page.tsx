import { redirect } from "next/navigation";
import { resolveMerchantCtx } from "@/lib/merchant";
import { SubscriptionPlanView } from "./SubscriptionPlanView";
import { PAGE_TITLE } from "./copy";
import { SettingsSubNav } from "@/components/SettingsSubNav";

// WBS 4.7 — /console/settings/subscription. Unlike the other settings
// screens (store/payments/link), this page needs no Supabase query of its
// own: subscriptionTier already arrives on MerchantCtx (resolveMerchantCtx,
// packages/shared/src/merchant.ts), so SubscriptionPlanView reads it
// straight from MerchantProvider's session context via useMerchant().
export default async function SubscriptionSettingsPage() {
  const merchant = await resolveMerchantCtx();
  // (app)/layout.tsx already redirects a null merchant to /console/login;
  // this defensive check keeps this page safe if it's ever reached another
  // way (same posture as every other settings page's own header comment).
  if (!merchant) {
    redirect("/console/login");
  }

  return (
    <>
      <SettingsSubNav />
      <header className="oc-top">
        <div>
          <h1>{PAGE_TITLE}</h1>
        </div>
      </header>
      <div className="oc-body">
        <SubscriptionPlanView />
      </div>
    </>
  );
}
