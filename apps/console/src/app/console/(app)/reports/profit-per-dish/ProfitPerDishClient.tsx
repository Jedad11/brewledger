"use client";

// WBS 7.6 — period chips + sortable ranked table, client-side refetch on
// period change (same "server renders today, client owns navigation"
// posture as WBS 7.5's PnlClient.tsx). Sort state is intentionally NOT
// preserved across a period change: "always RETURN to profit-contribution
// sort on load" (WBS Dictionary 7.6 step 2) -- a fresh fetch is a fresh
// load, so the ranked list resets to teaching-default sort every time the
// period changes, even if the merchant had re-sorted the previous period's
// view.
import * as React from "react";
import { EmptyState, MoneyValue, UntrackedDisclosure } from "@brewledger/ui";
import { createClient } from "@/lib/supabase/client";
import { fetchProfitPerDish, type ProfitPerDishReport, type DishRow } from "./fetchProfitPerDish";
import { periodBounds, type PeriodKind } from "./period";
import {
  COL_ITEM,
  COL_UNITS,
  COL_REVENUE,
  COL_COST,
  COL_MARGIN_PER_UNIT,
  COL_TOTAL_PROFIT,
  PERIOD_TODAY,
  PERIOD_7D,
  PERIOD_30D,
  PERIOD_CUSTOM,
  CUSTOM_FROM_LABEL,
  CUSTOM_TO_LABEL,
  INSIGHT_TAG,
  insightSentence,
  EMPTY_TITLE,
  EMPTY_BODY,
} from "./copy";

const PERIOD_CHIPS: { kind: PeriodKind; label: string }[] = [
  { kind: "today", label: PERIOD_TODAY },
  { kind: "7d", label: PERIOD_7D },
  { kind: "30d", label: PERIOD_30D },
  { kind: "custom", label: PERIOD_CUSTOM },
];

type SortKey = "name" | "unitsSold" | "revenueSatang" | "costSatang" | "marginPerUnitSatang" | "totalProfitSatang";
const DEFAULT_SORT: SortKey = "totalProfitSatang";

// `rows` is always `report.tracked` in practice (untracked rows render via
// a separate, unsorted `DishTable` call below), so `costSatang` /
// `marginPerUnitSatang` / `totalProfitSatang` are never actually null here
// -- but the field TYPE is nullable (DishRow, shared with `untracked`), so
// nothing stops a future caller from sorting a mixed/untracked array. `null`
// now sorts last regardless of direction rather than being coerced to `0`,
// which would otherwise rank an untracked item as the cheapest/least-
// profitable on an ascending sort, or surface it first on a descending one
// (post-review fix round, WBS 6.9).
function sortTracked(rows: DishRow[], key: SortKey, dir: 1 | -1): DishRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (key === "name") return dir * a.name.localeCompare(b.name, "th");
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return a.name.localeCompare(b.name, "th");
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av === bv) return a.name.localeCompare(b.name, "th");
    return dir * (av - bv);
  });
  return copy;
}

// RL-2: null-safe by construction, not just by the caller's current
// invariant -- see the comment on DivergenceInsight.topProfitSatang in
// fetchProfitPerDish.ts (post-review fix round, WBS 6.9).
function formatBahtPlain(satang: number | null): string {
  if (satang === null) return "—";
  return (satang / 100).toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function DishTable({
  rows,
  untracked,
  sortKey,
  sortDir,
  onSort,
}: {
  rows: DishRow[];
  untracked: boolean;
  sortKey?: SortKey;
  sortDir?: 1 | -1;
  onSort?: (key: SortKey) => void;
}) {
  const headers: { key: SortKey; label: string; role?: "revenue" | "cost" | "profit" }[] = [
    { key: "name", label: COL_ITEM },
    { key: "unitsSold", label: COL_UNITS },
    { key: "revenueSatang", label: COL_REVENUE, role: "revenue" },
    { key: "costSatang", label: COL_COST, role: "cost" },
    { key: "marginPerUnitSatang", label: COL_MARGIN_PER_UNIT, role: "profit" },
    { key: "totalProfitSatang", label: COL_TOTAL_PROFIT, role: "profit" },
  ];

  return (
    <div className="card oc-tablewrap">
      <table className="oc-table">
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h.key}
                aria-sort={!untracked && sortKey === h.key ? (sortDir === 1 ? "ascending" : "descending") : undefined}
                onClick={!untracked && onSort ? () => onSort(h.key) : undefined}
                style={!untracked ? { cursor: "pointer" } : undefined}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} data-testid={untracked ? "dish-row-untracked" : "dish-row"}>
              <td>{row.name}</td>
              <td className="num">{row.unitsSold}</td>
              <td className="num">
                <MoneyValue value={row.revenueSatang} role="revenue" />
              </td>
              <td className="num">
                <MoneyValue value={row.costSatang} role="cost" />
              </td>
              <td className="num">
                <MoneyValue value={row.marginPerUnitSatang} role="profit" />
              </td>
              <td className="num">
                <b>
                  <MoneyValue value={row.totalProfitSatang} role="profit" />
                </b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProfitPerDishView({ report }: { report: ProfitPerDishReport }) {
  const [sort, setSort] = React.useState<{ key: SortKey; dir: 1 | -1 }>({ key: DEFAULT_SORT, dir: -1 });

  // Fresh data (new period) always resets to the teaching-default sort.
  React.useEffect(() => {
    setSort({ key: DEFAULT_SORT, dir: -1 });
  }, [report]);

  const onSort = React.useCallback((key: SortKey) => {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === -1 ? 1 : -1 } : { key, dir: key === "name" ? 1 : -1 }));
  }, []);

  const sortedTracked = React.useMemo(
    () => sortTracked(report.tracked, sort.key, sort.dir),
    [report.tracked, sort.key, sort.dir],
  );

  if (report.tracked.length === 0 && report.untracked.length === 0) {
    return <EmptyState title={EMPTY_TITLE} body={EMPTY_BODY} />;
  }

  return (
    <>
      {report.insight ? (
        <div className="oc-insight" data-testid="dish-insight">
          <span className="oc-brieftag">{INSIGHT_TAG}</span>
          <p>
            {insightSentence(
              report.insight.bestSellerName,
              report.insight.bestSellerUnits,
              report.insight.topProfitName,
              formatBahtPlain(report.insight.topProfitSatang),
            )}
          </p>
        </div>
      ) : null}

      {report.tracked.length > 0 ? (
        <DishTable rows={sortedTracked} untracked={false} sortKey={sort.key} sortDir={sort.dir} onSort={onSort} />
      ) : null}

      {report.untracked.length > 0 ? (
        <div className="oc-group">
          <UntrackedDisclosure trackedCount={0} totalCount={report.untracked.length} variant="dish" />
          <DishTable rows={report.untracked} untracked />
        </div>
      ) : null}
    </>
  );
}

export function ProfitPerDishClient({
  storeId,
  timezone,
  initialReport,
}: {
  storeId: string;
  timezone: string;
  initialReport: ProfitPerDishReport;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const [period, setPeriod] = React.useState<PeriodKind>("today");
  const [customFrom, setCustomFrom] = React.useState("");
  const [customTo, setCustomTo] = React.useState("");
  const [report, setReport] = React.useState(initialReport);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(
    async (kind: PeriodKind, from?: string, to?: string) => {
      if (kind === "custom" && (!from || !to)) return; // wait for both fields
      setLoading(true);
      try {
        const bounds = periodBounds(
          timezone,
          kind,
          kind === "custom" ? { fromBusinessDate: from!, toBusinessDate: to! } : undefined,
        );
        const next = await fetchProfitPerDish(supabase, storeId, bounds.startUtc, bounds.endUtc);
        setReport(next);
      } finally {
        setLoading(false);
      }
    },
    [supabase, storeId, timezone],
  );

  const selectPeriod = (kind: PeriodKind) => {
    setPeriod(kind);
    if (kind !== "custom") void load(kind);
  };

  return (
    <div className="oc-body" data-testid="profit-per-dish-report">
      <div className="oc-periods">
        {PERIOD_CHIPS.map((chip) => (
          <button
            key={chip.kind}
            type="button"
            className={`oc-chip${period === chip.kind ? " is-on" : ""}`}
            onClick={() => selectPeriod(chip.kind)}
            disabled={loading}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {period === "custom" ? (
        <div className="card oc-form">
          <div className="field">
            <label>{CUSTOM_FROM_LABEL}</label>
            <input
              className="input"
              type="date"
              value={customFrom}
              onChange={(e) => {
                setCustomFrom(e.target.value);
                void load("custom", e.target.value, customTo);
              }}
            />
          </div>
          <div className="field">
            <label>{CUSTOM_TO_LABEL}</label>
            <input
              className="input"
              type="date"
              value={customTo}
              onChange={(e) => {
                setCustomTo(e.target.value);
                void load("custom", customFrom, e.target.value);
              }}
            />
          </div>
        </div>
      ) : null}

      <ProfitPerDishView report={report} />
    </div>
  );
}
