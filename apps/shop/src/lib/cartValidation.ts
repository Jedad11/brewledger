// WBS 5.2 — server-side (well: fresh-fetch) re-validation of a client-held
// cart against the current public menu. Kept as a standalone, pure,
// side-effect-free function per the WBS's own Claude Code Prompt §5 ("Write
// the re-validation itself as a standalone, testable function") so this
// same logic can be exercised directly (unit tests, or reused verbatim by
// WBS 5.4's checkout flow, which needs the identical check right before
// order creation) without needing to render the cart page or hit a network
// call itself — the caller re-fetches `fetchPublicMenu` and passes the
// result in.
//
// interaction_spec.md's own rule: "an item that goes unavailable while in a
// cart is flagged at checkout, not silently removed" — this function never
// mutates the cart; it only reports what changed. The caller (the cart
// page) decides what to do about it.
import type { CartLine } from "./cart";
import type { PublicMenuResponse } from "./publicApi";

interface DiffBase {
  /** Index into the CartLine[] this diff was computed against — lets the UI target the right line for an accept/remove action. */
  lineIndex: number;
}

export type CartDiffReason =
  | (DiffBase & { kind: "item_removed"; menuItemId: string; nameSnapshot: string })
  | (DiffBase & { kind: "item_unavailable"; menuItemId: string; nameSnapshot: string })
  | (DiffBase & {
      kind: "price_changed";
      menuItemId: string;
      nameSnapshot: string;
      oldSatang: number;
      newSatang: number;
    })
  | (DiffBase & {
      kind: "option_removed";
      menuItemId: string;
      groupId: string;
      optionId: string;
      name: string;
    })
  | (DiffBase & {
      kind: "option_price_changed";
      menuItemId: string;
      groupId: string;
      optionId: string;
      name: string;
      oldSatang: number;
      newSatang: number;
    });

export type CartValidationResult = { ok: true } | { ok: false; diffs: CartDiffReason[] };

// A menu item missing from the fresh response covers both "genuinely
// deleted" and "now hidden" — the anon RLS policy (WBS 3.6) excludes
// `hidden` rows from public-menu's response entirely, the same predicate
// MenuList.tsx's realtime handler already applies client-side (see
// apps/shop/src/lib/menu.ts's applyRealtimeMenuItemChange). Both cases are
// "can't sell this to you" from the customer's point of view, so they share
// one diff kind.
export function revalidateCart(lines: CartLine[], freshMenu: PublicMenuResponse): CartValidationResult {
  const itemsById = new Map(freshMenu.items.map((item) => [item.id, item]));
  const optionsById = new Map(freshMenu.options.map((option) => [option.id, option]));

  const diffs: CartDiffReason[] = [];

  lines.forEach((line, lineIndex) => {
    const freshItem = itemsById.get(line.menuItemId);
    if (!freshItem) {
      diffs.push({ lineIndex, kind: "item_removed", menuItemId: line.menuItemId, nameSnapshot: line.nameSnapshot });
      return;
    }

    if (freshItem.availability !== "available") {
      diffs.push({
        lineIndex,
        kind: "item_unavailable",
        menuItemId: line.menuItemId,
        nameSnapshot: line.nameSnapshot,
      });
    }

    if (freshItem.priceSatang !== line.unitPriceSatang) {
      diffs.push({
        lineIndex,
        kind: "price_changed",
        menuItemId: line.menuItemId,
        nameSnapshot: line.nameSnapshot,
        oldSatang: line.unitPriceSatang,
        newSatang: freshItem.priceSatang,
      });
    }

    for (const selection of line.options) {
      const freshOption = optionsById.get(selection.optionId);
      if (!freshOption) {
        diffs.push({
          lineIndex,
          kind: "option_removed",
          menuItemId: line.menuItemId,
          groupId: selection.groupId,
          optionId: selection.optionId,
          name: selection.name,
        });
        continue;
      }
      if (freshOption.priceDeltaSatang !== selection.deltaSatang) {
        diffs.push({
          lineIndex,
          kind: "option_price_changed",
          menuItemId: line.menuItemId,
          groupId: selection.groupId,
          optionId: selection.optionId,
          name: selection.name,
          oldSatang: selection.deltaSatang,
          newSatang: freshOption.priceDeltaSatang,
        });
      }
    }
  });

  return diffs.length === 0 ? { ok: true } : { ok: false, diffs };
}
