// WBS 4.4 — menu item editor: /console/menu/[id]. `id === "new"` is the
// creation sentinel (no menu_items row exists yet) -- a dedicated /new route
// would need its own page duplicating this fetch-and-render shell for no
// behavioural difference; MenuItemEditorForm already branches cleanly on
// `item === null`.
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { MenuItemEditorForm, type MenuItemEditorInitialData } from "./MenuItemEditorForm";
import type { Database } from "@brewledger/db/types";

type MenuItemRow = Pick<
  Database["public"]["Tables"]["menu_items"]["Row"],
  "id" | "name" | "description" | "price_satang" | "image_path" | "store_id"
>;
type OptionGroupRow = Pick<Database["public"]["Tables"]["menu_option_groups"]["Row"], "id" | "name" | "sort_order">;
type OptionRow = Pick<
  Database["public"]["Tables"]["menu_options"]["Row"],
  "id" | "option_group_id" | "name" | "price_delta_satang" | "sort_order"
>;

export default async function MenuItemEditorPage({ params }: PageProps<"/console/menu/[id]">) {
  const { id } = await params;

  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    redirect("/console/login");
  }

  const storeId = merchant.storeIds[0] ?? null;
  if (!storeId) {
    // No store yet -- nothing owns a menu item. Send the merchant to build
    // one first rather than rendering a broken "new item with no store"
    // form (saveMenuItem would reject it anyway, isOwnedStore has nothing to
    // check against).
    redirect("/console/settings/store");
  }

  if (id === "new") {
    return (
      <main className="mx-auto w-full max-w-xl px-4 py-8">
        <MenuItemEditorForm storeId={storeId} item={null} />
      </main>
    );
  }

  const supabase = await createClient();

  const { data: itemRow } = await supabase
    .from("menu_items")
    .select("id, name, description, price_satang, image_path, store_id")
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
  };

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <MenuItemEditorForm storeId={storeId} item={initialData} />
    </main>
  );
}
