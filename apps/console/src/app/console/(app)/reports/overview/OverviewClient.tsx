"use client";

// WBS 7.7 — mode selector (เดือนนี้/เดือนที่แล้ว default, ปีนี้/ปีที่แล้ว,
// กำหนดเอง) + metric comparison cards + 12-month chart. Client-side refetch
// on mode/custom-range change, same "server renders the default, client
// owns navigation" posture as WBS 7.5's PnlClient and WBS 7.6's
// ProfitPerDishClient.
import * as React from "react";
import { MoneyValue } from "@brewledger/ui";
import type { MoneyRole } from "@brewledger/ui";
import { createClient } from "@/lib/supabase/client";
import { fetchOverviewComparison, type OverviewComparison, type MonthlyTrendPoint } from "./fetchOverview";
import { comparisonRanges, type ComparisonMode, type DateRange, type ComparisonRanges } from "./periods";
import { RevenueProfitChart } from "./RevenueProfitChart";
import {
  REVENUE_LABEL,
  COGS_LABEL,
  OTHER_EXPENSE_LABEL,
  NET_PROFIT_LABEL,
  ORDER_COUNT_LABEL,
  MODE_MONTH_LABEL,
  MODE_YEAR_LABEL,
  MODE_CUSTOM_LABEL,
  CUSTOM_CURRENT_FROM_LABEL,
  CUSTOM_CURRENT_TO_LABEL,
  CUSTOM_PREVIOUS_FROM_LABEL,
  CUSTOM_PREVIOUS_TO_LABEL,
  INCOMPLETE_MONTH_NOTE,
  INCOMPLETE_YEAR_NOTE,
  ZERO_BASELINE_NOTE,
  rangeHeading,
  previousValueNote,
  CHART_TITLE,
} from "./copy";

const MODE_CHIPS: { kind: ComparisonMode; label: string }[] = [
  { kind: "month", label: MODE_MONTH_LABEL },
  { kind: "year", label: MODE_YEAR_LABEL },
  { kind: "custom", label: MODE_CUSTOM_LABEL },
];

function monthAbbrevThai(businessDate: string): string {
  const [y, m] = businessDate.split("-").map(Number);
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { month: "short" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

function dayOf(businessDate: string): number {
  return Number(businessDate.slice(8, 10));
}

// "1–16 ส.ค." for a single-month range, "16 ก.ค.–3 ส.ค." when it spans two
// months (only reachable via the custom picker — month/year mode ranges
// never cross a month boundary within themselves).
function formatRangeLabel(range: DateRange): string {
  const fromMonth = range.fromBusinessDate.slice(0, 7);
  const toMonth = range.toBusinessDate.slice(0, 7);
  if (fromMonth === toMonth) {
    return `${dayOf(range.fromBusinessDate)}–${dayOf(range.toBusinessDate)} ${monthAbbrevThai(range.toBusinessDate)}`;
  }
  return `${dayOf(range.fromBusinessDate)} ${monthAbbrevThai(range.fromBusinessDate)}–${dayOf(range.toBusinessDate)} ${monthAbbrevThai(range.toBusinessDate)}`;
}

function bahtAbsFromSatang(satang: number): string {
  return "฿" + Math.abs(satang / 100).toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function countAbs(n: number): string {
  return Math.abs(n).toLocaleString("th-TH");
}

interface Delta {
  deltaValue: number | null;
  percent: number | null;
  zeroBaseline: boolean;
  direction: "up" | "down" | null;
}

function computeDelta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) {
    return { deltaValue: null, percent: null, zeroBaseline: false, direction: null };
  }
  const deltaValue = current - previous;
  if (previous === 0) {
    return { deltaValue, percent: null, zeroBaseline: true, direction: deltaValue > 0 ? "up" : deltaValue < 0 ? "down" : null };
  }
  const percent = (deltaValue / previous) * 100;
  return { deltaValue, percent, zeroBaseline: false, direction: percent >= 0 ? "up" : "down" };
}

function MetricCard({
  label,
  kind,
  role,
  current,
  previous,
}: {
  label: string;
  kind: "money" | "count";
  role?: MoneyRole;
  current: number | null;
  previous: number | null;
}) {
  const delta = computeDelta(current, previous);
  const deltaClass = delta.percent === null ? "is-unknown" : delta.direction === "up" ? "is-up" : "is-down";
  const formatAbs = kind === "money" ? bahtAbsFromSatang : countAbs;

  return (
    <div className="card oc-cmp" data-testid="overview-metric">
      <p className="note-plain">{label}</p>
      <div className="oc-big">
        {kind === "money" ? (
          <MoneyValue value={current} role={role ?? "plain"} />
        ) : (
          <span className="money" data-testid="money-value">{current === null ? "—" : current.toLocaleString("th-TH")}</span>
        )}
      </div>
      <div className={`oc-delta ${deltaClass}`}>
        {delta.percent === null
          ? "—"
          : `${delta.direction === "up" ? "▲" : "▼"} ${formatAbs(delta.deltaValue!)} · ${Math.abs(delta.percent).toFixed(1)}%`}
      </div>
      <p className="note-plain">
        {delta.zeroBaseline
          ? ZERO_BASELINE_NOTE
          : previous !== null
            ? previousValueNote(formatAbs(previous))
            : ""}
      </p>
    </div>
  );
}

export function OverviewView({ comparison }: { comparison: OverviewComparison }) {
  const { ranges, current, previous } = comparison;
  const incompleteNote = ranges.mode === "year" ? INCOMPLETE_YEAR_NOTE : INCOMPLETE_MONTH_NOTE;

  return (
    <>
      <div className="card oc-cmphead" data-testid="overview-range-head">
        <b>{rangeHeading(formatRangeLabel(ranges.current), formatRangeLabel(ranges.previous))}</b>
        {ranges.incomplete ? <p className="note-plain">{incompleteNote}</p> : null}
      </div>
      <div className="oc-cmpgrid">
        <MetricCard label={REVENUE_LABEL} kind="money" role="revenue" current={current.grossRevenueSatang} previous={previous.grossRevenueSatang} />
        <MetricCard label={COGS_LABEL} kind="money" role="cost" current={current.totalCogsSatang} previous={previous.totalCogsSatang} />
        <MetricCard label={OTHER_EXPENSE_LABEL} kind="money" role="cost" current={current.otherExpenseSatang} previous={previous.otherExpenseSatang} />
        <MetricCard label={NET_PROFIT_LABEL} kind="money" role="profit" current={current.netProfitSatang} previous={previous.netProfitSatang} />
        <MetricCard label={ORDER_COUNT_LABEL} kind="count" current={current.orderCount} previous={previous.orderCount} />
      </div>
    </>
  );
}

export function OverviewClient({
  storeId,
  timezone,
  initialComparison,
  initialTrend,
}: {
  storeId: string;
  timezone: string;
  initialComparison: OverviewComparison;
  initialTrend: MonthlyTrendPoint[];
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [mode, setMode] = React.useState<ComparisonMode>("month");
  const [comparison, setComparison] = React.useState(initialComparison);
  const [trend] = React.useState(initialTrend);
  const [loading, setLoading] = React.useState(false);

  const [customCurrentFrom, setCustomCurrentFrom] = React.useState("");
  const [customCurrentTo, setCustomCurrentTo] = React.useState("");
  const [customPreviousFrom, setCustomPreviousFrom] = React.useState("");
  const [customPreviousTo, setCustomPreviousTo] = React.useState("");

  const load = React.useCallback(
    async (ranges: ComparisonRanges) => {
      setLoading(true);
      try {
        const next = await fetchOverviewComparison(supabase, storeId, ranges);
        setComparison(next);
      } finally {
        setLoading(false);
      }
    },
    [supabase, storeId],
  );

  const selectMode = (kind: ComparisonMode) => {
    setMode(kind);
    if (kind !== "custom") void load(comparisonRanges(kind, timezone));
  };

  const loadCustom = React.useCallback(
    (currentFrom: string, currentTo: string, previousFrom: string, previousTo: string) => {
      if (!currentFrom || !currentTo || !previousFrom || !previousTo) return;
      void load(
        comparisonRanges("custom", timezone, {
          current: { fromBusinessDate: currentFrom, toBusinessDate: currentTo },
          previous: { fromBusinessDate: previousFrom, toBusinessDate: previousTo },
        }),
      );
    },
    [load, timezone],
  );

  return (
    <div className="oc-body" data-testid="overview-report">
      <div className="oc-periods">
        {MODE_CHIPS.map((chip) => (
          <button
            key={chip.kind}
            type="button"
            className={`oc-chip${mode === chip.kind ? " is-on" : ""}`}
            onClick={() => selectMode(chip.kind)}
            disabled={loading}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {mode === "custom" ? (
        <div className="card oc-form">
          <div className="field">
            <label>{CUSTOM_CURRENT_FROM_LABEL}</label>
            <input
              className="input"
              type="date"
              value={customCurrentFrom}
              onChange={(e) => {
                setCustomCurrentFrom(e.target.value);
                loadCustom(e.target.value, customCurrentTo, customPreviousFrom, customPreviousTo);
              }}
            />
          </div>
          <div className="field">
            <label>{CUSTOM_CURRENT_TO_LABEL}</label>
            <input
              className="input"
              type="date"
              value={customCurrentTo}
              onChange={(e) => {
                setCustomCurrentTo(e.target.value);
                loadCustom(customCurrentFrom, e.target.value, customPreviousFrom, customPreviousTo);
              }}
            />
          </div>
          <div className="field">
            <label>{CUSTOM_PREVIOUS_FROM_LABEL}</label>
            <input
              className="input"
              type="date"
              value={customPreviousFrom}
              onChange={(e) => {
                setCustomPreviousFrom(e.target.value);
                loadCustom(customCurrentFrom, customCurrentTo, e.target.value, customPreviousTo);
              }}
            />
          </div>
          <div className="field">
            <label>{CUSTOM_PREVIOUS_TO_LABEL}</label>
            <input
              className="input"
              type="date"
              value={customPreviousTo}
              onChange={(e) => {
                setCustomPreviousTo(e.target.value);
                loadCustom(customCurrentFrom, customCurrentTo, customPreviousFrom, e.target.value);
              }}
            />
          </div>
        </div>
      ) : null}

      <OverviewView comparison={comparison} />

      <div className="card">
        <h3>{CHART_TITLE}</h3>
        <RevenueProfitChart points={trend} />
      </div>
    </div>
  );
}
