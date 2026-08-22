"use client";

// WBS 7.7 — 12-month grouped bar chart, revenue vs net profit. Ported layout
// from design/Console Reports.html's own scOverview() bars (.oc-bars/
// .oc-barcol/.oc-bar/.oc-legend/.sw--rev/.sw--pro CSS, added to
// packages/ui/src/components.css in this change) but drawn with recharts
// per this WBS entry's own Claude Code Prompt step 3, not the prototype's
// hand-rolled flex/height divs.
//
// 375px readability (WBS 7.7 Claude Code Prompt step 3, and CLAUDE.md's own
// "Thai typography" rule floor of 11px applies to a chart tick same as any
// other text): month labels are angled and abbreviated rather than
// shrinking below 11px, and no CartesianGrid is rendered at all — the
// prototype's own .oc-barlab used 10px, which is BELOW that floor; this
// component deliberately diverges from the prototype's exact pixel value on
// this one property (flagged for redline_reviewer).
import * as React from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthlyTrendPoint } from "./fetchOverview";
import { LEGEND_PROFIT, LEGEND_REVENUE } from "./copy";

function monthLabelThai(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, m - 1, 1));
  return new Intl.DateTimeFormat("th-TH-u-ca-buddhist", { month: "short" }).format(anchor);
}

function bahtPlain(satang: number): string {
  return "฿" + (satang / 100).toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

interface ChartRow {
  month: string;
  label: string;
  grossRevenueSatang: number;
  netProfitSatang: number | undefined;
}

function TooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ dataKey: string; value: number }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const revenue = payload.find((p) => p.dataKey === "grossRevenueSatang");
  const profit = payload.find((p) => p.dataKey === "netProfitSatang");
  return (
    <div className="card" style={{ padding: "0.8rem 1.2rem", fontSize: "var(--text-2)" }}>
      {revenue ? <div>{LEGEND_REVENUE}: {bahtPlain(revenue.value)}</div> : null}
      <div>{LEGEND_PROFIT}: {profit ? bahtPlain(profit.value) : "—"}</div>
    </div>
  );
}

export function RevenueProfitChart({ points }: { points: MonthlyTrendPoint[] }) {
  const data: ChartRow[] = points.map((p) => ({
    month: p.month,
    label: monthLabelThai(p.month),
    grossRevenueSatang: p.grossRevenueSatang,
    netProfitSatang: p.netProfitSatang ?? undefined,
  }));

  return (
    <>
      <div className="oc-bars" data-testid="overview-chart" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }} barGap={2}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11 }}
              angle={-35}
              textAnchor="end"
              height={36}
              interval={0}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip content={<TooltipContent />} />
            <Bar dataKey="grossRevenueSatang" fill="var(--green-brew)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="netProfitSatang" fill="var(--green-ledger)" fillOpacity={0.55} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="oc-legend">
        <span><i className="sw sw--rev" />{LEGEND_REVENUE}</span>
        <span><i className="sw sw--pro" />{LEGEND_PROFIT}</span>
      </div>
    </>
  );
}
