// WBS 5.12 — pure local-cart helpers for the quick-sale screen. Purely
// client-side until the `รับเงินสด` tap (interaction_spec.md: "local until
// รับเงินสด") — no Supabase import anywhere in this file, same discipline
// apps/shop/src/lib/cart.ts documents for the same reason: no order row
// should exist for a sale not yet confirmed.
import type { CartOptionSelection } from "./optionSelection";

export interface QuickCartLine {
  menuItemId: string;
  nameSnapshot: string;
  /** Integer satang. Never a float — see CLAUDE.md's money rules. */
  unitPriceSatang: number;
  options: CartOptionSelection[];
  quantity: number;
}

/** Order-independent key so two adds with the same options (different tap order) merge into one line. */
function optionsKey(options: CartOptionSelection[]): string {
  return [...options]
    .map((o) => o.optionId)
    .sort()
    .join(",");
}

export function addToCart(
  cart: QuickCartLine[],
  line: { menuItemId: string; nameSnapshot: string; unitPriceSatang: number; options: CartOptionSelection[] },
): QuickCartLine[] {
  const key = optionsKey(line.options);
  const existingIndex = cart.findIndex((l) => l.menuItemId === line.menuItemId && optionsKey(l.options) === key);
  if (existingIndex === -1) {
    return [...cart, { ...line, quantity: 1 }];
  }
  return cart.map((l, i) => (i === existingIndex ? { ...l, quantity: l.quantity + 1 } : l));
}

export function cartTotalSatang(cart: QuickCartLine[]): number {
  return cart.reduce(
    (sum, line) =>
      sum + (line.unitPriceSatang + line.options.reduce((s, o) => s + o.deltaSatang, 0)) * line.quantity,
    0,
  );
}

export function cartCups(cart: QuickCartLine[]): number {
  return cart.reduce((sum, line) => sum + line.quantity, 0);
}

/** Tile badge count — total quantity across every line for this item, regardless of which option combo. */
export function quantityInCartForItem(cart: QuickCartLine[], menuItemId: string): number {
  return cart.filter((l) => l.menuItemId === menuItemId).reduce((sum, l) => sum + l.quantity, 0);
}
