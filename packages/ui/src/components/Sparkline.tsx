import * as React from "react";

export interface SparklineProps {
  /**
   * Chronological, oldest first. `null` means that point has no known value
   * (e.g. a business_date the nightly aggregate hasn't reached yet) — it is
   * skipped when drawing the line, never coerced to 0 (RL-2's null
   * discipline applies to a trend line the same way it applies to a single
   * MoneyValue figure: a fabricated dip to zero would misrepresent that
   * day's profit as much as a fabricated ฿0 would).
   */
  values: (number | null)[];
}

// Ported from design/console-reports.js's own spark() — same viewBox, same
// stroke, same "connect the points" math — extended only to skip `null`
// points instead of assuming every day has a number.
export function Sparkline({ values }: SparklineProps) {
  const defined = values
    .map((v, i) => (v === null ? null : { v, i }))
    .filter((p): p is { v: number; i: number } => p !== null);

  if (defined.length < 2 || values.length < 2) return null;

  const w = 140;
  const h = 44;
  const vs = defined.map((p) => p.v);
  const max = Math.max(...vs);
  const min = Math.min(...vs);
  const range = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / range) * h;

  const points = defined.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

  return (
    <div className="oc-spark" data-testid="sparkline">
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} fill="none" preserveAspectRatio="none">
        <polyline
          points={points}
          stroke="var(--green-brew)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
