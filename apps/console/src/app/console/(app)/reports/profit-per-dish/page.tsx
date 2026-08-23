// WBS 7.6 — Profit per Dish, /console/reports/profit-per-dish. Server-
// rendered for today's figures (same "no client fetch before first paint"
// posture as WBS 7.1's dashboard and WBS 7.5's P&L page.tsx), then
// ProfitPerDishClient owns period selection.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { fetchProfitPerDish } from "./fetchProfitPerDish";
import { periodBounds } from "./period";
import { ProfitPerDishClient, ProfitPerDishView } from "./ProfitPerDishClient";
import { PAGE_TITLE } from "./copy";
import { ReportsSubNav } from "@/components/ReportsSubNav";
import type { Database } from "@brewledger/db/types";

type StoreRow = Pick<Database["public"]["Tables"]["stores"]["Row"], "id" | "timezone">;

export default async function ProfitPerDishPage() {
  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    redirect("/console/login");
  }

  const supabase = await createClient();
  const storeId = currentStoreId(merchant);

  let store: StoreRow | null = null;
  if (storeId) {
    const { data: storeRow } = await supabase
      .from("stores")
      .select("id, timezone")
      .eq("id", storeId)
      .maybeSingle();
    store = storeRow as StoreRow | null;
  }

  const heading = (
    <header className="oc-top">
      <div>
        <h1>{PAGE_TITLE}</h1>
      </div>
    </header>
  );

  // Mirrors WBS 7.1/7.5's own "no stores row yet" fallback -- a merchant who
  // hasn't finished WBS 4.3 can still reach any console route.
  if (!store) {
    return (
      <>
        <ReportsSubNav />
        {heading}
        <div className="oc-body">
          <ProfitPerDishView report={{ tracked: [], untracked: [], insight: null }} />
        </div>
      </>
    );
  }

  const bounds = periodBounds(store.timezone, "today");
  const initialReport = await fetchProfitPerDish(supabase, store.id, bounds.startUtc, bounds.endUtc);

  return (
    <>
      <ReportsSubNav />
      {heading}
      <ProfitPerDishClient storeId={store.id} timezone={store.timezone} initialReport={initialReport} />
    </>
  );
}
