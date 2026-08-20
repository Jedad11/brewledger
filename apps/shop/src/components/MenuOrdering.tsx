"use client";

import * as React from "react";
import type { PublicMenuCategory, PublicMenuItem, PublicOption, PublicOptionGroup } from "@/lib/publicApi";
import { useCart, type CartLine } from "@/lib/cart";
import { MenuList } from "./MenuList";
import { ItemOptionsSheet } from "./ItemOptionsSheet";

export interface MenuOrderingProps {
  slug: string;
  storeId: string;
  categories: PublicMenuCategory[];
  items: PublicMenuItem[];
  optionGroups: PublicOptionGroup[];
  options: PublicOption[];
  ordering: boolean;
  firstImageItemId: string | null;
}

// WBS 5.2 — wires the item options sheet onto WBS 5.1's MenuList: tapping an
// item opens ItemOptionsSheet.tsx; adding to cart writes into the
// sessionStorage cart store (apps/shop/src/lib/cart.ts) and closes it.
// Renders inside `.cw-body`, matching the prototype's own scMenu() layout —
// unlike CartBar.tsx (a sibling of `.cw-body`, see that file's comment for
// why), the sheet's own `.cw-sheet`/`.cw-scrim` are `position: fixed`, so
// where they mount in the DOM doesn't affect their on-screen position.
export function MenuOrdering({
  slug,
  storeId,
  categories,
  items,
  optionGroups,
  options,
  ordering,
  firstImageItemId,
}: MenuOrderingProps) {
  const [openItemId, setOpenItemId] = React.useState<string | null>(null);
  const { addLine } = useCart(slug);

  const openItem = openItemId ? (items.find((item) => item.id === openItemId) ?? null) : null;

  function handleAddToCart(line: CartLine) {
    addLine(line);
    setOpenItemId(null);
  }

  return (
    <>
      <MenuList
        storeId={storeId}
        categories={categories}
        items={items}
        ordering={ordering}
        firstImageItemId={firstImageItemId}
        onItemTap={ordering ? (item) => setOpenItemId(item.id) : undefined}
      />

      {openItem ? (
        <ItemOptionsSheet
          item={openItem}
          optionGroups={optionGroups}
          options={options}
          onClose={() => setOpenItemId(null)}
          onAddToCart={handleAddToCart}
        />
      ) : null}
    </>
  );
}
