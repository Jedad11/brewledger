"use client";

// WBS 7.1 — the four headline cards, upcoming-slot list, and quick-action
// row for /console. Server-rendered once (page.tsx) for the "renders within
// 1 second" acceptance criterion, then kept live by useDashboardSummary's
// realtime + poll — this component itself does no fetching of its own on
// mount, only re-renders when that hook's return value changes.
import * as React from "react";
import Link from "next/link";
import { MetricCard, UntrackedDisclosure } from "@brewledger/ui";
import { createClient } from "@/lib/supabase/client";
import { useDashboardSummary } from "./useDashboardSummary";
import type { DashboardSummary, UpcomingSlot } from "./fetchDashboardSummary";
import { formatPickupTime } from "./orders/format";
import {
  REVENUE_LABEL,
  PROFIT_LABEL,
  EXPENSES_LABEL,
  ORDERS_LABEL,
  ORDERS_WAITING_SUFFIX,
  ORDERS_PREPARING_SUFFIX,
  ORDERS_READY_SUFFIX,
  NO_COST_DATA_NOTE,
  UPCOMING_SLOTS_TITLE,
  UPCOMING_SLOTS_UNIT,
  upcomingSlotBookedLabel,
  QUICK_ACTION_ORDERS,
  QUICK_ACTION_QUICK_SALE,
  QUICK_ACTION_SCAN_BILL,
} from "./copy";

function OrdersMetricCard({ counts }: { counts: DashboardSummary["orderCounts"] }) {
  // Not MetricCard: the "ออเดอร์" card has never been a MoneyValue figure
  // (component_inventory.md's own MetricCard contract is `value: number |
  // null` rendered through MoneyValue) — three plain counts, same `.oc-split`
  // shape design/Owner Console.html's own scDash() renders it with.
  return (
    <div className="card bl-metric-card" data-testid="metric-card-orders">
      <p className="note-plain">{ORDERS_LABEL}</p>
      <div className="oc-split">
        <span>
          <b className="num">{counts.waiting}</b>
          {ORDERS_WAITING_SUFFIX}
        </span>
        <span>
          <b className="num">{counts.preparing}</b>
          {ORDERS_PREPARING_SUFFIX}
        </span>
        <span>
          <b className="num">{counts.ready}</b>
          {ORDERS_READY_SUFFIX}
        </span>
      </div>
    </div>
  );
}

function UpcomingSlots({ slots }: { slots: UpcomingSlot[] }) {
  if (slots.length === 0) return null;
  return (
    <div className="card">
      <h3>{UPCOMING_SLOTS_TITLE}</h3>
      <div className="oc-slots">
        {slots.map((slot) => (
          <div key={slot.id} className="oc-slotrow">
            <b className="num">
              {formatPickupTime(slot.slotStart)} {UPCOMING_SLOTS_UNIT}
            </b>
            <span className="note-plain">{upcomingSlotBookedLabel(slot.bookedCount)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Pure presentational render of one summary snapshot — shared by
// DashboardClient (the live, realtime-backed path) and page.tsx's own
// "no store yet" path (WBS 4.3 not finished), which has nothing to keep
// live and renders EMPTY_SUMMARY once with no hook involved at all.
export function DashboardView({ summary }: { summary: DashboardSummary }) {
  // RL-2: zero tracked lines -> the plain, non-alarming note; some tracked,
  // some not -> UntrackedDisclosure's own "dashboard" variant (item-count
  // phrasing, WBS 7.1 Claude Code Prompt step 2). Both, never together.
  const profitNote =
    summary.trackedItemCount === 0 && summary.totalItemCount > 0 ? NO_COST_DATA_NOTE : undefined;

  return (
    <div className="oc-body" data-testid="dashboard">
      <div className="oc-metrics">
        <MetricCard label={REVENUE_LABEL} value={summary.revenueSatang} role="revenue" />
        <MetricCard label={PROFIT_LABEL} value={summary.profitSatang} role="profit" note={profitNote} />
        <MetricCard label={EXPENSES_LABEL} value={summary.expensesSatang} role="cost" />
        <OrdersMetricCard counts={summary.orderCounts} />
      </div>

      {summary.trackedItemCount > 0 ? (
        <UntrackedDisclosure
          trackedCount={summary.trackedItemCount}
          totalCount={summary.totalItemCount}
          variant="dashboard"
        />
      ) : null}

      <UpcomingSlots slots={summary.upcomingSlots} />

      <div className="oc-quickrow">
        <Link href="/console/orders" className="btn btn--outline" data-testid="quick-action-orders">
          {QUICK_ACTION_ORDERS}
        </Link>
        <Link href="/console/sales/quick" className="btn btn--primary" data-testid="quick-action-quick-sale">
          {QUICK_ACTION_QUICK_SALE}
        </Link>
        <Link href="/console/expenses/capture" className="btn btn--outline" data-testid="quick-action-scan-bill">
          {QUICK_ACTION_SCAN_BILL}
        </Link>
      </div>
    </div>
  );
}

export function DashboardClient({
  storeId,
  timezone,
  initialSummary,
}: {
  storeId: string;
  timezone: string;
  initialSummary: DashboardSummary;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const summary = useDashboardSummary(supabase, storeId, timezone, initialSummary);
  return <DashboardView summary={summary} />;
}
