-- WBS 6.5 -- Ingredient Master and Unit Conversion.
--
-- Three additive changes to the WBS 3.5 `ingredients`/`stock_ledger` schema.
-- These are within THIS entry's own scope (deliverables of 6.5 itself, not a
-- WBS 3.5 gap being patched): the `ingredients`/`bom_lines`/`stock_ledger`/
-- `purchase_line_items` tables this migration builds on already exist from
-- 0008/0009/0016/0017.
--
-- 1. `ingredients.pack_size` -- nullable, meaningful only for a purchase unit
--    of 'pack'. packages/costing/src/units.ts's toBaseUnit/costPerBaseUnit
--    take packSize as an explicit caller argument for a 'pack' conversion;
--    this column is where the Create/Edit screen persists it per ingredient
--    (WBS 6.5 prompt point 3: "optional pack size for pack-based items") so
--    it doesn't have to be re-entered on every purchase line.
-- 2. `ingredients.archived_at` -- soft-hide ("ซ่อน", WBS 6.5 prompt point 5).
--    NULL = active, the default for every existing and new row. Set instead
--    of a hard DELETE when the ingredient is referenced by bom_lines or
--    stock_ledger and deleting it would destroy costing/audit history.
-- 3. `stock_ledger.ingredient_id`'s FK tightened from ON DELETE CASCADE to
--    ON DELETE RESTRICT. WBS 6.5's own acceptance criterion is "deletion is
--    blocked ... referenced by bom_lines or by any ledger row" -- CASCADE
--    would let a DELETE silently erase the audit trail the append-only
--    ledger exists to protect (0017_stock_ledger.sql's own header comment:
--    "a stock number a merchant disputes must be traceable to the exact
--    movements that produced it"). Mirrors bom_lines.ingredient_id's
--    existing ON DELETE RESTRICT (0009), added for the identical reason.
--
-- Plus two supporting functions:
-- 4. `ingredient_stock_levels(p_store_id)` -- the "stock is DERIVED, never a
--    mutable column" rule (WBS 6.5 prompt point 4: "select coalesce(sum(
--    delta_base_unit),0) from stock_ledger where ingredient_id = $1. Never
--    read a mutable stock column as truth."). Plain SQL function, no
--    `security definer` (unlike auth_store_ids) -- RLS on `ingredients`/
--    `stock_ledger` applies to the calling role exactly as it would for a
--    bare `select`, so this is scoped to the caller's own store the same way
--    every other Owner Console query already is. One round trip for the
--    whole ingredient list instead of the WBS prompt's literal per-
--    ingredient query. Also derives `days_of_cover` from the ledger's own
--    'sale'-reason rows (a 30-day trailing burn rate) -- this is real, not
--    a placeholder, but it will genuinely return NULL for most ingredients
--    until WBS 6.8 (automatic stock deduction) starts writing 'sale' rows;
--    that NULL is the correct "not enough data yet" answer, not a bug, and
--    the console UI (WBS 6.5's own inventory screen) already renders NULL
--    days-of-cover as an absent line, matching design/console-reports.js's
--    own `i.days!=null?...: ''` fallback.
-- 5. `prevent_base_unit_change_if_referenced()` -- BEFORE UPDATE trigger on
--    `ingredients`, same shape as 0001_functions.sql's
--    prevent_cost_snapshot_update: once any purchase_line_item or
--    stock_ledger row references an ingredient, its base_unit is frozen
--    (WBS 6.5 prompt point 3: "Base unit is IMMUTABLE once any
--    purchase_line_item or stock_ledger row references the ingredient --
--    changing it would silently rewrite the meaning of all historical
--    numbers"). The Owner Console additionally disables the field in the UI
--    with a Thai explanation; this trigger is the backstop that makes the
--    rule true even if some other future write path forgets that check.

alter table ingredients
  add column if not exists pack_size numeric(12,3) check (pack_size is null or pack_size > 0),
  add column if not exists archived_at timestamptz;

comment on column ingredients.pack_size is
  'Pieces per pack, for a purchase unit of "pack" only (see
   packages/costing/src/units.ts toBaseUnit/costPerBaseUnit). NULL for every
   ingredient never purchased by the pack.';

comment on column ingredients.archived_at is
  'Soft-hide ("ซ่อน"). NULL = active. Set instead of a hard DELETE when the
   ingredient is referenced by bom_lines or stock_ledger and cannot be
   deleted without destroying costing/audit history (WBS 6.5).';

alter table stock_ledger
  drop constraint if exists stock_ledger_ingredient_id_fkey,
  add constraint stock_ledger_ingredient_id_fkey
    foreign key (ingredient_id) references ingredients(id) on delete restrict;

create or replace function ingredient_stock_levels(p_store_id uuid)
returns table (
  ingredient_id uuid,
  stock_base_unit numeric,
  last_purchase_at timestamptz,
  days_of_cover numeric
)
language sql
stable
set search_path = public
as $$
  with agg as (
    select
      i.id as ingredient_id,
      coalesce(sum(sl.delta_base_unit), 0) as stock_base_unit,
      max(sl.created_at) filter (where sl.reason = 'purchase') as last_purchase_at,
      coalesce(sum(-sl.delta_base_unit) filter (
        where sl.reason = 'sale' and sl.created_at > now() - interval '30 days'
      ), 0) as sold_last_30d
    from ingredients i
    left join stock_ledger sl on sl.ingredient_id = i.id
    where i.store_id = p_store_id
    group by i.id
  )
  select
    ingredient_id,
    stock_base_unit,
    last_purchase_at,
    case
      when stock_base_unit > 0 and sold_last_30d > 0
        then round(stock_base_unit / (sold_last_30d / 30.0), 1)
      else null
    end as days_of_cover
  from agg;
$$;

create or replace function prevent_base_unit_change_if_referenced()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.base_unit is distinct from old.base_unit then
    if exists (select 1 from purchase_line_items where ingredient_id = old.id)
       or exists (select 1 from stock_ledger where ingredient_id = old.id) then
      raise exception
        'ingredients.base_unit is immutable once a purchase_line_item or stock_ledger row references it (WBS 6.5) -- changing it would silently rewrite the meaning of every historical cost calculation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_ingredients_prevent_base_unit_change on ingredients;
create trigger trg_ingredients_prevent_base_unit_change
  before update on ingredients
  for each row
  execute function prevent_base_unit_change_if_referenced();
