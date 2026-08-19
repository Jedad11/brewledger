import * as React from "react";

/**
 * Confirmed against /design/owner-console.js `const NAV=[['dash',...],
 * ['orders',...],['quick',...],['reports',...],['settings',...]]` — resolves
 * the ambiguity flagged in docs/ui/design_system_port_design.md §6 (the
 * design doc inferred the id set from the 5-column grid CSS only; these are
 * the real route-key strings the prototype actually uses).
 */
export type ConsoleNavItem = "dash" | "orders" | "quick" | "reports" | "settings";

const NAV_LABEL_TH: Record<ConsoleNavItem, string> = {
  dash: "หน้าหลัก",
  orders: "ออเดอร์",
  quick: "ขายหน้าร้าน",
  reports: "รายงาน",
  settings: "ตั้งค่า",
};

const NAV_ORDER: ConsoleNavItem[] = ["dash", "orders", "quick", "reports", "settings"];

export interface NavShellProps {
  /** Inventory pins this to the single literal 'console' — apps/shop has no tab-bar shell (its shell is `.cw-*`). */
  surface: "console";
  active: ConsoleNavItem;
  badge?: number;
}

// Responsive breakpoint per brewledger-tokens.css: .oc-nav (bottom bar) is
// default, .oc-side (sidebar) activates at min-width:1280px where
// .oc-nav{display:none} — a pure CSS media-query concern, not a `layout`
// prop the caller decides.
export function NavShell({ active, badge }: NavShellProps) {
  return (
    <>
      <nav className="oc-nav" data-testid="nav-shell-bottom">
        {NAV_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={`${active === key ? "is-active" : ""}${key === "quick" ? " slot-sell" : ""}`.trim()}
            data-testid={`nav-item-${key}`}
          >
            <span className="glyph" aria-hidden="true" />
            {NAV_LABEL_TH[key]}
            {key === "orders" && badge ? <span className="oc-badge num">{badge}</span> : null}
          </button>
        ))}
      </nav>
      <aside className="oc-side" data-testid="nav-shell-side">
        <div className="wordmark">BrewLedger</div>
        {NAV_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            className={active === key ? "is-active" : ""}
            data-testid={`nav-item-side-${key}`}
          >
            {NAV_LABEL_TH[key]}
            {key === "orders" && badge ? <span className="oc-count num">{badge}</span> : null}
          </button>
        ))}
      </aside>
    </>
  );
}
