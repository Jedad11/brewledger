-- WBS 7.8 — Reporting Query Performance and Indexing.
--
-- Adds only the indexes justified by a report query that actually exists
-- today (WBS 7.1's fetchDashboardSummary.ts) or is explicitly scoped by the
-- WBS Dictionary for 7.5/7.6/7.7. Two of the WBS's own six suggested
-- indexes are deliberately NOT here:
--   - daily_financials(store_id, business_date desc) is redundant with the
--     table's own `unique (store_id, business_date)` constraint (0019) —
--     Postgres scans that btree backward natively; a second index would
--     duplicate the same bytes on a 500MB-capped disk for no plan benefit.
--   - ingredient_cost_history(ingredient_id, changed_at desc) targets a
--     table that does not exist yet (WBS 6.6, unbuilt). Add it in a
--     follow-up migration once that table lands — do not stub it here.
-- stock_ledger(store_id, ingredient_id, created_at desc) already exists
-- verbatim from 0017_stock_ledger.sql and needs no action.

-- Serves the reporting hot path: every report (7.1 dashboard live, 7.5 daily
-- P&L, 7.7 period comparison) filters orders by store_id + a time window and
-- only cares about orders that actually held money (fetchDashboardSummary.ts's
-- own REVENUE_STATUSES). Partial on status so PENDING_PAYMENT/CANCELLED/
-- REFUNDED/EXPIRED rows — dead weight for every report query — never bloat
-- this index or get scanned through it. Complements, not replaces,
-- orders_store_id_created_at_idx (0011): that one is unfiltered and still
-- serves non-report reads (order lookup, working queue); this one is smaller
-- and specific to the report shape.
create index if not exists orders_store_id_created_at_revenue_status_idx
  on orders (store_id, created_at desc)
  where status in ('ACCEPTED', 'PREPARING', 'READY', 'COLLECTED');

-- Every report that walks order_items for a set of order_ids (7.1's
-- trackedItemCount/trackedRevenueSatang/trackedCogsSatang loop; 7.6 profit
-- per dish) needs quantity + both money snapshots for each row. The old
-- order_id-only index (0012) still forces a heap fetch per row for those
-- columns; INCLUDE-ing them here makes the scan index-only, avoiding a heap
-- hit per order_item on a 25,000-row fixture. Replaces (not adds to) the old
-- index — same leading column, so keeping both would just double the bytes
-- for the identical order_id lookup.
drop index if exists order_items_order_id_idx;
create index if not exists order_items_order_id_covering_idx
  on order_items (order_id)
  include (menu_item_id, quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang);

-- Serves 7.6 profit-per-dish: aggregating order_items by menu_item_id within
-- a store without this composite falls back to order_items_store_id_idx
-- (0012) plus a filter, scanning every line the store ever sold instead of
-- seeking straight to one dish's rows. The old single-column store_id index
-- (0012) becomes a strict left-prefix subset of this one — every query it
-- served, this one serves equally well — so it's dropped in the same
-- migration, same reasoning as order_items_order_id_idx above.
drop index if exists order_items_store_id_idx;
create index if not exists order_items_store_id_menu_item_id_idx
  on order_items (store_id, menu_item_id);
