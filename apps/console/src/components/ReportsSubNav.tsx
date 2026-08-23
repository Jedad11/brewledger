"use client";

// Cross-cutting fix (2026-08) -- ports /design/Console Reports.html's
// .oc-subnav (TABS array) as a shared second-level nav for the "Reports"
// screen grouping. The prototype's TABS has 7 entries (capture/review/
// inventory/ledger/pnl/dish/overview); WBS 6.1 capture, 6.4 review, and
// GAP-1 ledger still have no real route -- omitted rather than linked dead,
// per this fix's own brief. Extend this list as each of those lands; do not
// add a route here before its page exists. WBS 7.7 added the fourth entry
// (overview) in this change.
//
// Labels are the exact state_matrix.md section headers (docs/design/
// state_matrix.md lines 284/299/304/314), not the pnl page's own longer H1
// ("กำไรขาดทุนรายวัน") -- the sub-nav tab and the page heading are
// different strings in the prototype too (TABS label vs S.screen heading).
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: Array<{ href: string; label: string }> = [
  { href: "/console/inventory", label: "คลังวัตถุดิบ" },
  { href: "/console/reports/pnl", label: "กำไรขาดทุน" },
  { href: "/console/reports/profit-per-dish", label: "กำไรต่อเมนู" },
  { href: "/console/reports/overview", label: "เปรียบเทียบ" },
];

export function ReportsSubNav() {
  const pathname = usePathname();
  return (
    <nav className="oc-subnav" data-testid="reports-subnav" aria-label="รายงาน">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={pathname === tab.href ? "is-active" : ""}
          data-testid={`reports-subnav-${tab.href.split("/").pop()}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
