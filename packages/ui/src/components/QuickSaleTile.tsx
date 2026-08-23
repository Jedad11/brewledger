import * as React from "react";
import { MoneyValue } from "./MoneyValue";

const LONG_PRESS_MS = 500;

/**
 * WBS 5.12 — `/console/sales/quick`'s fast-entry grid. Ported from
 * `/design/Owner Console.html`'s `.oc-tile`/`.oc-tile.is-hot`/
 * `.oc-tilebadge` (`docs/design/component_inventory.md`, added in this
 * same change — no tile-grid component existed before this entry). One
 * tile per menu item; the caller composes the grid (`.oc-tiles`) and owns
 * cart state — this component is presentational plus press detection only.
 *
 * Tap adds one (interaction_spec.md: "local until รับเงินสด"); a long
 * press (500ms, no platform-standard duration exists for this — the prompt
 * `contextmenu` timing browsers use natively) opens the option sheet
 * instead of adding, for a tile whose menu item has option groups. `hot`
 * drives the 128px/double-width variant (interaction_spec.md's tap-target
 * table); non-hot tiles are 104px min via `.oc-tile`'s own min-height.
 */
export interface QuickSaleTileProps {
  id: string;
  name: string;
  priceSatang: number;
  /** Total quantity across every cart line for this menu item, regardless of option combination. 0 renders no badge. */
  quantityInCart: number;
  hot: boolean;
  onTap: (id: string) => void;
  onLongPress: (id: string) => void;
}

export function QuickSaleTile({ id, name, priceSatang, quantityInCart, hot, onTap, onLongPress }: QuickSaleTileProps) {
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = React.useRef(false);

  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handlePointerDown() {
    longPressFiredRef.current = false;
    clearTimer();
    timerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      onLongPress(id);
    }, LONG_PRESS_MS);
  }

  function handlePointerUpOrLeave() {
    clearTimer();
  }

  function handleClick(event: React.MouseEvent) {
    // contextmenu (right-click / long-press-on-touch in some browsers) is
    // handled separately below -- suppress the synthetic click it also
    // fires, and suppress the click that follows a pointer-timer long press
    // fire, so a single physical press never both adds a default line AND
    // opens the sheet.
    if (longPressFiredRef.current) {
      event.preventDefault();
      longPressFiredRef.current = false;
      return;
    }
    onTap(id);
  }

  function handleContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    clearTimer();
    onLongPress(id);
  }

  return (
    <button
      type="button"
      className={`oc-tile${hot ? " is-hot" : ""}`}
      data-testid="quick-sale-tile"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUpOrLeave}
      onPointerLeave={handlePointerUpOrLeave}
      onPointerCancel={handlePointerUpOrLeave}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
    >
      <b>{name}</b>
      <span className="num">
        <MoneyValue value={priceSatang} role="plain" size="sm" />
      </span>
      {quantityInCart > 0 ? (
        <span className="oc-tilebadge num" data-testid="quick-sale-tile-badge">
          {quantityInCart}
        </span>
      ) : null}
    </button>
  );
}
