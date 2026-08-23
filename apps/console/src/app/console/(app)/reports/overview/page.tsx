// WBS 7.7 — Period Comparison, /console/reports/overview. Server-rendered
// for the default month-over-month comparison (same "no client fetch before
// first paint" posture as WBS 7.5's pnl/page.tsx and WBS 7.6's
// profit-per-dish/page.tsx), then OverviewClient owns mode/range selection.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { fetchOverviewComparison, fetchMonthlyTrend } from "./fetchOverview";
import { comparisonRanges } from "./periods";
import { OverviewClient, OverviewView } from "./OverviewClient";
import { RevenueProfitChart } from "./RevenueProfitChart";
import { PAGE_TITLE, CHART_TITLE } from "./copy";
import { ReportsSubNav } from "@/components/ReportsSubNav";
import { businessDateBoundsUtc } from "../../businessDate";
import type { Database } from "@brewledger/db/types";

type StoreRow = Pick<Database["public"]["Tables"]["stores"]["Row"], "id" | "timezone">;

export default async function OverviewPage() {
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

  // Mirrors WBS 7.1/7.5/7.6's own "no stores row yet" fallback -- a merchant
  // who hasn't finished WBS 4.3 can still reach any console route.
  if (!store) {
    const emptyRange = { fromBusinessDate: "1970-01-01", toBusinessDate: "1970-01-01" };
    const emptyAggregate = {
      fromBusinessDate: emptyRange.fromBusinessDate,
      toBusinessDate: emptyRange.toBusinessDate,
      grossRevenueSatang: 0,
      totalCogsSatang: null,
      otherExpenseSatang: 0,
      netProfitSatang: null,
      orderCount: 0,
    };
    return (
      <>
        <ReportsSubNav />
        {heading}
        <div className="oc-body">
          <OverviewView
            comparison={{
              ranges: { mode: "month", current: emptyRange, previous: emptyRange, incomplete: false },
              current: emptyAggregate,
              previous: emptyAggregate,
            }}
          />
          <div className="card">
            <h3>{CHART_TITLE}</h3>
            <RevenueProfitChart points={[]} />
          </div>
        </div>
      </>
    );
  }

  const ranges = comparisonRanges("month", store.timezone);
  const todayBusinessDate = businessDateBoundsUtc(store.timezone).businessDate;
  const [initialComparison, initialTrend] = await Promise.all([
    fetchOverviewComparison(supabase, store.id, ranges),
    fetchMonthlyTrend(supabase, store.id, store.timezone, todayBusinessDate),
  ]);

  return (
    <>
      <ReportsSubNav />
      {heading}
      <OverviewClient
        storeId={store.id}
        timezone={store.timezone}
        initialComparison={initialComparison}
        initialTrend={initialTrend}
      />
    </>
  );
}
