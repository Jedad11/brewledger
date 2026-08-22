// WBS 7.5 — Daily P&L, /console/reports/pnl. Server-rendered for today's
// figures (same "no client fetch before first paint" posture as WBS 7.1's
// dashboard page.tsx), then PnlClient owns date navigation.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { fetchPnlDay, fetchPnlTrend } from "./fetchPnlDay";
import { PnlClient, PnlView } from "./PnlClient";
import { PAGE_TITLE, TREND_TITLE } from "./copy";
import { Sparkline } from "@brewledger/ui";
import { ReportsSubNav } from "@/components/ReportsSubNav";
import { businessDateBoundsUtc } from "../../businessDate";
import type { Database } from "@brewledger/db/types";

type StoreRow = Pick<Database["public"]["Tables"]["stores"]["Row"], "id" | "timezone">;

export default async function PnlPage() {
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
    <h1 className="mb-6 font-serif text-3xl font-bold leading-[1.35] text-ink">{PAGE_TITLE}</h1>
  );

  // Mirrors WBS 7.1's own "no stores row yet" fallback (a merchant who
  // hasn't finished WBS 4.3 can still reach any console route) -- render a
  // day of all-zero/null figures rather than a broken page or a redirect
  // loop; there is no state_matrix.md entry for a pnl-specific empty-store
  // screen either.
  if (!store) {
    const emptyDay = {
      businessDate: new Date().toISOString().slice(0, 10),
      grossRevenueSatang: 0,
      totalCogsSatang: null,
      otherExpenseSatang: 0,
      netProfitSatang: null,
      orderCount: 0,
      trackedItemCount: 0,
      totalItemCount: 0,
      untrackedRevenueSatang: 0,
      source: "live" as const,
    };
    return (
      <>
        <ReportsSubNav />
        <main className="mx-auto w-full max-w-2xl px-4 py-8">
          {heading}
          <div className="oc-body">
            <PnlView day={emptyDay} />
            <div className="card">
              <h3>{TREND_TITLE}</h3>
              <Sparkline values={[]} />
            </div>
          </div>
        </main>
      </>
    );
  }

  const todayBusinessDate = businessDateBoundsUtc(store.timezone).businessDate;
  const initialDay = await fetchPnlDay(supabase, store.id, store.timezone);
  const initialTrend = await fetchPnlTrend(supabase, store.id, initialDay);

  return (
    <>
      <ReportsSubNav />
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        {heading}
        <PnlClient
          storeId={store.id}
          timezone={store.timezone}
          todayBusinessDate={todayBusinessDate}
          initialDay={initialDay}
          initialTrend={initialTrend}
        />
      </main>
    </>
  );
}
