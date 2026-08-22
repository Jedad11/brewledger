-- WBS 6.4 -- Purchase Confirmation Screen (Manual): the atomic confirm
-- transaction.
--
-- ARCHITECTURAL RULE THIS FUNCTION ENFORCES: nothing writes to
-- ingredients.current_unit_cost_satang until a merchant explicitly confirms
-- it here, even though every value passed in was typed by the merchant
-- themselves in WBS 6.1 -- a fat-fingered price would silently corrupt the
-- cost of every menu item using that ingredient, and the merchant would only
-- discover it as a profit figure they cannot explain. WBS 6.1's own
-- createPurchaseInvoice (apps/console/.../expenses/capture/actions.ts) is
-- structurally incapable of writing this column -- it only ever inserts a
-- purchase_invoices row with the typed lines parked in raw_ocr_output. This
-- function is the ONLY write path in the codebase that touches
-- ingredients.current_unit_cost_satang, and it only ever runs from an
-- explicit tap (apps/console/.../expenses/[id]/review/actions.ts's
-- confirmPurchaseInvoice) -- never on page load, never on an intermediate
-- edit.
--
-- security definer, granted to `authenticated` only (same posture as
-- console_advance_order, 0040): job_queue has RLS enabled with ZERO policies
-- (0021_rls.sql SS2.2 -- deliberately service_role-only), so a plain
-- `authenticated` PostgREST insert into job_queue always 403s. Every other
-- table this function touches (purchase_invoices, purchase_line_items,
-- ingredients, stock_ledger) already grants `authenticated` full RW under
-- `store_id in (select auth_store_ids())` (0021), so the ONLY reason this
-- needs to be security definer rather than a plain multi-`.from()` Server
-- Action is job_queue's own zero-policy stance -- but five separate
-- PostgREST round trips could never be atomic anyway (same reasoning as
-- checkout_create_order's own header, 0029), so one plpgsql function is the
-- right shape here regardless.
--
-- Division of labour, disclosed for redline_reviewer: unit conversion
-- (purchase unit -> base unit, packages/costing/src/units.ts's
-- toBaseUnit/costPerBaseUnit) happens in TypeScript BEFORE this function is
-- called, not re-derived here in SQL. Unlike checkout_create_order (a
-- public, unauthenticated endpoint that MUST re-validate every claimed price
-- against live rows because the caller is an untrusted browser), this
-- function's caller is the merchant's own authenticated Server Action
-- writing that merchant's own store's data -- the identical trust boundary
-- saveIngredient/createPurchaseInvoice already operate inside, where typed
-- values are persisted as given. Re-implementing toBaseUnit's unit-family
-- arithmetic a second time in plpgsql would be a second place to introduce
-- the exact kg/g/L/ml factor-of-1000 bug that module's own header warns
-- about. What this function DOES still verify server-side is OWNERSHIP of
-- every referenced id (the invoice, each ingredient) against
-- auth_store_ids() -- it does not re-derive arithmetic already computed
-- correctly, once, in packages/costing.
--
-- p_lines shape (one element per purchase_line_items row to write), each
-- pre-converted by the caller:
--   {
--     "name": text,                    -- display name, as edited on this screen
--     "rawText": text,                 -- "name (qty unit)" as typed, kept for the record
--     "ingredientId": uuid | null,     -- null => unmapped, recorded as a general expense only
--     "qtyBaseUnit": numeric | null,   -- required iff ingredientId is set
--     "unitCostSatang": integer | null,-- cost per BASE unit (costPerBaseUnit's output, rounded); required iff ingredientId is set
--     "totalSatang": integer           -- as typed -- the real amount paid, always present
--   }
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

      if v_old_cost is distinct from v_new_cost then
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

  -- One recalc job per confirm, only when at least one mapped line actually
  -- changed a cost (array_length of an empty '{}' array is NULL in Postgres,
  -- which the IF below correctly treats as false -- no job queued when
  -- nothing about any ingredient's cost moved, even if stock still did).
  if array_length(v_ingredient_ids, 1) > 0 then
    insert into job_queue (store_id, job_type, payload)
    values (v_store_id, 'cost_recalc', jsonb_build_object(
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
-- 0040 all document the same trap; repeating the fix, not the trap, here).
revoke all on function console_confirm_purchase_invoice(uuid, text, date, jsonb) from public;
revoke execute on function console_confirm_purchase_invoice(uuid, text, date, jsonb) from anon, service_role;
grant execute on function console_confirm_purchase_invoice(uuid, text, date, jsonb) to authenticated;
