// WBS 6.9 -- Cost per Cup and Profit Recalculation.
//
// THE RULE THAT MATTERS MOST (RL-2): unknown cost is NULL, never 0. An item
// with zero BOM rows, or any BOM row whose ingredient has a null
// current_unit_cost_satang, resolves to NULL -- never a partial sum, never
// 0. A 0 here silently implies a 100% margin, the single most damaging
// wrong number this product could display. Every signature in this file
// returns `number | null`, never defaults a missing cost to 0, and never
// coalesces with `?? 0` / `|| 0` anywhere below.
//
// ARCHITECTURE NOTE -- deviation from the WBS 6.9 prompt's literal signature:
// the prompt asks for `costPerCup(menuItemId): Promise<number | null>` with
// an inline `select bl.qty_base_unit, i.current_unit_cost_satang from
// bom_lines ... where bl.menu_item_id = $1` comment. That async/DB-querying
// shape does not match this package's own established pattern (see cost.ts
// and units.ts's header comments) -- @brewledger/costing is a PURE package
// with zero DB dependency (no `pg`, no `supabase-js` in its package.json),
// so every existing module takes already-fetched rows as plain arguments and
// returns a computed value; it never queries anything itself. This file
// follows that same pattern: `computeCostPerCupSatang` is a synchronous pure
// function over caller-supplied rows. The actual `bom_lines` JOIN
// `ingredients` query lives in worker/src/handlers/costRecalc.ts, the one
// place that actually talks to Postgres for this WBS entry.

export interface BomCostRow {
  qtyBaseUnit: number;
  ingredientUnitCostSatang: number | null;
}

/**
 * Sum of `qtyBaseUnit * ingredientUnitCostSatang` across every BOM line for
 * one menu item, in integer satang.
 *
 * - Zero rows (no BOM at all -- RL-2, the recipe block never nags and never
 *   forces a recipe to exist) -> `null`.
 * - ANY row whose `ingredientUnitCostSatang` is `null` (an ingredient that
 *   has never had a purchase confirmed against it) -> `null` for the WHOLE
 *   item, never a partial sum over just the tracked lines. A partial number
 *   here is worse than no number: it looks complete and is not, understating
 *   the true cost by whatever the untracked ingredient would have added.
 * - Otherwise -> the exact integer satang sum, rounded to the nearest
 *   satang (qtyBaseUnit is `numeric(14,4)` in bom_lines, so the raw product
 *   can be fractional; `current_unit_cost_satang` itself is always already
 *   an integer).
 */
export function computeCostPerCupSatang(rows: BomCostRow[]): number | null {
  if (rows.length === 0) {
    return null;
  }
  let totalSatang = 0;
  for (const row of rows) {
    if (row.ingredientUnitCostSatang === null) {
      return null;
    }
    totalSatang += row.qtyBaseUnit * row.ingredientUnitCostSatang;
  }
  return Math.round(totalSatang);
}

/**
 * price - cost, in satang. `null` whenever `cost` is `null` -- an unknown
 * cost cannot yield a known margin, and the caller must never substitute 0
 * for the missing cost to force a number out of this function.
 */
export function marginSatang(priceSatang: number, costSatang: number | null): number | null {
  if (costSatang === null) {
    return null;
  }
  return priceSatang - costSatang;
}

/**
 * Margin as a fraction of price (e.g. `0.65` for a 65% margin). `null`
 * whenever `cost` is `null`, and also `null` when `price` is `0` -- a
 * division by zero price has no meaningful percentage, and returning `0` or
 * `Infinity` there would be exactly the kind of fabricated number RL-2
 * exists to prevent. Never returns `1` (100%) for an unknown-cost item; an
 * unknown cost cannot honestly claim a 100% margin any more than it can
 * claim any other specific number.
 */
export function marginPercent(priceSatang: number, costSatang: number | null): number | null {
  if (costSatang === null || priceSatang === 0) {
    return null;
  }
  return (priceSatang - costSatang) / priceSatang;
}
