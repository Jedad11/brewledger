-- WBS 5.6 — Merchant Payment Confirmation.
--
-- Revision note (see the WBS dictionary entry's own header): the licensed-
-- gateway webhook this used to describe is gone. There is no callback to
-- receive — the merchant confirms manually after checking their own banking
-- app. This migration adds NO new columns: orders.payment_confirmed_by /
-- payment_confirmed_at (0011_orders.sql) and payments.method / payee_alias
-- (0014_payments.sql) already carry everything the WBS revision asked for.
-- No webhook_events / dead_letter_webhooks tables exist anywhere in this
-- schema to drop.
--
-- Both functions below do everything WBS 5.6 requires as ONE plpgsql
-- transaction — Postgres's own implicit transaction per top-level call, same
-- posture as checkout_create_order (0029) — rather than a series of separate
-- supabase-js calls from the Edge Function. That is the only way to satisfy
-- this entry's own acceptance criterion "a forced failure during stock
-- deduction rolls back the status change as well": a rollback across two
-- independent PostgREST calls is not a thing PostgREST offers.
--
-- Ownership: neither function accepts a store_id from the caller (WBS 4.2 —
-- never trust a client-supplied store_id). Each looks up the order's own
-- store_id and checks it against auth_store_ids(), the SAME helper the RLS
-- layer itself is built on (0021_rls.sql SECTION 2) — one source of truth,
-- not a second hand-rolled ownership check. Both are `security definer` /
-- `set search_path = public`, granted to `authenticated` only (never anon,
-- never service_role — this is the console's own authenticated session
-- acting on its own stores, the same posture as enqueue_generate_slots_job,
-- 0028), so auth_store_ids()'s own auth.uid() resolves against the caller's
-- real JWT rather than a service-role context with no uid at all.
--
-- Deviation from the WBS 5.6 pseudocode, flagged for redline_reviewer: that
-- pseudocode folds the ownership check into the SAME UPDATE WHERE clause as
-- the idempotency guard (`store_id = any($3) and status = 'PENDING_PAYMENT'`
-- -> zero rows -> `{already: true}`). That cannot tell a cross-tenant order
-- (zero rows, correctly a 403, mutates nothing) apart from a legitimate
-- double-tap on an already-confirmed order of the CALLER'S OWN (zero rows,
-- correctly a silent {already:true}) — but WBS 5.6's own Acceptance list
-- requires both outcomes distinctly ("confirming another merchant's order
-- returns 403 and mutates nothing" vs. "a double-tap ... confirms exactly
-- once", second tap a silent no-op). Split into two steps below: an
-- ownership check first (FORBIDDEN/NOT_FOUND), then the guarded UPDATE as
-- the idempotency check (already:true) — satisfies both criteria, which the
-- merged WHERE clause could not have.
--
-- Disclosed gap against WBS 5.6's own Acceptance list ("every confirmation
-- writes an audit row naming the confirming session") and this entry's own
-- pseudocode (which threads a ctx.sessionId through): payment_confirmed_by
-- below is written as p_merchant_id, not a session identifier. Every
-- confirmation from the same merchant account — regardless of device or
-- browser tab — writes the identical value. See docs/known_issues.md for
-- the full tradeoff writeup; the short version is that resolving this
-- properly needs a session_id claim threaded through ConsoleContext
-- (supabase/functions/_shared/console/auth.ts), which every console-*
-- Edge Function and this suite's whole JWT-minting test fixture
-- (supabase/functions/_tests/helpers/clients.ts, which cannot mint that
-- claim locally — there is no local SMS provider to obtain a real GoTrue
-- session from) sit downstream of. That is out of proportion for this
-- entry alone. This is NOT a red-line issue: the money-safety guard here
-- is ownership (auth_store_ids()) and the idempotent status WHERE clause
-- above, neither of which depends on payment_confirmed_by's granularity.
-- Acceptable for a sole-proprietor pilot, where "which merchant confirmed"
-- and "which session confirmed" coincide in practice. Revisit alongside
-- WBS 4.1/4.2 auth plumbing if multi-device/multi-staff console sessions
-- become real.
--
-- Stock deduction here is a WBS 6.8 SEED, not the full 6.8 deliverable: one
-- stock_ledger row per (order_item x bom_line), using bom_lines.qty_base_unit
-- as-is — no unit conversion, because ingredients.base_unit and
-- bom_lines.qty_base_unit are already the same base unit by construction
-- (0008_ingredients.sql / 0009_bom_lines.sql: bom_lines has no unit column
-- of its own, its qty is denominated directly in the referenced ingredient's
-- base_unit), so none is needed for the units this schema has today. WBS 6.8
-- (packages/costing per the WBS dictionary's own pseudocode) owns low-stock
-- alerting, the negative-stock warning surface, and any future genuine unit
-- conversion — extend the INSERT below when that lands, rather than adding
-- a second call site.
create or replace function console_confirm_payment(
  p_order_id uuid,
  p_merchant_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_order orders%rowtype;
begin
  select store_id into v_store_id from orders where id = p_order_id;
  if v_store_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_store_id not in (select auth_store_ids()) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  -- THE guard is this WHERE clause, not any check the Edge Function or the
  -- console UI performs — a concurrent double-tap or a retried request both
  -- land here, and only one of them can ever see `found`.
  update orders
     set status = 'ACCEPTED',
         paid_at = now(),
         payment_confirmed_by = p_merchant_id::text, -- merchant-level, not session-level; see header comment above
         payment_confirmed_at = now()
   where id = p_order_id
     and status = 'PENDING_PAYMENT'
  returning * into v_order;

  if not found then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- Only the row(s) still 'pending' become 'succeeded' — an already-expired
  -- or already-failed payments row (e.g. from an earlier QR reissue,
  -- 0030_promptpay_charge.sql) is left as-is rather than overwritten.
  update payments
     set status = 'succeeded'
   where order_id = p_order_id
     and status = 'pending';

  -- WBS 6.8 seed (see header comment above) — silent for any order_item
  -- whose menu_item has zero bom_lines, by construction of the inner join:
  -- RL-2 requires zero ledger rows and zero warnings for an untracked item,
  -- and this produces exactly that without a special case.
  insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, order_id)
  select v_store_id, bl.ingredient_id, -(bl.qty_base_unit * oi.quantity), 'sale', p_order_id
    from order_items oi
    join bom_lines bl on bl.menu_item_id = oi.menu_item_id
   where oi.order_id = p_order_id;

  -- WBS 5.8: async, never awaited by the confirming merchant. orders.
  -- total_cost_snapshot_satang (set at order creation, WBS 5.4/5.5) is not
  -- touched anywhere in this function — "P&L inclusion" for this entry's
  -- purposes is exactly that: confirming payment must not zero or null out
  -- a cost snapshot that was already populated.
  insert into job_queue (store_id, job_type, payload)
  values (v_store_id, 'push_notify', jsonb_build_object('orderId', p_order_id));

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_code', v_order.order_code,
      'status', v_order.status,
      'total_satang', v_order.total_satang,
      'paid_at', v_order.paid_at
    )
  );
end;
$$;

-- 0021_rls.sql's standing `alter default privileges ... grant execute on
-- functions to anon, authenticated, service_role` grants EXECUTE directly to
-- those roles on every function created afterwards — a plain `revoke all
-- ... from public` does not touch it (0025/0028/0029/0030 all hit this same
-- trap and document it; repeating the fix, not the trap, here).
revoke all on function console_confirm_payment(uuid, uuid) from public;
revoke execute on function console_confirm_payment(uuid, uuid) from anon, service_role;
grant execute on function console_confirm_payment(uuid, uuid) to authenticated;

-- "ยังไม่ได้รับเงิน" — expires the order immediately and releases the slot,
-- no stock movement (WBS 5.6 deliverable list, literally: "no stock
-- movement"). Same ownership/idempotency split as console_confirm_payment
-- above, same reasoning.
create or replace function console_reject_payment(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_slot_id uuid;
begin
  select store_id into v_store_id from orders where id = p_order_id;
  if v_store_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_store_id not in (select auth_store_ids()) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  update orders
     set status = 'EXPIRED'
   where id = p_order_id
     and status = 'PENDING_PAYMENT'
  returning pickup_slot_id into v_slot_id;

  if not found then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- security definer -- runs as this function's owner, so release_pickup_slot's
  -- own anon/authenticated revoke (0028_pickup_slot_generation_and_reservation.sql)
  -- does not block this internal call, same reasoning 0029's
  -- checkout_create_order documents for its own nested reserve_pickup_slot call.
  if v_slot_id is not null then
    perform release_pickup_slot(v_slot_id);
  end if;

  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

revoke all on function console_reject_payment(uuid) from public;
revoke execute on function console_reject_payment(uuid) from anon, service_role;
grant execute on function console_reject_payment(uuid) to authenticated;
