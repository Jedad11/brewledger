// WBS 5.12 — /console/sales/quick. Fetches the store's ranked menu + option
// groups/options server-side (fetchQuickSaleTiles.ts); every subsequent
// tap/confirm/undo is client interaction (QuickSaleClient.tsx) or a Server
// Action (actions.ts) — this page itself never mutates anything.
import { redirect } from "next/navigation";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { createClient } from "@/lib/supabase/server";
import { fetchQuickSaleMenu } from "./fetchQuickSaleTiles";
import { QuickSaleClient } from "./QuickSaleClient";
import { PAGE_SUBTITLE, PAGE_TITLE } from "./copy";

export default async function QuickSalePage() {
  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    redirect("/console/login");
  }

  const storeId = currentStoreId(merchant);
  const supabase = await createClient();

  const menu = storeId
    ? await fetchQuickSaleMenu(supabase, storeId)
    : { items: [], optionGroups: [], options: [] };

  return (
    <>
      <header className="oc-top">
        <div>
          <h1>{PAGE_TITLE}</h1>
          <p className="note-plain">{PAGE_SUBTITLE}</p>
        </div>
      </header>
      <QuickSaleClient items={menu.items} optionGroups={menu.optionGroups} options={menu.options} />
    </>
  );
}
