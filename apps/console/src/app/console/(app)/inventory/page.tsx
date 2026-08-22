// WBS 6.5 — ingredient list: /console/inventory (คลังวัตถุดิบ). Prototype
// reference: design/console-reports.js scInventory() + design/Console
// Reports.html's own .oc-invrow* CSS (see docs/design/gaps.md GAP-4 — this
// screen IS in the delivered design package, unlike a fresh recipe-editor
// screen). Fetches data server-side only; search/sort/navigation lives in
// IngredientListClient.
//
// RL-2: a store with zero ingredients is a completely normal, permanent
// state, not a "todo" — this page renders the exact empty-state copy from
// docs/design/state_matrix.md's "คลังวัตถุดิบ" section and nothing else.
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { costPerHumanUnit, type BaseUnit } from "@brewledger/costing/dist/units";
import { formatSatangAsThb } from "@brewledger/shared/dist/money";
import { IngredientListClient, type IngredientListItem } from "./IngredientListClient";
import type { Database } from "@brewledger/db/types";

type IngredientRow = Pick<
  Database["public"]["Tables"]["ingredients"]["Row"],
  "id" | "name" | "base_unit" | "current_unit_cost_satang" | "low_stock_threshold"
>;

interface StockLevelRow {
  ingredient_id: string;
  stock_base_unit: number;
  last_purchase_at: string | null;
  days_of_cover: number | null;
}

function stockUnitLabel(baseUnit: BaseUnit): string {
  // Stock is always displayed in the SAME base unit it's stored in (unlike
  // cost, which converts up to a human purchase unit) — a merchant reading
  // "6 ลิตร" of milk stock is reading base-unit ml converted 1:1 in label
  // only for piece, or the same x1000-up scale cost uses for g/ml, since a
  // stock quantity in raw grams/millilitres is just as unreadable as a raw
  // satang cost would be.
  return baseUnit === "g" ? "กก." : baseUnit === "ml" ? "ล." : "ชิ้น";
}

function formatStock(stockBaseUnit: number, baseUnit: BaseUnit): string {
  const scale = baseUnit === "piece" ? 1 : 1000;
  const value = stockBaseUnit / scale;
  const rounded = Math.round(value * 100) / 100;
  return `${rounded.toLocaleString("th-TH", { maximumFractionDigits: 2 })} ${stockUnitLabel(baseUnit)}`;
}

export default async function InventoryListPage() {
  const merchant = await resolveMerchantCtx();
  // (app)/layout.tsx already redirects a null merchant to /console/login;
  // this defensive check matches every other console page's own posture.
  if (!merchant) {
    redirect("/console/login");
  }

  const supabase = await createClient();
  const storeId = currentStoreId(merchant);

  let items: IngredientListItem[] = [];
  if (storeId) {
    const { data: ingredientRows } = await supabase
      .from("ingredients")
      .select("id, name, base_unit, current_unit_cost_satang, low_stock_threshold")
      .eq("store_id", storeId)
      .is("archived_at", null)
      .order("name", { ascending: true });
    const ingredients = (ingredientRows ?? []) as IngredientRow[];

    // Stock is DERIVED, never a stored mutable column (WBS 6.5) — one round
    // trip via ingredient_stock_levels (packages/db/migrations/0036),
    // rather than N per-ingredient sum() queries.
    const { data: stockRows } = await supabase.rpc("ingredient_stock_levels", { p_store_id: storeId });
    const stockByIngredientId = new Map<string, StockLevelRow>(
      ((stockRows ?? []) as StockLevelRow[]).map((row) => [row.ingredient_id, row]),
    );

    items = ingredients.map((row) => {
      const baseUnit = row.base_unit as BaseUnit;
      const stock = stockByIngredientId.get(row.id) ?? {
        ingredient_id: row.id,
        stock_base_unit: 0,
        last_purchase_at: null,
        days_of_cover: null,
      };

      let costLabel: string | null = null;
      if (row.current_unit_cost_satang !== null) {
        const { satangPerHumanUnit, label } = costPerHumanUnit(row.current_unit_cost_satang, baseUnit);
        costLabel = `${formatSatangAsThb(satangPerHumanUnit)}/${label}`;
      }

      return {
        id: row.id,
        name: row.name,
        baseUnit,
        costLabel,
        stockLabel: formatStock(stock.stock_base_unit, baseUnit),
        isNegative: stock.stock_base_unit < 0,
        daysOfCover: stock.days_of_cover,
        lastPurchaseLabel: stock.last_purchase_at
          ? new Date(stock.last_purchase_at).toLocaleDateString("th-TH", { day: "numeric", month: "short" })
          : "—",
      };
    });
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <IngredientListClient storeId={storeId} items={items} />
    </main>
  );
}
