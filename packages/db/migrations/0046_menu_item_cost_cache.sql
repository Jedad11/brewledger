-- WBS 6.9 -- Cost per Cup and Profit Recalculation: menu_item_cost_cache,
-- the persisted result of packages/costing/src/costPerCup.ts's
-- computeCostPerCupSatang, plus the trigger that keeps it invalidated.
--
-- THE RULE THAT MATTERS MOST (RL-2), restated at the table that stores it:
-- cost_satang and margin_satang are both plain nullable `integer` columns,
-- no `not null`, no `default 0`. A menu item with no BOM, or any BOM line
-- whose ingredient has a null current_unit_cost_satang, gets a row here with
-- cost_satang = null -- never a partial sum, never 0. The worker's
-- cost_recalc handler (worker/src/handlers/costRecalc.ts) is the only writer
-- and it goes through computeCostPerCupSatang for every write, so this
-- table can never hold a fabricated zero.
--
-- CACHE SHAPE -- one row per menu item, upserted, never deleted for a still-
-- live menu item. Primary key IS menu_item_id (a 1:1 cache), matching the
-- WBS 6.9 prompt's own column list (menu_item_id, cost_satang nullable,
-- margin_satang nullable, computed_at) plus store_id (needed for the RLS
-- policy and to scope queries, same pattern as every other merchant table
-- in this schema) and is_stale.
--
-- STALE-MARKER, NOT DELETE, per the WBS 6.9 prompt's own guidance ("Prefer a
-- stale-marker column plus recompute over deleting, so a report never sees
-- a missing row mid-recalculation"): the bom_lines trigger below only ever
-- flips is_stale to true (or inserts a fresh stale row) and never deletes.
-- A report reading this table mid-recalculation sees the LAST GOOD number
-- with is_stale = true, not a hole where a number used to be -- the same
-- "never silently present nothing as an answer" instinct RL-2 applies to
-- cost=0, applied here to "no row at all".
--
-- MARGIN SNAPSHOT DECISION: margin_satang is computed and stored AT RECALC
-- TIME against menu_items.price_satang as it stood then, not read live at
-- query time. Tradeoff, stated honestly (matching this repo's habit of
-- documenting the tradeoff inline, see 0045's costing-method comment): if a
-- merchant changes price_satang without touching bom_lines or any
-- ingredient cost, margin_satang here goes stale until the NEXT recalc for
-- that item (e.g. the next purchase confirmation touching one of its
-- ingredients, or a future BOM edit) -- there is currently no trigger on
-- menu_items.price_satang itself enqueuing a recalc, because WBS 6.9's own
-- trigger sources are purchase confirmation, BOM edit, and ingredient cost
-- edit, not price edit. This is judged acceptable because (a) cost_satang
-- itself, the number RL-2 actually protects, is never affected by a price
-- change and stays exactly correct, and (b) any consumer that wants a
-- margin computed against the CURRENT price rather than the cached snapshot
-- can trivially derive it by calling marginSatang(freshPrice, cached
-- cost_satang) itself -- cost_satang is cached, and marginSatang is a pure,
-- cheap, synchronous function, not a reason to invalidate the whole cache
-- row. A price-edit trigger can be added later without changing this
-- table's shape if that gap turns out to matter in practice.
create table if not exists menu_item_cost_cache (
  menu_item_id uuid primary key references menu_items(id) on delete cascade,
  store_id     uuid not null references stores(id) on delete cascade,
  cost_satang   integer,
  margin_satang integer,
  is_stale     boolean not null default true,
  computed_at  timestamptz,
  created_at   timestamptz not null default now()
);

comment on column menu_item_cost_cache.cost_satang is
  'Nullable (RL-2): null means "no BOM, or a BOM referencing an ingredient
   with unknown cost" -- never a partial sum, never coerced to 0.';
comment on column menu_item_cost_cache.margin_satang is
  'Snapshot of price_satang - cost_satang AS OF computed_at, not a live
   computation -- see this migration''s header comment for the tradeoff.
   Null whenever cost_satang is null.';
comment on column menu_item_cost_cache.is_stale is
  'true until the cost_recalc worker handler next writes this row. A stale
   row still carries the last good computed value -- never deleted, so a
   report never sees a missing row mid-recalculation.';

create index if not exists menu_item_cost_cache_store_id_idx on menu_item_cost_cache (store_id);
create index if not exists menu_item_cost_cache_stale_idx on menu_item_cost_cache (store_id) where is_stale;

alter table menu_item_cost_cache enable row level security;

drop policy if exists merchant_read_menu_item_cost_cache on menu_item_cost_cache;
create policy merchant_read_menu_item_cost_cache on menu_item_cost_cache
  for select to authenticated
  using (store_id in (select auth_store_ids()));
-- Deliberately no anon policy -- RL-3 caps this repo at exactly four anon
-- SELECT policies (published stores, their menu items, their option groups,
-- their open future slots); a merchant-only cost/margin cache is not a
-- fifth, and Customer Web must never see cost, margin, or profit (RL-3).
-- Deliberately no insert/update/delete policy for `authenticated` either --
-- same posture as ingredient_cost_history (0045): the only writer is the
-- worker's own service-role connection (worker/src/db.ts's `pool`), which
-- bypasses RLS as a direct Postgres connection, not through PostgREST.

-- BOM-EDIT TRIGGER SOURCE. WBS 6.7 (the BOM editor screen) does not exist
-- yet in this codebase -- there is no call site anywhere that writes
-- bom_lines. Rather than depend on a future screen's author remembering to
-- enqueue a cost_recalc job, this trigger marks/creates a stale cache row
-- and enqueues the job directly from bom_lines itself, so correctness here
-- does not depend on WBS 6.7's implementation at all -- it starts working
-- the moment something first inserts into bom_lines, whatever that turns
-- out to be.
create or replace function enqueue_menu_item_cost_recalc()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_menu_item_id uuid;
  v_store_id uuid;
begin
  v_menu_item_id := coalesce(NEW.menu_item_id, OLD.menu_item_id);
  v_store_id := coalesce(NEW.store_id, OLD.store_id);

  insert into menu_item_cost_cache (menu_item_id, store_id, is_stale)
  values (v_menu_item_id, v_store_id, true)
  on conflict (menu_item_id) do update set is_stale = true;

  insert into job_queue (store_id, job_type, payload)
  values (v_store_id, 'cost_recalc', jsonb_build_object('menuItemIds', to_jsonb(array[v_menu_item_id])));

  return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_bom_lines_cost_recalc on bom_lines;
create trigger trg_bom_lines_cost_recalc
  after insert or update or delete on bom_lines
  for each row
  execute function enqueue_menu_item_cost_recalc();

-- 0021_rls.sql's standing `alter default privileges` grants EXECUTE to
-- anon/authenticated/service_role on every function created afterwards --
-- explicitly revoked here, same trap/fix documented in 0025/0028/0029/0030/
-- 0031/0040/0044/0045. This function is only ever invoked as a trigger (by
-- its own table owner), never called directly by a client role.
revoke all on function enqueue_menu_item_cost_recalc() from public;
revoke execute on function enqueue_menu_item_cost_recalc() from anon, authenticated, service_role;
