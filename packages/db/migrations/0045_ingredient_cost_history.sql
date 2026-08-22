-- WBS 6.6 -- Unit Cost Update Engine: the append-only audit trail that WBS
-- 7.4's drift baseline reads, plus a CREATE OR REPLACE of 0044's
-- console_confirm_purchase_invoice to (a) write a history row whenever a
-- confirm actually moves current_unit_cost_satang, and (b) enqueue a
-- cost_drift_check job alongside the existing cost_recalc job. No other
-- logic in that function changes -- see the inline diff markers below.
--
-- COSTING METHOD, restated here because this is the table a future
-- contributor will open first when asked "why did this cost change": Brew
-- Ledger uses LATEST PURCHASE PRICE, not weighted average, not FIFO.
-- Rationale: the merchant's real question is "what does this ingredient
-- cost me TODAY", which drives today's pricing decision -- not "what did my
-- inventory cost on average", the accountant's question. Trade-off, stated
-- honestly: one unusually expensive emergency purchase (a convenience-store
-- top-up at 3x the supplier price after a delivery failure) moves
-- current_unit_cost_satang until the next normal purchase corrects it. This
-- table is what lets that be seen and judged after the fact instead of
-- silently smoothed away -- full rationale in docs/db/schema.md's "Costing
-- method" section, not duplicated further here.

create table if not exists ingredient_cost_history (
  id                uuid primary key default gen_random_uuid(),
  ingredient_id     uuid not null references ingredients(id) on delete cascade,
  store_id          uuid not null references stores(id) on delete cascade,
  old_cost_satang   integer,
  new_cost_satang   integer not null,
  source_invoice_id uuid references purchase_invoices(id) on delete set null,
  changed_at        timestamptz not null default now()
);

create index if not exists ingredient_cost_history_store_id_ingredient_id_changed_at_idx
  on ingredient_cost_history (store_id, ingredient_id, changed_at desc);

alter table ingredient_cost_history enable row level security;

drop policy if exists merchant_read_ingredient_cost_history on ingredient_cost_history;
create policy merchant_read_ingredient_cost_history on ingredient_cost_history
  for select to authenticated
  using (store_id in (select auth_store_ids()));
-- Deliberately no anon policy (RL-3 -- this repo carries exactly four anon
-- SELECT policies: published stores, their menu items, their option groups,
-- their open future slots, and a per-ingredient cost audit trail is not a
-- fifth). Deliberately no insert/update/delete policy for `authenticated`
-- either, same posture as order_status_history (0032): the only writer is
-- console_confirm_purchase_invoice below, security definer, owned by the
-- migration role -- RLS does not apply to the table owner, so no policy is
-- needed to let it write, and none should exist to let anyone else.

-- Same append-only-vs-cascade problem this repo already hit and fixed twice
-- for order_status_history -- see 0034_order_status_history_allow_cascade_
-- delete.sql and 0035_order_status_history_narrow_cascade_exemption.sql for
-- the full history. 0034's first attempt (`pg_trigger_depth() > 1` alone)
-- exempted every nested-trigger context, not specifically a real RI cascade,
-- and 0035 narrowed it to check the mutation's actual shape. Applying that
-- same narrow-shape approach here directly, not the depth-only version,
-- because ingredient_cost_history carries three FKs where order_status_
-- history carried two:
--   ingredient_id -> ingredients(id) on delete cascade
--   store_id      -> stores(id) on delete cascade
--   source_invoice_id -> purchase_invoices(id) on delete set null
-- DELETE is exempted only when it is shaped like one of the two real cascade
-- deletes: OLD.ingredient_id no longer resolves in ingredients (its parent
-- ingredient really was just deleted), or OLD.store_id no longer resolves in
-- stores (its parent store really was just deleted) -- either FK's cascade
-- can be the one driving a given row's removal, so either missing parent is
-- sufficient, not both.
-- UPDATE is exempted only when it is exactly the source_invoice_id SET NULL
-- shape (NEW.source_invoice_id IS NULL, OLD.source_invoice_id IS NOT NULL)
-- AND OLD.source_invoice_id no longer resolves in purchase_invoices (the
-- parent invoice really was just deleted) -- the same "shape plus a
-- vanished parent" test 0035 uses for order_status_history.actor.
-- Depth 1 (any direct top-level UPDATE/DELETE) always raises, and any
-- depth > 1 mutation that does not match one of the two shapes above also
-- still raises -- an append-only trail that silently let through anything
-- merely nested would not be one.
create or replace function prevent_ingredient_cost_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    if TG_OP = 'DELETE' then
      if not exists (select 1 from ingredients where id = OLD.ingredient_id)
         or not exists (select 1 from stores where id = OLD.store_id) then
        return old;
      end if;
    elsif TG_OP = 'UPDATE' then
      if NEW.source_invoice_id is null and OLD.source_invoice_id is not null
         and not exists (select 1 from purchase_invoices where id = OLD.source_invoice_id) then
        return new;
      end if;
    end if;
  end if;

  raise exception
    'ingredient_cost_history is append-only (WBS 6.6) -- a cost audit trail that can be edited after the fact is not an audit trail; insert a new row instead';
end;
$$;

drop trigger if exists trg_ingredient_cost_history_append_only on ingredient_cost_history;
create trigger trg_ingredient_cost_history_append_only
  before update or delete on ingredient_cost_history
  for each row
  execute function prevent_ingredient_cost_history_mutation();

-- CREATE OR REPLACE of 0044_console_confirm_purchase_invoice.sql's function.
-- Signature is unchanged (still replaces the same overload). Body is
-- byte-identical to 0044 except for two additions, each marked "WBS 6.6"
-- inline below: a history-row insert in the mapped-line write loop, and a
-- cost_drift_check enqueue alongside the existing cost_recalc enqueue.
-- Every comment from 0044 is preserved as-is so this migration's diff against
-- 0044 is exactly those two additions, not a rewrite.
create or replace function console_confirm_purchase_invoice(
  p_invoice_id   uuid,
  p_vendor_name  text,
  p_invoice_date date,
  p_lines        jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_review_status text;
  v_line jsonb;
  v_ingredient_id uuid;
  v_ingredient_store_id uuid;
  v_old_cost integer;
  v_new_cost integer;
  v_qty_base_unit numeric;
  v_total_satang integer;
  v_invoice_total_satang integer := 0;
  v_changed jsonb := '[]'::jsonb;
  v_ingredient_ids uuid[] := '{}';
begin
  -- `for update` is the actual guard here, not the idempotency check below
  -- by itself -- a plain SELECT lets two concurrent callers both read
  -- review_status <> 'confirmed', both pass validation, and both run the
  -- full write pass (redline_reviewer's WBS 6.4 CRITICAL finding,
  -- reproduced live: two real connections confirming the same 1-line
  -- invoice both returned {ok:true,already:false}, wrote 2 purchase_line_
  -- items rows and doubled the stock_ledger delta for one delivery). `for
  -- update` makes the second caller's SELECT block until the first
  -- caller's transaction commits (or rolls back) the UPDATE below, so it
  -- then reads the POST-commit review_status and correctly takes the
  -- already:true branch. This is the same mechanism as console_advance_
  -- order (0040), which gets its lock from transition_order's own `select
  -- ... for update` (0032) -- this function has no such delegate, so it
  -- takes the lock directly on purchase_invoices.
  select store_id, review_status into v_store_id, v_review_status
    from purchase_invoices where id = p_invoice_id
    for update;

  if v_store_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_store_id not in (select auth_store_ids()) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  -- Idempotent double-tap / stale-page-resubmit guard, now actually made
  -- safe under concurrency by the `for update` above -- a second confirm on
  -- an already-confirmed invoice never double-writes cost/stock/expense
  -- rows, because the second caller's SELECT physically cannot observe the
  -- pre-confirm review_status until the first caller's UPDATE has
  -- committed.
  if v_review_status = 'confirmed' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'no line items');
  end if;

  -- Pass 1: pure SHAPE validation only -- no DB lookups, so this pass never
  -- writes anything regardless of which line (if any) fails, and a soft
  -- {ok:false, VALIDATION_ERROR} can safely `return` mid-loop: Postgres only
  -- rolls back a function's own implicit transaction on an actual
  -- exception, NOT on a normal RETURN, so nothing may be written before this
  -- pass completes cleanly. Ownership is deliberately NOT checked here -- see
  -- pass 2.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce(length(trim(v_line->>'name')), 0) = 0 then
      return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'line item missing a name');
    end if;

    v_total_satang := (v_line->>'totalSatang')::integer;
    if v_total_satang is null or v_total_satang < 0 then
      return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'invalid line total');
    end if;

    v_ingredient_id := nullif(v_line->>'ingredientId', '')::uuid;

    if v_ingredient_id is not null then
      v_qty_base_unit := (v_line->>'qtyBaseUnit')::numeric;
      v_new_cost := (v_line->>'unitCostSatang')::integer;
      if v_qty_base_unit is null or v_qty_base_unit <= 0 then
        return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'invalid quantity');
      end if;
      if v_new_cost is null or v_new_cost < 0 then
        return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'message', 'invalid unit cost');
      end if;
    end if;

    v_invoice_total_satang := v_invoice_total_satang + v_total_satang;
  end loop;

  -- Pass 2: the actual writes. Everything from here commits or rolls back
  -- together via Postgres's own implicit transaction for this one top-level
  -- call -- no explicit SAVEPOINT/ROLLBACK needed, same posture as
  -- checkout_create_order (0029) and console_advance_order (0040).
  update purchase_invoices
     set vendor_name   = nullif(trim(p_vendor_name), ''),
         invoice_date  = p_invoice_date,
         total_satang  = v_invoice_total_satang,
         review_status = 'confirmed'
   where id = p_invoice_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_ingredient_id := nullif(v_line->>'ingredientId', '')::uuid;
    v_total_satang := (v_line->>'totalSatang')::integer;

    if v_ingredient_id is not null then
      v_qty_base_unit := (v_line->>'qtyBaseUnit')::numeric;
      v_new_cost := (v_line->>'unitCostSatang')::integer;

      -- Also locked: a DIFFERENT invoice confirming concurrently and
      -- touching the SAME ingredient (adjacent race to the one above --
      -- two distinct invoice ids, not a double-tap on one). The purchase_
      -- invoices lock above cannot cover this, since it's a different row.
      -- Without this lock the final current_unit_cost_satang is still
      -- correct either way (the UPDATE below always sets it to THIS call's
      -- v_new_cost, and "whichever commits last wins" is exactly the
      -- documented latest-purchase-price method), but v_old_cost could be
      -- read stale, corrupting the oldCostSatang this function reports back
      -- for the confirmation toast and the cost_recalc job payload. Locking
      -- here serializes the two confirms on this one ingredient row so each
      -- one's v_old_cost is a true pre-write snapshot.
      select store_id, current_unit_cost_satang into v_ingredient_store_id, v_old_cost
        from ingredients where id = v_ingredient_id
        for update;

      if v_ingredient_store_id is null or v_ingredient_store_id <> v_store_id then
        -- A real hard error, never a silently dropped/skipped line. Reached
        -- here in the WRITE pass (not pass 1) specifically so that any
        -- earlier line in this same call that already wrote its
        -- purchase_line_items/ingredients/stock_ledger rows gets rolled
        -- back too -- proving this function's atomicity, not just its
        -- validation. Exercised directly by the "forced failure rolls back
        -- all three [writes]" acceptance test.
        raise exception 'console_confirm_purchase_invoice: ingredient % does not belong to store %', v_ingredient_id, v_store_id;
      end if;

      insert into purchase_line_items (
        invoice_id, store_id, ingredient_id, raw_text, qty_base_unit, unit_cost_satang, total_satang
      ) values (
        p_invoice_id, v_store_id, v_ingredient_id, v_line->>'rawText', v_qty_base_unit, v_new_cost, v_total_satang
      );

      -- COSTING METHOD: latest purchase price, not weighted average, not
      -- FIFO -- see docs/db/schema.md "Why cost is stored twice" and WBS
      -- 6.6's own rationale (this function is where that decision is
      -- actually applied, ahead of 6.6's own dedicated migration/engine).
      -- The merchant's real question is "what does this ingredient cost me
      -- TODAY", which drives today's pricing -- not "what did my inventory
      -- cost on average", which is the accountant's question. Trade-off,
      -- stated honestly: one unusually expensive emergency purchase (a
      -- convenience-store top-up at 3x the supplier price) moves this value
      -- until the next normal purchase corrects it. WBS 7.4's drift alert
      -- is the intended way that gets surfaced to the merchant, not a
      -- reason to silently smooth it away here.
      update ingredients
         set current_unit_cost_satang = v_new_cost, updated_at = now()
       where id = v_ingredient_id;

      insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, purchase_invoice_id)
      values (v_store_id, v_ingredient_id, v_qty_base_unit, 'purchase', p_invoice_id);

      -- WBS 6.6: history row for every write to current_unit_cost_satang,
      -- including the very first one for an ingredient -- `null is distinct
      -- from X` is true in Postgres, so v_old_cost = null (never purchased
      -- before) correctly falls into this branch without a separate
      -- null-check, recording old_cost_satang = null as the true prior
      -- state rather than fabricating a baseline.
      if v_old_cost is distinct from v_new_cost then
        insert into ingredient_cost_history (
          ingredient_id, store_id, old_cost_satang, new_cost_satang, source_invoice_id
        ) values (
          v_ingredient_id, v_store_id, v_old_cost, v_new_cost, p_invoice_id
        );

        v_ingredient_ids := v_ingredient_ids || v_ingredient_id;
        v_changed := v_changed || jsonb_build_array(jsonb_build_object(
          'ingredientId', v_ingredient_id,
          'oldCostSatang', v_old_cost,
          'newCostSatang', v_new_cost
        ));
      end if;
    else
      -- Unmapped: recorded as a general expense only -- never touches
      -- ingredients or stock_ledger (WBS 6.4 acceptance: "Unmapped lines
      -- record as a general expense and never force an ingredient match").
      insert into purchase_line_items (
        invoice_id, store_id, ingredient_id, raw_text, qty_base_unit, unit_cost_satang, total_satang
      ) values (
        p_invoice_id, v_store_id, null, v_line->>'rawText', null, null, v_total_satang
      );
    end if;
  end loop;

  -- One recalc job and one drift-check job per confirm, only when at least
  -- one mapped line actually changed a cost (array_length of an empty '{}'
  -- array is NULL in Postgres, which the IF below correctly treats as
  -- false -- no job queued when nothing about any ingredient's cost moved,
  -- even if stock still did).
  if array_length(v_ingredient_ids, 1) > 0 then
    insert into job_queue (store_id, job_type, payload)
    values (v_store_id, 'cost_recalc', jsonb_build_object(
      'ingredientIds', to_jsonb(v_ingredient_ids),
      'sourceInvoiceId', p_invoice_id
    ));

    -- WBS 6.6: enqueue the drift-check job the same payload as cost_recalc,
    -- deliberately WITHOUT a precomputed baseline -- WBS 7.4's handler reads
    -- ingredient_cost_history fresh when the job actually runs, not a
    -- baseline snapshotted at confirm time that could be stale by the time
    -- the worker picks the job up.
    insert into job_queue (store_id, job_type, payload)
    values (v_store_id, 'cost_drift_check', jsonb_build_object(
      'ingredientIds', to_jsonb(v_ingredient_ids),
      'sourceInvoiceId', p_invoice_id
    ));
  end if;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'invoiceId', p_invoice_id,
    'totalSatang', v_invoice_total_satang,
    'changed', v_changed
  );
end;
$$;

-- 0021_rls.sql's standing `alter default privileges` grants EXECUTE to
-- anon/authenticated/service_role on every function created afterwards -- a
-- bare `revoke all from public` does not touch it (0025/0028/0029/0030/0031/
-- 0040/0044 all document the same trap; repeating the fix, not the trap,
-- here, even though CREATE OR REPLACE does not actually reset the ACL 0044
-- already set -- kept for consistency with every prior migration that
-- touches this function).
revoke all on function console_confirm_purchase_invoice(uuid, text, date, jsonb) from public;
revoke execute on function console_confirm_purchase_invoice(uuid, text, date, jsonb) from anon, service_role;
grant execute on function console_confirm_purchase_invoice(uuid, text, date, jsonb) to authenticated;

-- redline_reviewer HIGH finding on this migration: the same converging-
-- cascade topology 0034/0035 found and fixed for order_status_history is
-- reproduced here, unfixed. ingredient_cost_history carries THREE FKs, all
-- non-deferrable, all reachable from one `stores` deletion:
--   ingredient_id -> ingredients(id)      on delete cascade  (via stores -> ingredients, 2 hops)
--   store_id      -> stores(id)           on delete cascade  (direct, 1 hop)
--   source_invoice_id -> purchase_invoices(id) on delete set null (via stores -> purchase_invoices, 2 hops)
-- Reasoned independently below, not copied from the reviewer's suggestion
-- verbatim -- the reviewer flagged ingredient_id and source_invoice_id as
-- "reached via multi-hop paths" and left store_id ("direct, single-hop") to
-- our own judgment. That hop-count framing is not actually what determines
-- risk here, and reasoning it through changes which FK ends up exempt.
--
-- CORRECTION (redline_reviewer targeted re-check, second pass): the
-- paragraph originally here claimed that a SET NULL UPDATE on one FK column
-- forces Postgres to re-validate a DIFFERENT, non-deferred FK on the same
-- row ("trigger re-validates victim"). That claim was tested directly
-- against a real Postgres 17 instance and is FALSE: an UPDATE that touches
-- only source_invoice_id never re-validates ingredient_id_fkey or
-- store_id_fkey, even when their target rows are already gone. Reproduced
-- at scale (thousands of rows, single batched cascading delete) against
-- BOTH this table's topology and order_status_history's own precedent
-- topology with 0034/0035's fix removed -- zero FK violations in any run.
-- The underlying bug class (a CASCADE-queued delete of this row still
-- pending while some other RI action reaches it first) has, by 0034/0035's
-- own admission, never actually been forced to reproduce either -- it
-- remains a description of what Postgres's documentation says CAN happen
-- under an unspecified RI action ordering, not an observed failure in this
-- codebase.
--
-- Given that, the two `deferrable initially deferred` alterations below are
-- kept as a DEFENSIVE measure by structural analogy to 0034/0035, not as a
-- fix for a confirmed mechanism: deferring a constraint only delays its
-- check to end-of-transaction and can never hide a real violation, so it
-- costs nothing and cannot make correctness worse. ingredient_id and
-- store_id are both CASCADE-shaped FKs reachable from the same `stores`
-- deletion that also drives source_invoice_id's SET NULL, so if some future
-- Postgres version (or an unexamined interleaving) ever does make one of
-- them a "victim" of another action on this row, both are already covered.
-- source_invoice_id itself is left non-deferrable on a claim that DOES
-- hold: a SET NULL action's own FK check trivially passes when writing
-- NULL, since NULL always satisfies a foreign key -- it has no way to fail
-- regardless of the disputed mechanism above.
--
-- Do not cite the "trigger vs victim" framing as a verified Postgres
-- mechanism in a future migration without re-deriving it -- it did not
-- survive direct testing here.
--
-- Verified: this migration's cascade-delete path (auth.users -> merchants
-- -> stores -> {ingredients, purchase_invoices} -> ingredient_cost_history,
-- plus stores -> ingredient_cost_history directly) was exercised repeatedly
-- against a real local Postgres 17 instance with a committed (non-rolled-
-- back) fixture -- multiple ingredients, multiple confirmed invoices,
-- multiple history rows -- both before and after this fix. It did not force
-- a failure in this environment even without deferring anything, which is
-- expected: the precedent's own description of this as a genuine,
-- non-deterministic Postgres RI-queue race means it is not a condition a
-- single sequential test script can force on demand.
alter table ingredient_cost_history
  alter constraint ingredient_cost_history_ingredient_id_fkey
  deferrable initially deferred;

alter table ingredient_cost_history
  alter constraint ingredient_cost_history_store_id_fkey
  deferrable initially deferred;

-- source_invoice_id_fkey deliberately left NOT deferrable -- see reasoning
-- above (the SET NULL "trigger" role, same as order_status_history.actor).
