"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

// Per docs/design/screen_inventory.md. "reports" points at /console/reports/pnl
// to match the prototype's own default S.screen='pnl' in console-reports.js.
// "settings" points at /console/settings/store -- no single /console/settings
// index route exists; flagged for redline_reviewer as the most sensible
// default, not a value taken from any spec.
const NAV_ROUTE: Record<ConsoleNavItem, string> = {
  dash: "/console",
  orders: "/console/orders",
  quick: "/console/sales/quick",
  reports: "/console/reports/pnl",
  settings: "/console/settings/store",
};

// /console/inventory is grouped under Reports (see ReportsSubNav.tsx) but
// lives outside the /console/reports/* prefix -- treated as "reports" here
// too so the top-level nav item highlights consistently with that grouping.
function deriveActive(pathname: string): ConsoleNavItem {
  if (pathname.startsWith("/console/orders")) return "orders";
  if (pathname.startsWith("/console/sales")) return "quick";
  if (pathname.startsWith("/console/reports") || pathname.startsWith("/console/inventory")) return "reports";
  if (pathname.startsWith("/console/settings")) return "settings";
  return "dash";
}

export interface NavShellProps {
  /** Inventory pins this to the single literal 'console' — apps/shop has no tab-bar shell (its shell is `.cw-*`). */
  surface: "console";
  /**
   * Optional override. The real console shell (apps/console layout.tsx)
   * omits this and lets NavShell derive it from usePathname() -- a caller
   * must not hardcode which tab is active, since that drifts the moment a
   * new route lands under an existing tab. Kept only so the fidelity
   * gallery (packages/ui/src/gallery.tsx), which renders outside any
   * Next.js router context, can still request a specific state.
   */
  active?: ConsoleNavItem;
  badge?: number;
}

// Responsive breakpoint per brewledger-tokens.css: .oc-nav (bottom bar) is
// default, .oc-side (sidebar) activates at min-width:1280px where
// .oc-nav{display:none} — a pure CSS media-query concern, not a `layout`
// prop the caller decides.
export function NavShell({ active: activeOverride, badge }: NavShellProps) {
  const pathname = usePathname();
  const active = activeOverride ?? deriveActive(pathname ?? "");

  return (
    <>
      <nav className="oc-nav" data-testid="nav-shell-bottom">
        {NAV_ORDER.map((key) => (
          <Link
            key={key}
            href={NAV_ROUTE[key]}
            className={`${active === key ? "is-active" : ""}${key === "quick" ? " slot-sell" : ""}`.trim()}
            data-testid={`nav-item-${key}`}
          >
            <span className="glyph" aria-hidden="true" />
            {NAV_LABEL_TH[key]}
            {key === "orders" && badge ? <span className="oc-badge num">{badge}</span> : null}
          </Link>
        ))}
      </nav>
      <aside className="oc-side" data-testid="nav-shell-side">
        <div className="wordmark">BrewLedger</div>
        {NAV_ORDER.map((key) => (
          <Link
            key={key}
            href={NAV_ROUTE[key]}
            className={active === key ? "is-active" : ""}
            data-testid={`nav-item-side-${key}`}
          >
            {NAV_LABEL_TH[key]}
            {key === "orders" && badge ? <span className="oc-count num">{badge}</span> : null}
          </Link>
        ))}
      </aside>
    </>
  );
}
