"use client";

// WBS 7.5 — date navigation (prev/next), which needs a client-side refetch
// (fetchPnlDay.ts's own two read paths run identically from the browser
// Supabase client, RLS-scoped the same way as every other console read).
// Server-rendered once by page.tsx for today's figures (no client fetch
// blocks first paint), then this component owns navigation state.
import * as React from "react";
import { MoneyValue, Sparkline, UntrackedDisclosure } from "@brewledger/ui";
import { createClient } from "@/lib/supabase/client";
import { fetchPnlDay, fetchPnlTrend, type PnlDay, type PnlTrendPoint } from "./fetchPnlDay";
import {
  REVENUE_LABEL,
  COGS_LABEL,
  OTHER_EXPENSE_LABEL,
  NET_PROFIT_LABEL,
  TREND_TITLE,
  PREV_DAY_LABEL,
  NEXT_DAY_LABEL,
} from "./copy";

function shiftBusinessDate(businessDate: string, deltaDays: number): string {
  const d = new Date(`${businessDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// Not a state_matrix.md string — business_date is an algorithmically
// generated calendar label, not enumerated Thai UI copy. Buddhist-era year
// (พ.ศ.) via the th-TH-u-ca-buddhist calendar extension, matching every
// other Thai-facing date in /design/.
function formatBusinessDateThai(businessDate: string, timezone: string): string {
  const anchor = new Date(`${businessDate}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("th-TH-u-ca-buddhist", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(anchor);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`;
}

export function PnlView({ day }: { day: PnlDay }) {
  const hasUntracked = day.totalItemCount - day.trackedItemCount > 0;

  return (
    <div className="card oc-pnl" data-testid="pnl-figures">
      <div className="oc-pnlrow">
        <span>{REVENUE_LABEL}</span>
        <MoneyValue value={day.grossRevenueSatang} role="revenue" />
      </div>
      <div className="oc-pnlrow">
        <span>{COGS_LABEL}</span>
        <MoneyValue value={day.totalCogsSatang} role="cost" />
      </div>
      <div className="oc-pnlrow">
        <span>{OTHER_EXPENSE_LABEL}</span>
        <MoneyValue value={day.otherExpenseSatang} role="cost" />
      </div>
      <div className="oc-pnlrow is-net">
        <span>{NET_PROFIT_LABEL}</span>
        <span className="oc-big">
          <MoneyValue value={day.netProfitSatang} role="profit" />
        </span>
      </div>
      {hasUntracked ? (
        <UntrackedDisclosure
          trackedCount={day.trackedItemCount}
          totalCount={day.totalItemCount}
          untrackedRevenue={day.untrackedRevenueSatang}
          variant="pnl"
        />
      ) : null}
    </div>
  );
}

export function PnlClient({
  storeId,
  timezone,
  todayBusinessDate,
  initialDay,
  initialTrend,
}: {
  storeId: string;
  timezone: string;
  todayBusinessDate: string;
  initialDay: PnlDay;
  initialTrend: PnlTrendPoint[];
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [day, setDay] = React.useState(initialDay);
  const [trend, setTrend] = React.useState(initialTrend);
  const [loading, setLoading] = React.useState(false);

  const navigate = React.useCallback(
    async (deltaDays: number) => {
      const nextDate = shiftBusinessDate(day.businessDate, deltaDays);
      if (nextDate > todayBusinessDate) return; // no future days
      setLoading(true);
      try {
        const nextDay = await fetchPnlDay(supabase, storeId, timezone, nextDate);
        const nextTrend = await fetchPnlTrend(supabase, storeId, nextDay);
        setDay(nextDay);
        setTrend(nextTrend);
      } finally {
        setLoading(false);
      }
    },
    [day.businessDate, supabase, storeId, timezone, todayBusinessDate],
  );

  const isToday = day.businessDate === todayBusinessDate;

  return (
    <div className="oc-body" data-testid="pnl-report">
      <div className="oc-datesel">
        <button
          type="button"
          className="oc-arrow"
          aria-label={PREV_DAY_LABEL}
          onClick={() => void navigate(-1)}
          disabled={loading}
        >
          ‹
        </button>
        <b>{formatBusinessDateThai(day.businessDate, timezone)}</b>
        <button
          type="button"
          className="oc-arrow"
          aria-label={NEXT_DAY_LABEL}
          onClick={() => void navigate(1)}
          disabled={loading || isToday}
        >
          ›
        </button>
      </div>

      <PnlView day={day} />

      <div className="card">
        <h3>{TREND_TITLE}</h3>
        <Sparkline values={trend.map((t) => t.netProfitSatang)} />
      </div>
    </div>
  );
}
