// WBS 7.6 — Profit per Dish. Aggregates order_items joined to orders for a
// period, grouped by menu item, ranked by TOTAL PROFIT CONTRIBUTION (margin
// per unit x units sold) -- the headline MVP KPI per the WBS's own words,
// not units sold and not revenue.
//
// order_items has no created_at column (0012_order_items.sql) and no status
// of its own -- the period/status filter can only be applied on `orders`.
// This mirrors WBS 7.5's fetchPnlDay.ts two-step read (orders in the window,
// then order_items for those order_ids) rather than a single SQL join, for
// the same reason: the RLS-scoped browser/server Supabase client has no raw
// SQL access, only PostgREST. The second step is served index-only by
// order_items_order_id_covering_idx (0042_reporting_indexes.sql), which
// already INCLUDEs menu_item_id/quantity/both money snapshots -- no heap
// fetch per row. order_items_store_id_menu_item_id_idx (also 0042) is built
// for a query shaped `WHERE store_id = ? ... GROUP BY menu_item_id`, but
// order_items carries no date column to filter by period on that same
// table, so a query starting from order_items by store_id would have to
// scan every order_item the store ever recorded, not just the period --
// slower, not faster, for a 30-day report. Starting from `orders` (which
// orders_store_id_created_at_revenue_status_idx already serves) and walking
// into order_items by order_id is the shape that actually stays under the
// WBS's 2-second budget for a 50-item menu over 30 days.
//
// Uses the SNAPSHOT columns (unit_price_snapshot_satang /
// unit_cost_snapshot_satang), never current ingredients.current_unit_cost_
// satang, so a historical period's figures never change after an
// ingredient cost update (CLAUDE.md "cost is stored twice").
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@brewledger/db/types";

const REVENUE_STATUSES = ["ACCEPTED", "PREPARING", "READY", "COLLECTED"] as const;

export interface DishRow {
  key: string;
  menuItemId: string | null;
  name: string;
  unitsSold: number;
  revenueSatang: number;
  /** null when ANY order_item line for this item in the period had a null cost snapshot (RL-2) -- never 0. */
  costSatang: number | null;
  marginPerUnitSatang: number | null;
  totalProfitSatang: number | null;
}

export interface DivergenceInsight {
  bestSellerName: string;
  bestSellerUnits: number;
  topProfitName: string;
  topProfitSatang: number;
}

export interface ProfitPerDishReport {
  /** Sorted by totalProfitSatang descending -- the teaching-default sort. */
  tracked: DishRow[];
  /** Never sorted as zero, never hidden -- units/revenue known, cost/margin/profit "—" (RL-2). */
  untracked: DishRow[];
  /** null when the top seller and the top profit contributor are the same item, or there is no tracked item to compare against. */
  insight: DivergenceInsight | null;
}

type OrderRow = Pick<Database["public"]["Tables"]["orders"]["Row"], "id">;
type OrderItemRow = Pick<
  Database["public"]["Tables"]["order_items"]["Row"],
  "menu_item_id" | "item_name_snapshot" | "quantity" | "unit_price_snapshot_satang" | "unit_cost_snapshot_satang"
>;

interface Accumulator {
  menuItemId: string | null;
  name: string;
  unitsSold: number;
  revenueSatang: number;
  costSatang: number;
  costRowsCount: number;
  marginRowSumSatang: number;
  hasUntrackedRow: boolean;
}

function itemKey(row: Pick<OrderItemRow, "menu_item_id" | "item_name_snapshot">): string {
  // menu_item_id survives a rename (item_name_snapshot differs per sale but
  // the item is the same dish); a deleted menu item (menu_item_id null,
  // FK "on delete set null") falls back to its frozen name so it doesn't
  // silently merge with an unrelated deleted item that happens to share no
  // id at all.
  return row.menu_item_id ?? `name:${row.item_name_snapshot}`;
}

export async function fetchProfitPerDish(
  supabase: SupabaseClient,
  storeId: string,
  startUtc: Date,
  endUtc: Date,
): Promise<ProfitPerDishReport> {
  const { data: orderRows } = await supabase
    .from("orders")
    .select("id")
    .eq("store_id", storeId)
    .in("status", REVENUE_STATUSES)
    .gte("created_at", startUtc.toISOString())
    .lt("created_at", endUtc.toISOString());

  const orderIds = ((orderRows ?? []) as OrderRow[]).map((o) => o.id);
  if (orderIds.length === 0) {
    return { tracked: [], untracked: [], insight: null };
  }

  const { data: itemRows } = await supabase
    .from("order_items")
    .select("menu_item_id, item_name_snapshot, quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang")
    .in("order_id", orderIds);

  const byKey = new Map<string, Accumulator>();
  for (const item of (itemRows ?? []) as OrderItemRow[]) {
    const key = itemKey(item);
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        menuItemId: item.menu_item_id,
        name: item.item_name_snapshot,
        unitsSold: 0,
        revenueSatang: 0,
        costSatang: 0,
        costRowsCount: 0,
        marginRowSumSatang: 0,
        hasUntrackedRow: false,
      };
      byKey.set(key, acc);
    }
    acc.unitsSold += item.quantity;
    acc.revenueSatang += item.unit_price_snapshot_satang * item.quantity;
    if (item.unit_cost_snapshot_satang !== null) {
      acc.costSatang += item.unit_cost_snapshot_satang * item.quantity;
      acc.costRowsCount += 1;
      acc.marginRowSumSatang += item.unit_price_snapshot_satang - item.unit_cost_snapshot_satang;
    } else {
      acc.hasUntrackedRow = true;
    }
  }

  const tracked: DishRow[] = [];
  const untracked: DishRow[] = [];

  for (const [key, acc] of byKey) {
    if (acc.hasUntrackedRow) {
      untracked.push({
        key,
        menuItemId: acc.menuItemId,
        name: acc.name,
        unitsSold: acc.unitsSold,
        revenueSatang: acc.revenueSatang,
        costSatang: null,
        marginPerUnitSatang: null,
        totalProfitSatang: null,
      });
    } else {
      const marginPerUnitSatang = Math.round(acc.marginRowSumSatang / acc.costRowsCount);
      tracked.push({
        key,
        menuItemId: acc.menuItemId,
        name: acc.name,
        unitsSold: acc.unitsSold,
        revenueSatang: acc.revenueSatang,
        costSatang: acc.costSatang,
        marginPerUnitSatang,
        totalProfitSatang: acc.revenueSatang - acc.costSatang,
      });
    }
  }

  tracked.sort((a, b) => (b.totalProfitSatang! - a.totalProfitSatang!) || a.name.localeCompare(b.name, "th"));
  untracked.sort((a, b) => b.unitsSold - a.unitsSold || a.name.localeCompare(b.name, "th"));

  const allRows = [...tracked, ...untracked];
  const bestSeller = allRows.reduce<DishRow | null>((best, row) => {
    if (!best) return row;
    if (row.unitsSold > best.unitsSold) return row;
    if (row.unitsSold === best.unitsSold && row.name.localeCompare(best.name, "th") < 0) return row;
    return best;
  }, null);
  const topProfit = tracked[0] ?? null;

  let insight: DivergenceInsight | null = null;
  if (bestSeller && topProfit && bestSeller.key !== topProfit.key) {
    insight = {
      bestSellerName: bestSeller.name,
      bestSellerUnits: bestSeller.unitsSold,
      topProfitName: topProfit.name,
      topProfitSatang: topProfit.totalProfitSatang!,
    };
  }

  return { tracked, untracked, insight };
}
