// WBS 4.4 — menu item editor: /console/menu/[id]. `id === "new"` is the
// creation sentinel (no menu_items row exists yet) -- a dedicated /new route
// would need its own page duplicating this fetch-and-render shell for no
// behavioural difference; MenuItemEditorForm already branches cleanly on
// `item === null`.
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { MenuItemEditorForm, type MenuItemEditorInitialData, type MenuItemIngredientOption } from "./MenuItemEditorForm";
import type { Database } from "@brewledger/db/types";
import type { BaseUnit } from "@brewledger/costing/dist/units";

type MenuItemRow = Pick<
  Database["public"]["Tables"]["menu_items"]["Row"],
  "id" | "name" | "description" | "price_satang" | "image_path" | "store_id" | "recipe_suggestion_dismissed_at"
>;
type OptionGroupRow = Pick<Database["public"]["Tables"]["menu_option_groups"]["Row"], "id" | "name" | "sort_order">;
type OptionRow = Pick<
  Database["public"]["Tables"]["menu_options"]["Row"],
  "id" | "option_group_id" | "name" | "price_delta_satang" | "sort_order"
>;
type IngredientRow = Pick<
  Database["public"]["Tables"]["ingredients"]["Row"],
  "id" | "name" | "base_unit" | "current_unit_cost_satang"
>;
type BomLineRow = Pick<Database["public"]["Tables"]["bom_lines"]["Row"], "ingredient_id" | "qty_base_unit">;

// Recipe rows are always base-unit quantities (18 g, 200 ml) -- a different,
// smaller-scale label than the "per kg/L" human-purchase-unit labels
// packages/costing/src/units.ts's costPerHumanUnit produces, so not reused
// from there.
const BASE_UNIT_LABEL: Record<BaseUnit, string> = { g: "กรัม", ml: "มล.", piece: "ชิ้น" };

export default async function MenuItemEditorPage({ params }: PageProps<"/console/menu/[id]">) {
  const { id } = await params;

  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    redirect("/console/login");
  }

  // storeId is resolved once, in lib/merchant.ts's currentStoreId(), so a
  // new item saved here can't attach to a different stores row than the one
  // every other console screen (settings/store, settings/payments,
  // settings/link, menu) shows as current -- unlike the previous
  // `merchant.storeIds[0]`, which came straight off auth_store_ids()'s
  // set-returning RPC with no defined order at all.
  const storeId = currentStoreId(merchant);
  if (!storeId) {
    // No store yet -- nothing owns a menu item. Send the merchant to build
    // one first rather than rendering a broken "new item with no store"
    // form (saveMenuItem would reject it anyway, isOwnedStore has nothing to
    // check against).
    redirect("/console/settings/store");
  }

  const supabase = await createClient();

  // Needed whether this item is new or existing -- the suggestion matcher
  // (WBS 6.7) needs to know what ingredients already exist to prefill a
  // suggestion row's mapping, and the recipe editor's picker needs the full
  // list regardless of whether any recipe row exists yet.
  const { data: ingredientRows } = await supabase
    .from("ingredients")
    .select("id, name, base_unit, current_unit_cost_satang")
    .eq("store_id", storeId)
    .is("archived_at", null)
    .order("name", { ascending: true });
  const ingredientOptions: MenuItemIngredientOption[] = ((ingredientRows ?? []) as IngredientRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    baseUnit: row.base_unit as BaseUnit,
    currentCostSatang: row.current_unit_cost_satang,
  }));

  if (id === "new") {
    return (
      <div className="oc-body">
        <MenuItemEditorForm storeId={storeId} item={null} ingredientOptions={ingredientOptions} />
      </div>
    );
  }

  const { data: itemRow } = await supabase
    .from("menu_items")
    .select("id, name, description, price_satang, image_path, store_id, recipe_suggestion_dismissed_at")
    .eq("id", id)
    .eq("store_id", storeId)
    .maybeSingle();
  const item = itemRow as MenuItemRow | null;

  // RLS already scopes this to the caller's own store; the explicit
  // .eq("store_id", storeId) above is the WBS 4.2 second layer. Either way,
  // a row that doesn't resolve (wrong id, or someone else's item) is a 404,
  // not a blank "new item" form under an existing id.
  if (!item) {
    notFound();
  }

  const { data: groupRows } = await supabase
    .from("menu_option_groups")
    .select("id, name, sort_order")
    .eq("menu_item_id", item.id)
    .order("sort_order", { ascending: true });
  const groups = (groupRows ?? []) as OptionGroupRow[];

  const groupIds = groups.map((g) => g.id);
  let options: OptionRow[] = [];
  if (groupIds.length > 0) {
    const { data: optionRows } = await supabase
      .from("menu_options")
      .select("id, option_group_id, name, price_delta_satang, sort_order")
      .in("option_group_id", groupIds)
      .order("sort_order", { ascending: true });
    options = (optionRows ?? []) as OptionRow[];
  }

  const { data: bomRows } = await supabase
    .from("bom_lines")
    .select("ingredient_id, qty_base_unit")
    .eq("menu_item_id", item.id);
  const bomLines = (bomRows ?? []) as BomLineRow[];
  const ingredientById = new Map(ingredientOptions.map((o) => [o.id, o]));

  const initialData: MenuItemEditorInitialData = {
    id: item.id,
    name: item.name,
    description: item.description,
    priceSatang: item.price_satang,
    imagePath: item.image_path,
    imageUrl: item.image_path
      ? supabase.storage.from("menu-images").getPublicUrl(item.image_path).data.publicUrl
      : null,
    optionGroups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      options: options
        .filter((o) => o.option_group_id === g.id)
        .map((o) => ({ id: o.id, name: o.name, priceDeltaSatang: o.price_delta_satang })),
    })),
    // null (never [] for an item with zero bom_lines rows) — RL-2 baseline:
    // "no recipe row exists at all" is a distinct state from "an empty
    // recipe was explicitly saved", and only the former should ever show
    // a standard-recipe suggestion (see MenuItemEditorForm's own recipe
    // state derivation).
    recipe: bomLines.length > 0
      ? bomLines.map((row) => {
          const ingredient = ingredientById.get(row.ingredient_id);
          return {
            ingredientId: row.ingredient_id,
            ingredientName: ingredient?.name ?? "",
            quantity: row.qty_base_unit,
            unit: ingredient ? BASE_UNIT_LABEL[ingredient.baseUnit] : "",
          };
        })
      : null,
    recipeSuggestionDismissed: item.recipe_suggestion_dismissed_at !== null,
  };

  return (
    <div className="oc-body">
      <MenuItemEditorForm storeId={storeId} item={initialData} ingredientOptions={ingredientOptions} />
    </div>
  );
}
