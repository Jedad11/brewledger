"use client";

// Cross-cutting fix (2026-08) -- ports /design/console-setup.js's SETUP array
// (line 23) as the "Settings" section's second-level nav, mirroring
// ReportsSubNav.tsx exactly (.oc-subnav, same active-tab-by-pathname logic).
// Tab order/labels/hrefs are confirmed against docs/design/screen_inventory.md;
// เมนู deliberately points at /console/menu, the one tab NOT nested under
// /console/settings/ -- see the exact-match check below.
//
// /console/settings/capacity exists as a route but is NOT in the prototype's
// SETUP array and has no screen_inventory.md entry, so (matching
// ReportsSubNav's own "don't link a route the prototype doesn't name" rule)
// it is intentionally omitted here, not a 7th tab.
//
// การแจ้งเตือน (/console/settings/notifications) is deliberately omitted too,
// the opposite situation from capacity: it IS in the prototype's SETUP array
// and IS documented in screen_inventory.md (owned by WBS 5.8), but no
// page.tsx exists at that route today -- WBS 5.8 built the push-subscription
// flow inline in the order inbox instead of as a dedicated settings screen.
// Linking it here would be a dead 404. Add it back the moment that page
// exists, matching ReportsSubNav's own precedent for its 4 omitted tabs.
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: Array<{ href: string; label: string }> = [
  { href: "/console/settings/store", label: "ข้อมูลร้าน" },
  { href: "/console/menu", label: "เมนู" },
  { href: "/console/settings/payments", label: "การรับเงิน" },
  { href: "/console/settings/link", label: "ลิงก์และ QR" },
  { href: "/console/settings/subscription", label: "แพ็กเกจ" },
];

export function SettingsSubNav() {
  const pathname = usePathname();
  return (
    <nav className="oc-subnav" data-testid="settings-subnav" aria-label="ตั้งค่า">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={pathname === tab.href ? "is-active" : ""}
          data-testid={`settings-subnav-${tab.href.split("/").pop()}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
