"use client";

// WBS 5.12 — /console/sales/quick. Tile taps build a purely local cart
// (interaction_spec.md: "local until รับเงินสด" — no Supabase read/write
// happens until the confirm tap); only that one tap calls the server.
import * as React from "react";
import { Card, MoneyValue, QuickSaleTile } from "@brewledger/ui";
import type { QuickSaleMenuItem } from "./fetchQuickSaleTiles";
import {
  areAllGroupsSatisfied,
  defaultSelectionsForGroups,
  selectedOptionsForCart,
  type CartOptionSelection,
  type QuickSaleOption,
  type QuickSaleOptionGroup,
} from "./optionSelection";
import { addToCart, cartCups, cartTotalSatang, quantityInCartForItem, type QuickCartLine } from "./cart";
import { QuickSaleOptionSheet } from "./QuickSaleOptionSheet";
import { createCashSale, undoCashSale, type CashSaleCartLine } from "./actions";
import {
  CONFIRM_LABEL,
  CUPS_SUFFIX,
  RECENT_SALES_TITLE,
  SALE_FAILED,
  UNDO_EXPIRED_LABEL,
  UNDO_FAILED,
  UNDO_LABEL,
} from "./copy";

const UNDO_WINDOW_MS = 2 * 60 * 1000;

function formatSaleTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

interface RecentSale {
  orderId: string;
  time: string;
  cups: number;
  totalSatang: number;
  createdAtMs: number;
  undoFailed: boolean;
}

export interface QuickSaleClientProps {
  items: QuickSaleMenuItem[];
  optionGroups: QuickSaleOptionGroup[];
  options: QuickSaleOption[];
}

export function QuickSaleClient({ items, optionGroups, options }: QuickSaleClientProps) {
  const [cart, setCart] = React.useState<QuickCartLine[]>([]);
  const [sheetItemId, setSheetItemId] = React.useState<string | null>(null);
  const [recentSales, setRecentSales] = React.useState<RecentSale[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [saleError, setSaleError] = React.useState<string | null>(null);
  // Same nowMs-tick pattern as orders/PendingPaymentSection.tsx's own
  // countdown -- re-computed on an interval (never read impurely during
  // render) so an active undo button flips to the static หมดเวลายกเลิก
  // label the moment the 2-minute window passes, even with no other
  // interaction on the page.
  const [nowMs, setNowMs] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (recentSales.length === 0) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [recentSales.length]);

  const groupsByItem = React.useMemo(() => {
    const map = new Map<string, QuickSaleOptionGroup[]>();
    for (const group of optionGroups) {
      const list = map.get(group.menuItemId) ?? [];
      list.push(group);
      map.set(group.menuItemId, list);
    }
    return map;
  }, [optionGroups]);

  const optionsByGroup = React.useMemo(() => {
    const map = new Map<string, QuickSaleOption[]>();
    for (const option of options) {
      const list = map.get(option.optionGroupId) ?? [];
      list.push(option);
      map.set(option.optionGroupId, list);
    }
    return map;
  }, [options]);

  const itemsById = React.useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  function addDefault(itemId: string) {
    const item = itemsById.get(itemId);
    if (!item) return;
    const groups = groupsByItem.get(itemId) ?? [];
    const defaults = defaultSelectionsForGroups(groups, optionsByGroup);
    if (!areAllGroupsSatisfied(groups, defaults)) {
      // A required group has zero options configured -- nothing valid to
      // default to. Open the sheet instead of silently adding an invalid
      // line the server would only reject.
      setSheetItemId(itemId);
      return;
    }
    const cartOptions = selectedOptionsForCart(options, defaults);
    setCart((prev) =>
      addToCart(prev, {
        menuItemId: item.id,
        nameSnapshot: item.name,
        unitPriceSatang: item.priceSatang,
        options: cartOptions,
      }),
    );
    setSaleError(null);
  }

  function handleLongPress(itemId: string) {
    const groups = groupsByItem.get(itemId) ?? [];
    if (groups.length === 0) return; // nothing to customize
    setSheetItemId(itemId);
  }

  function handleSheetAdd(itemId: string, cartOptions: CartOptionSelection[]) {
    const item = itemsById.get(itemId);
    if (!item) return;
    setCart((prev) =>
      addToCart(prev, {
        menuItemId: item.id,
        nameSnapshot: item.name,
        unitPriceSatang: item.priceSatang,
        options: cartOptions,
      }),
    );
    setSheetItemId(null);
    setSaleError(null);
  }

  async function handleConfirm() {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    setSaleError(null);
    const lines: CashSaleCartLine[] = cart.map((line) => ({
      menuItemId: line.menuItemId,
      nameSnapshot: line.nameSnapshot,
      unitPriceSatang: line.unitPriceSatang,
      quantity: line.quantity,
      options: line.options.map((o) => ({
        groupId: o.groupId,
        optionId: o.optionId,
        name: o.name,
        deltaSatang: o.deltaSatang,
      })),
    }));

    const result = await createCashSale(lines);
    setSubmitting(false);

    if (!result.ok) {
      setSaleError(result.error ?? SALE_FAILED);
      return;
    }

    setCart([]);
    setRecentSales((prev) =>
      [
        {
          orderId: result.order.id,
          time: formatSaleTime(result.order.created_at),
          cups: result.order.cups,
          totalSatang: result.order.total_satang,
          createdAtMs: Date.parse(result.order.created_at),
          undoFailed: false,
        },
        ...prev,
      ].slice(0, 5),
    );
  }

  async function handleUndo(orderId: string) {
    const result = await undoCashSale(orderId);
    if (result.ok) {
      setRecentSales((prev) => prev.filter((sale) => sale.orderId !== orderId));
    } else {
      setRecentSales((prev) => prev.map((sale) => (sale.orderId === orderId ? { ...sale, undoFailed: true } : sale)));
    }
  }

  const totalSatang = cartTotalSatang(cart);
  const cups = cartCups(cart);
  const sheetItem = sheetItemId ? itemsById.get(sheetItemId) : null;

  return (
    <>
      {/* .oc-body + .oc-quick are ONE element here (matches /design/Owner
       * Console.html's <div class="oc-body oc-quick">), and .oc-total below
       * is its SIBLING, not its child -- Owner Console.html's scQuick()
       * returns them as two separate top-level pieces
       * (`<div class="oc-body oc-quick">...</div><div class="oc-total">...`).
       * Nesting .oc-total inside this div (an earlier version of this file
       * did) left zero gap between the tile grid and the total bar: neither
       * .oc-body's own trailing padding nor .oc-quick's padding-bottom ever
       * lands BEFORE .oc-total when .oc-total is its last child, only after
       * it, at the very bottom of everything. */}
      <div className="oc-body oc-quick">
        <div className="oc-tiles">
        {items.map((item) => (
          <QuickSaleTile
            key={item.id}
            id={item.id}
            name={item.name}
            priceSatang={item.priceSatang}
            quantityInCart={quantityInCartForItem(cart, item.id)}
            hot={item.hot}
            onTap={addDefault}
            onLongPress={handleLongPress}
          />
        ))}
      </div>

      {recentSales.length > 0 ? (
        <Card>
          <h4>{RECENT_SALES_TITLE}</h4>
          <div className="oc-recent">
            {recentSales.map((sale) => {
              const expired = nowMs - sale.createdAtMs >= UNDO_WINDOW_MS;
              return (
                <div className="oc-recrow" key={sale.orderId} data-testid="recent-sale-row">
                  <span className="num">{sale.time}</span>
                  <span>
                    {sale.cups} {CUPS_SUFFIX}
                  </span>
                  <b className="num">
                    <MoneyValue value={sale.totalSatang} role="revenue" />
                  </b>
                  {expired ? (
                    <span className="note-plain">{UNDO_EXPIRED_LABEL}</span>
                  ) : (
                    <button type="button" className="btn btn--quiet" onClick={() => handleUndo(sale.orderId)}>
                      {UNDO_LABEL}
                    </button>
                  )}
                  {sale.undoFailed ? (
                    // Persistent inline message, never a vanishing toast --
                    // same posture as every other optimistic control in
                    // this console (interaction_spec.md).
                    <p className="note-plain" style={{ gridColumn: "1 / -1" }}>
                      {UNDO_FAILED}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {saleError ? <p className="note-plain">{saleError}</p> : null}

      {sheetItem ? (
        <QuickSaleOptionSheet
          itemName={sheetItem.name}
          priceSatang={sheetItem.priceSatang}
          groups={groupsByItem.get(sheetItem.id) ?? []}
          optionsByGroup={optionsByGroup}
          initialSelections={defaultSelectionsForGroups(groupsByItem.get(sheetItem.id) ?? [], optionsByGroup)}
          onClose={() => setSheetItemId(null)}
          onAdd={(cartOptions) => handleSheetAdd(sheetItem.id, cartOptions)}
        />
      ) : null}
      </div>

      <div className="oc-total">
        <div>
          <span className="note-plain">
            {cups} {CUPS_SUFFIX}
          </span>
          <div className="oc-big">
            <MoneyValue value={totalSatang} role="revenue" />
          </div>
        </div>
        <button
          type="button"
          className={`btn btn--primary btn--wet${cart.length === 0 ? " is-disabled" : ""}`}
          disabled={cart.length === 0 || submitting}
          onClick={handleConfirm}
          data-testid="quick-sale-confirm"
        >
          {CONFIRM_LABEL}
        </button>
      </div>
    </>
  );
}
