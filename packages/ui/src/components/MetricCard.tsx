import * as React from "react";
import { MoneyValue } from "./MoneyValue";
import type { MoneyRole } from "../types";

export interface MetricCardProps {
  label: string;
  /** Same null discipline as MoneyValue.value — never coerced to 0. */
  value: number | null;
  role: MoneyRole;
  /** Plain grey note beneath the figure — e.g. the dashboard's "no cost data" line. */
  note?: string;
}

// Composes MoneyValue rather than reimplementing null -> "—" — exactly one
// place in the package decides how an unknown figure renders.
export function MetricCard({ label, value, role, note }: MetricCardProps) {
  return (
    <div className="card bl-metric-card" data-testid="metric-card">
      <p className="note-plain">{label}</p>
      <div className="oc-big">
        {/* Cross-cutting fix (2026-08): prototype's own B() helper
         * (console-reports.js) formats headline money with
         * maximumFractionDigits defaulting to 0 -- "฿3,240", never
         * "฿3,240.00". decimals={0} here, not a change to MoneyValue's own
         * default (still 2), which stays a separate open question flagged
         * for redline_reviewer. */}
        <MoneyValue value={value} role={role} decimals={0} />
      </div>
      {note ? <p className="note-plain">{note}</p> : null}
    </div>
  );
}
