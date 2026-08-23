// WBS 5.12 — resolves the store's own menu into the quick-sale tile grid,
// ranked "largest and most-sold first" per the WBS text. No popularity flag
// is persisted anywhere in this schema (grepped -- menu_items carries only
// sort_order), so this computes it: total quantity sold per menu item from
// order_items over the last 30 days, ties broken by menu_items.sort_order.
// 30 days is a judgment call (documented here, not buried) -- long enough
// to smooth out a slow week, short enough that a discontinued seasonal item
// stops floating to the top a month after it's gone. REVENUE_STATUSES
// mirrors reports/profit-per-dish/fetchProfitPerDish.ts's own choice (a
// cancelled or still-unpaid order was never really "sold").
//
// Two-step read (orders in the window, then order_items for those ids),
// same reasoning fetchProfitPerDish.ts documents: the RLS-scoped
// server client has no raw SQL access, only PostgREST, and order_items has
// no created_at column of its own to filter by period directly.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@brewledger/db/types";
import type { QuickSaleOption, QuickSaleOptionGroup } from "./optionSelection";

const REVENUE_STATUSES = ["ACCEPTED", "PREPARING", "READY", "COLLECTED"] as const;
const POPULARITY_WINDOW_DAYS = 30;

// Roughly the prototype's own ratio (2 of its 10 demo TILES were hot:true,
// ~20%). Not a spec value -- there is no stored "hot" flag to read, this is
// the engineer judgment call the WBS text explicitly invites ("use
// judgment"), sized off the fetched item count rather than hardcoded.
const HOT_TILE_RATIO = 0.2;

export interface QuickSaleMenuItem {
  id: string;
  name: string;
  priceSatang: number;
  hot: boolean;
}

export interface QuickSaleMenuData {
  items: QuickSaleMenuItem[];
  optionGroups: QuickSaleOptionGroup[];
  options: QuickSaleOption[];
}

type MenuItemRow = Pick<
  Database["public"]["Tables"]["menu_items"]["Row"],
  "id" | "name" | "price_satang" | "sort_order"
>;
type OrderRow = Pick<Database["public"]["Tables"]["orders"]["Row"], "id">;
type OrderItemRow = Pick<Database["public"]["Tables"]["order_items"]["Row"], "menu_item_id" | "quantity">;
type OptionGroupRow = Pick<
  Database["public"]["Tables"]["menu_option_groups"]["Row"],
  "id" | "menu_item_id" | "name" | "min_select" | "max_select" | "sort_order"
>;
type OptionRow = Pick<
  Database["public"]["Tables"]["menu_options"]["Row"],
  "id" | "option_group_id" | "name" | "price_delta_satang" | "sort_order"
>;

export async function fetchQuickSaleMenu(supabase: SupabaseClient, storeId: string): Promise<QuickSaleMenuData> {
  const { data: itemRows } = await supabase
    .from("menu_items")
    .select("id, name, price_satang, sort_order")
    .eq("store_id", storeId)
    .eq("availability", "available")
    .order("sort_order", { ascending: true });

  const items = (itemRows ?? []) as MenuItemRow[];
  if (items.length === 0) {
    return { items: [], optionGroups: [], options: [] };
  }

  const windowStart = new Date(Date.now() - POPULARITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const { data: orderRows } = await supabase
    .from("orders")
    .select("id")
    .eq("store_id", storeId)
    .in("status", REVENUE_STATUSES)
    .gte("created_at", windowStart.toISOString());

  const orderIds = ((orderRows ?? []) as OrderRow[]).map((o) => o.id);
  const soldByMenuItemId = new Map<string, number>();
  if (orderIds.length > 0) {
    const { data: itemSoldRows } = await supabase
      .from("order_items")
      .select("menu_item_id, quantity")
      .in("order_id", orderIds);
    for (const row of (itemSoldRows ?? []) as OrderItemRow[]) {
      if (!row.menu_item_id) continue;
      soldByMenuItemId.set(row.menu_item_id, (soldByMenuItemId.get(row.menu_item_id) ?? 0) + row.quantity);
    }
  }

  const ranked = [...items].sort((a, b) => {
    const soldDiff = (soldByMenuItemId.get(b.id) ?? 0) - (soldByMenuItemId.get(a.id) ?? 0);
    if (soldDiff !== 0) return soldDiff;
    return a.sort_order - b.sort_order;
  });

  const hotCount = Math.max(1, Math.round(ranked.length * HOT_TILE_RATIO));
  const hotIds = new Set(ranked.slice(0, hotCount).map((row) => row.id));

  const menuItems: QuickSaleMenuItem[] = ranked.map((row) => ({
    id: row.id,
    name: row.name,
    priceSatang: row.price_satang,
    hot: hotIds.has(row.id),
  }));

  const { data: groupRows } = await supabase
    .from("menu_option_groups")
    .select("id, menu_item_id, name, min_select, max_select, sort_order")
    .eq("store_id", storeId);
  const optionGroups: QuickSaleOptionGroup[] = ((groupRows ?? []) as OptionGroupRow[]).map((row) => ({
    id: row.id,
    menuItemId: row.menu_item_id,
    name: row.name,
    minSelect: row.min_select,
    maxSelect: row.max_select,
    sortOrder: row.sort_order,
  }));

  let options: QuickSaleOption[] = [];
  if (optionGroups.length > 0) {
    const { data: optionRows } = await supabase
      .from("menu_options")
      .select("id, option_group_id, name, price_delta_satang, sort_order")
      .in(
        "option_group_id",
        optionGroups.map((g) => g.id),
      );
    options = ((optionRows ?? []) as OptionRow[]).map((row) => ({
      id: row.id,
      optionGroupId: row.option_group_id,
      name: row.name,
      priceDeltaSatang: row.price_delta_satang,
      sortOrder: row.sort_order,
    }));
  }

  return { items: menuItems, optionGroups, options };
}
