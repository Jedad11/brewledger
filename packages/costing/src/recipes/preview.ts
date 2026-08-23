// WBS 6.7 -- live cost preview for the recipe editor. Deliberately NOT
// WBS 6.9's cost-per-cup engine: no rounding-to-selling-price logic, no
// margin, no persistence. This is the one sum this entry's own spec asks
// for -- "the cost preview updates live and shows `—` while any referenced
// ingredient has no cost" -- kept here rather than inside the console screen
// so it's the same pure, testable shape as trailingMedianCost/driftRatio in
// ./cost.ts, not screen-local arithmetic.
export interface RecipePreviewLine {
  qtyBaseUnit: number;
  /** null = this ingredient has no confirmed purchase yet (RL-2: never 0). */
  unitCostSatang: number | null;
}

/**
 * Sum of qty * unit cost across every line, in satang. Returns null --
 * never 0 -- when there are no complete lines yet, or when ANY line's
 * ingredient has an unknown cost: a partial sum would silently understate
 * the real cost, which is the exact wrong-number failure RL-2 exists to
 * prevent.
 */
export function previewRecipeCostSatang(lines: RecipePreviewLine[]): number | null {
  if (lines.length === 0) return null;

  let total = 0;
  for (const line of lines) {
    if (line.unitCostSatang === null) return null;
    total += line.qtyBaseUnit * line.unitCostSatang;
  }
  return Math.round(total);
}
