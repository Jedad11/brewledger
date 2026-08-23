// WBS 6.8 -- Automatic Stock Deduction and Stock Ledger: the negative-stock
// and low-stock DECISIONS, given an already-computed stock figure. This
// module is ONLY that.
//
// Explicitly out of scope, do not duplicate here:
//   - the actual deduction INSERT (one stock_ledger row per order_item x
//     bom_line) and the cancellation-reversal INSERT both run inside
//     transition_order(), one plpgsql function that is the payment/lifecycle
//     transaction itself (packages/db/migrations/0032_order_status_history.sql).
//     There is no `tx` handle in this codebase to pass a TypeScript function
//     (see 0032's own header comment, same reasoning packages/db/migrations/
//     0031_payment_confirmation.sql's header gives) -- SQL owns the atomic
//     write path, this package owns pure calculation/decision functions only,
//     the same split cost.ts/costPerCup.ts already establish for this
//     package. Do not write a TS function that re-executes what the SQL
//     already does atomically.
//   - deriving the stock figure itself: ingredient_stock_levels(p_store_id)
//     (packages/db/migrations/0041_ingredient_master_conversions.sql) already
//     sums stock_ledger.delta_base_unit in SQL -- "stock is derived, never a
//     stored mutable column" (WBS 6.5) holds regardless of this module.
//
// NEGATIVE-STOCK POLICY (WBS 6.8 Associated Activity: "Decide and document
// the negative-stock policy"), decided once and given a single canonical
// home here rather than an inline comparison at each call site: allow
// negative stock, warn, NEVER block a sale on it. The ledger can go negative
// because the merchant will forget to record a purchase -- a system that
// refuses to complete a paid sale because its own stock estimate says zero
// is a system that gets deleted. Framed to the merchant as "likely missing a
// purchase record", never as the merchant having done something wrong (see
// apps/console/.../inventory/IngredientListClient.tsx's NEGATIVE_NOTE, the
// exact Thai copy from docs/design/state_matrix.md -- this function only
// decides WHETHER to show it, the component owns HOW).
export function isNegativeStock(stockBaseUnit: number): boolean {
  return stockBaseUnit < 0;
}

/**
 * `lowStockThreshold` is `null` whenever a merchant has never set one for
 * this ingredient (RL-2's "never nag" posture extends here: no threshold is
 * a normal, permanent state, not a todo) -- null-safe, so a missing
 * threshold never fabricates a low-stock warning out of nothing. A negative
 * stock figure is reported through `isNegativeStock` above, not this
 * function -- the two warnings are distinct and may both be true at once,
 * but this function does not conflate them.
 */
export function isLowStock(stockBaseUnit: number, lowStockThreshold: number | null): boolean {
  if (lowStockThreshold === null) {
    return false;
  }
  return stockBaseUnit <= lowStockThreshold;
}
