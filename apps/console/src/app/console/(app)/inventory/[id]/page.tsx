// WBS 6.5 — ingredient create/edit: /console/inventory/[id]. `id === "new"`
// is the creation sentinel, same convention as menu/[id]/page.tsx.
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { IngredientEditorForm, type IngredientEditorInitialData } from "./IngredientEditorForm";
import type { Database } from "@brewledger/db/types";
import type { BaseUnit } from "@brewledger/costing/dist/units";

type IngredientRow = Pick<
  Database["public"]["Tables"]["ingredients"]["Row"],
  "id" | "name" | "base_unit" | "low_stock_threshold" | "pack_size" | "store_id"
>;

export default async function IngredientEditorPage({ params }: PageProps<"/console/inventory/[id]">) {
  const { id } = await params;

  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    redirect("/console/login");
  }

  // storeId resolved once via lib/merchant.ts's currentStoreId(), same
  // canonical-store rule every other console editor screen follows.
  const storeId = currentStoreId(merchant);
  if (!storeId) {
    redirect("/console/settings/store");
  }

  if (id === "new") {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-8">
        <IngredientEditorForm storeId={storeId} ingredient={null} />
      </main>
    );
  }

  const supabase = await createClient();

  const { data: ingredientRow } = await supabase
    .from("ingredients")
    .select("id, name, base_unit, low_stock_threshold, pack_size, store_id")
    .eq("id", id)
    .eq("store_id", storeId)
    .maybeSingle();
  const ingredient = ingredientRow as IngredientRow | null;

  // RLS already scopes this to the caller's own store; the explicit
  // .eq("store_id", storeId) above is the WBS 4.2 second layer, same as
  // menu/[id]/page.tsx.
  if (!ingredient) {
    notFound();
  }

  // Base unit is IMMUTABLE once any purchase_line_item or stock_ledger row
  // references this ingredient (WBS 6.5, enforced at the DB layer by
  // 0036's prevent_base_unit_change_if_referenced trigger). Computed here,
  // server-side, so the form can disable the field with a Thai explanation
  // rather than the merchant discovering the rule only after a rejected
  // save.
  const [{ count: purchaseRefs }, { count: ledgerRefs }] = await Promise.all([
    supabase.from("purchase_line_items").select("id", { count: "exact", head: true }).eq("ingredient_id", ingredient.id),
    supabase.from("stock_ledger").select("id", { count: "exact", head: true }).eq("ingredient_id", ingredient.id),
  ]);
  const baseUnitLocked = (purchaseRefs ?? 0) > 0 || (ledgerRefs ?? 0) > 0;

  const initialData: IngredientEditorInitialData = {
    id: ingredient.id,
    name: ingredient.name,
    baseUnit: ingredient.base_unit as BaseUnit,
    lowStockThreshold: ingredient.low_stock_threshold,
    packSize: ingredient.pack_size,
    baseUnitLocked,
  };

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <IngredientEditorForm storeId={storeId} ingredient={initialData} />
    </main>
  );
}
