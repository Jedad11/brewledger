"use client";

// WBS 5.12 — long-press option sheet, opened only for a tile whose menu
// item has option groups. Markup/CSS classes mirror apps/shop's
// ItemOptionsSheet.tsx (`.cw-opt`/`.cw-optg`/`.cw-opts`, already ported into
// packages/ui/src/components.css and shared by both apps) inside the
// console's own `.oc-scrim`/`.oc-sheet` wrapper (owner-console.js's own
// cancelSheet() uses that same wrapper pair for its reason-picker) — not
// imported from apps/shop directly, per the eslint boundary rule.
import * as React from "react";
import { MoneyValue } from "@brewledger/ui";
import {
  areAllGroupsSatisfied,
  selectedOptionsDeltaSatang,
  selectedOptionsForCart,
  toggleOptionSelection,
  type CartOptionSelection,
  type OptionSelections,
  type QuickSaleOption,
  type QuickSaleOptionGroup,
} from "./optionSelection";
import { SHEET_ADD_LABEL } from "./copy";

export interface QuickSaleOptionSheetProps {
  itemName: string;
  priceSatang: number;
  groups: QuickSaleOptionGroup[];
  optionsByGroup: Map<string, QuickSaleOption[]>;
  initialSelections: OptionSelections;
  onClose: () => void;
  onAdd: (options: CartOptionSelection[]) => void;
}

export function QuickSaleOptionSheet({
  itemName,
  priceSatang,
  groups,
  optionsByGroup,
  initialSelections,
  onClose,
  onAdd,
}: QuickSaleOptionSheetProps) {
  const [selections, setSelections] = React.useState<OptionSelections>(initialSelections);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const allOptions = React.useMemo(() => Array.from(optionsByGroup.values()).flat(), [optionsByGroup]);
  const canAdd = areAllGroupsSatisfied(groups, selections);
  const unitPriceSatang = priceSatang + selectedOptionsDeltaSatang(allOptions, selections);

  function handleAdd() {
    if (!canAdd) return;
    onAdd(selectedOptionsForCart(allOptions, selections));
  }

  return (
    <>
      <div className="oc-scrim" onClick={onClose} data-testid="quick-sheet-scrim" />
      <div className="oc-sheet" role="dialog" aria-modal="true" aria-label={itemName}>
        <h3>{itemName}</h3>
        <p className="num cw-base">
          <MoneyValue value={unitPriceSatang} role="plain" />
        </p>

        {groups
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((group) => {
            const groupOptions = [...(optionsByGroup.get(group.id) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
            const selected = selections[group.id] ?? [];
            return (
              <div className="cw-optg" key={group.id}>
                <h4>{group.name}</h4>
                <div className="cw-opts">
                  {groupOptions.map((option) => {
                    const isOn = selected.includes(option.id);
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
                            <MoneyValue value={option.priceDeltaSatang} role="plain" />
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

        <button type="button" className="btn btn--primary btn--wet" disabled={!canAdd} onClick={handleAdd}>
          {SHEET_ADD_LABEL} · <MoneyValue value={unitPriceSatang} role="plain" />
        </button>
      </div>
    </>
  );
}
