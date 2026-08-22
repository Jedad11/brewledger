// WBS 7.1 — Owner Console home, `/console`. Server-rendered so the four
// headline numbers are present in the initial HTML (acceptance: "render
// within 1 second on 4G" — nothing here waits on a client-side fetch before
// first paint), then handed to DashboardClient which keeps them live via
// Realtime + poll (useDashboardSummary.ts).
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { fetchDashboardSummary, type DashboardSummary } from "./fetchDashboardSummary";
import { DashboardClient, DashboardView } from "./DashboardClient";
import { PAGE_TITLE } from "./copy";
import type { Database } from "@brewledger/db/types";

const EMPTY_SUMMARY: DashboardSummary = {
  revenueSatang: 0,
  profitSatang: null,
  expensesSatang: 0,
  trackedItemCount: 0,
  totalItemCount: 0,
  orderCounts: { waiting: 0, preparing: 0, ready: 0 },
  upcomingSlots: [],
};

type StoreRow = Pick<Database["public"]["Tables"]["stores"]["Row"], "id" | "timezone">;

export default async function DashboardPage() {
  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    redirect("/console/login");
  }

  const supabase = await createClient();
  const storeId = currentStoreId(merchant);

  // A merchant who hasn't finished WBS 4.3 (store profile) yet can reach
  // `/console` before any stores row exists — same "no store yet"
  // possibility settings/store.tsx and menu/page.tsx already handle. There
  // is no state_matrix.md entry for a dashboard-specific empty-store screen
  // (its own "Empty" bullet only covers zero orders), so this renders the
  // same all-zero/null summary that state renders — the merchant sees
  // ฿0.00 revenue and "—" profit rather than a broken page, and the quick
  // actions still route them to setup.
  let store: StoreRow | null = null;
  if (storeId) {
    const { data: storeRow } = await supabase
      .from("stores")
      .select("id, timezone")
      .eq("id", storeId)
      .maybeSingle();
    store = storeRow as StoreRow | null;
  }

  const summary = store ? await fetchDashboardSummary(supabase, store.id, store.timezone) : EMPTY_SUMMARY;

  return (
    <>
      <h1>{PAGE_TITLE}</h1>
      {store ? (
        <DashboardClient storeId={store.id} timezone={store.timezone} initialSummary={summary} />
      ) : (
        <DashboardView summary={summary} />
      )}
    </>
  );
}
