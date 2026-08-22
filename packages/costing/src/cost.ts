// WBS 6.6 -- Unit Cost Update Engine: drift baseline computation feeding
// WBS 7.4. This module is ONLY that -- turning a caller-supplied slice of
// ingredient_cost_history rows into a baseline cost and a drift ratio.
//
// Explicitly out of scope, do not duplicate here:
//   - purchase-unit <-> base-unit arithmetic (kg/g, L/ml, pack/piece) lives
//     in packages/costing/src/units.ts and is not this module's concern.
//   - the actual cost UPDATE and the history-row INSERT happen inside the
//     confirmation transaction in SQL
//     (packages/db/migrations/0044_console_confirm_purchase_invoice.sql,
//     0045_ingredient_cost_history.sql) -- this module never writes
//     anything, it only computes over rows the caller already read.
//
// Costing method rationale (latest purchase price, not weighted average,
// not FIFO) and its trade-off are documented in full in docs/db/schema.md's
// "Costing method" section -- not repeated here.

export interface IngredientCostHistoryRow {
  newCostSatang: number;
  changedAt: string;
}

/**
 * Median of `newCostSatang` across the rows given. The caller is
 * responsible for having already filtered to the relevant window (e.g. the
 * trailing 90 days) and for excluding the row the current cost itself came
 * from -- this function has no notion of "now" or "current" and does not
 * look at `changedAt` beyond what the caller already selected.
 *
 * Returns `null` when `rows` is empty. A baseline of `0` would silently
 * imply "this ingredient used to be free," fabricating a drift ratio out of
 * nothing -- `null` is the honest answer to "no purchase history in this
 * window."
 */
export function trailingMedianCost(rows: IngredientCostHistoryRow[]): number | null {
  if (rows.length === 0) {
    return null;
  }
  const sorted = rows.map((row) => row.newCostSatang).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Fractional drift of `currentCostSatang` away from `baselineCostSatang`,
 * e.g. `0.5` for a 50% increase. Returns `null` when `baselineCostSatang`
 * is `null` (no history to compare against, see `trailingMedianCost`) or
 * `0` (a baseline of zero makes every ratio either undefined or infinite --
 * never a real drift figure to alert on).
 */
export function driftRatio(
  currentCostSatang: number,
  baselineCostSatang: number | null,
): number | null {
  if (baselineCostSatang === null || baselineCostSatang === 0) {
    return null;
  }
  return (currentCostSatang - baselineCostSatang) / baselineCostSatang;
}
