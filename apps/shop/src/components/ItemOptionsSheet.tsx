"use client";

import * as React from "react";
import { PublicMoneyValue } from "@brewledger/ui";
import type { PublicMenuItem, PublicOption, PublicOptionGroup } from "@/lib/publicApi";
import type { CartLine } from "@/lib/cart";
import {
  areAllGroupsSatisfied,
  selectedOptionsDeltaSatang,
  selectedOptionsForCart,
  toggleOptionSelection,
  type OptionSelections,
} from "@/lib/optionSelection";
import { ADD_TO_CART_LABEL, DECREASE_QUANTITY_LABEL, INCREASE_QUANTITY_LABEL, QUANTITY_LABEL } from "@/lib/copy";

export interface ItemOptionsSheetProps {
  item: PublicMenuItem;
  /** Full store response — filtered to this item's groups/options inside. */
  optionGroups: PublicOptionGroup[];
  options: PublicOption[];
  onClose: () => void;
  onAddToCart: (line: CartLine) => void;
}

// WBS 5.2 — bottom sheet opened from a tapped menu item. Ported markup from
// /design/Customer Web.html's sheet() (customer-web.js lines 58-66), see
// docs/design/state_matrix.md's "ตัวเลือกรายการ (sheet)" section for the
// single-select vs. multi-select generalization this makes beyond what the
// prototype's own demo data needed.
export function ItemOptionsSheet({ item, optionGroups, options, onClose, onAddToCart }: ItemOptionsSheetProps) {
  const groups = React.useMemo(
    () => optionGroups.filter((group) => group.menuItemId === item.id).sort((a, b) => a.sortOrder - b.sortOrder),
    [optionGroups, item.id],
  );

  const optionsByGroup = React.useMemo(() => {
    const map = new Map<string, PublicOption[]>();
    for (const group of groups) {
      map.set(
        group.id,
        options.filter((option) => option.optionGroupId === group.id).sort((a, b) => a.sortOrder - b.sortOrder),
      );
    }
    return map;
  }, [groups, options]);

  const [selections, setSelections] = React.useState<OptionSelections>({});
  const [quantity, setQuantity] = React.useState(1);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const canAdd = areAllGroupsSatisfied(groups, selections);
  const unitPriceSatang = item.priceSatang + selectedOptionsDeltaSatang(options, selections);
  const lineTotalSatang = unitPriceSatang * quantity;

  function handleAdd() {
    if (!canAdd) return;
    onAddToCart({
      menuItemId: item.id,
      nameSnapshot: item.name,
      unitPriceSatang: item.priceSatang,
      options: selectedOptionsForCart(options, selections),
      quantity,
    });
  }

  return (
    <>
      {/* Matches the prototype's own scrim-tap-to-close behavior (a plain div, no button semantics); Escape is handled above as the keyboard equivalent. */}
      <div className="cw-scrim" onClick={onClose} data-testid="sheet-scrim" />
      <div className="cw-sheet" role="dialog" aria-modal="true" aria-label={item.name}>
        <div className="cw-sheet-scroll">
          <div className="cw-hero" aria-hidden="true" />
          <h3>{item.name}</h3>
          {item.description ? <p className="note-plain">{item.description}</p> : null}
          <p className="num cw-base">
            <PublicMoneyValue value={item.priceSatang} />
          </p>

          {groups.map((group) => {
            const groupOptions = optionsByGroup.get(group.id) ?? [];
            const selected = selections[group.id] ?? [];
            return (
              <div className="cw-optg" key={group.id}>
                <h4>{group.name}</h4>
                <div className="cw-opts">
                  {groupOptions.map((option) => {
                    const isOn = selected.includes(option.id);
                    // Only relevant for multi-select groups (maxSelect > 1):
                    // once the cap is reached, un-selected options become
                    // inert rather than silently bumping an earlier choice.
                    const atCap = group.maxSelect > 1 && !isOn && selected.length >= group.maxSelect;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        className={`cw-opt${isOn ? " is-on" : ""}`}
                        aria-pressed={isOn}
                        disabled={atCap}
                        onClick={() => setSelections((prev) => toggleOptionSelection(prev, group, option.id))}
                      >
                        {option.name}
                        {option.priceDeltaSatang !== 0 ? (
                          <span className="num">
                            {option.priceDeltaSatang > 0 ? "+" : ""}
                            <PublicMoneyValue value={option.priceDeltaSatang} />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="cw-optg">
            <h4>{QUANTITY_LABEL}</h4>
            <div className="cw-step">
              <button
                type="button"
                aria-label={DECREASE_QUANTITY_LABEL}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                −
              </button>
              <span className="num">{quantity}</span>
              <button type="button" aria-label={INCREASE_QUANTITY_LABEL} onClick={() => setQuantity((q) => q + 1)}>
                +
              </button>
            </div>
          </div>
        </div>
        <div className="cw-sheet-foot">
          <button type="button" className="btn btn--primary btn--wet" disabled={!canAdd} onClick={handleAdd}>
            {ADD_TO_CART_LABEL} · <PublicMoneyValue value={lineTotalSatang} />
          </button>
        </div>
      </div>
    </>
  );
}
