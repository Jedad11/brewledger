-- WBS 5.11 — Order Cancellation and Merchant-Initiated Refund.
--
-- Implements docs/db/wbs_5_11_refund_design.md verbatim (architect design,
-- read in full before touching this file). Summary of what's new — the rest
-- of the cancellation state machine (transition_order's CANCELLED branch,
-- compensating stock_ledger rows, slot release, refund_status='pending' on
-- leaving a paid state) already shipped under WBS 5.7/5.9/5.12 and is not
-- duplicated here:
--   * orders.cancel_reason — 5 fixed codes, nullable, written directly by
--     console_cancel_order (not threaded through transition_order()).
--   * orders.refund_resolved_by / refund_resolved_at — written by
--     console_resolve_refund after transition_order(...,'REFUNDED',...)
--     succeeds, same transaction.
--   * orders_refund_pending_idx — supports the never-aging-out "รอคืนเงิน"
--     console list.
--   * console_cancel_order / console_resolve_refund — security definer
--     wrappers, same ownership/idempotency posture as console_advance_order
--     (0040). BL001 handled by re-read-and-compare
--     (docs/db/wbs_5_7_lifecycle_design.md §10); a genuine illegal
--     transition returns {ok:false, code:'ILLEGAL_TRANSITION'} rather than
--     raising, following console_advance_order's posture (design doc §3,
--     flagged there as an intentional read for redline_reviewer to confirm).
--   * public_order_status / public_order_lookup widened (DROP + CREATE, not
--     REPLACE — Postgres rejects widening a RETURNS TABLE list via REPLACE)
--     to also return cancel_reason and refund_status. refund_status, never
--     cancel_reason's mere presence, is the only field permitted to gate any
--     refund-claim/timeframe copy on the customer side (design doc §4).

-------------------------------------------------------------------------
-- 1. cancel_reason
-------------------------------------------------------------------------
alter table orders add column if not exists cancel_reason text
  check (cancel_reason in (
    'out_of_stock',        -- ของหมด
    'equipment_failure',   -- เครื่องเสีย
    'customer_request',    -- ลูกค้าขอยกเลิก
    'unexpected_closure',  -- ร้านปิดกะทันหัน
    'other'                -- อื่นๆ
  ));

-------------------------------------------------------------------------
-- 2. refund_resolved_by / refund_resolved_at + pending-refund index
-------------------------------------------------------------------------
alter table orders add column if not exists refund_resolved_by uuid
  references merchants(id) on delete set null;
alter table orders add column if not exists refund_resolved_at timestamptz;

create index if not exists orders_refund_pending_idx
  on orders (store_id, created_at desc)
  where refund_status = 'pending';

-------------------------------------------------------------------------
-- 3. console_cancel_order / console_resolve_refund
-------------------------------------------------------------------------
create or replace function console_cancel_order(
  p_order_id uuid,
  p_reason   text   -- one of the five codes in orders.cancel_reason's check
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_merchant_id uuid;
  v_order orders%rowtype;
begin
  if p_reason not in (
    'out_of_stock', 'equipment_failure', 'customer_request',
    'unexpected_closure', 'other'
  ) then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR',
      'message', 'invalid cancel reason');
  end if;

  select store_id into v_store_id from orders where id = p_order_id;
  if v_store_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_store_id not in (select auth_store_ids()) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select auth_merchant_id() into v_merchant_id;

  begin
    -- transition_order() performs the row lock, the map check, the
    -- compensating stock_ledger insert, refund_status='pending' (only when
    -- leaving a paid state), and slot release -- all unchanged from 0032,
    -- nothing duplicated here.
    v_order := transition_order(p_order_id, 'CANCELLED', v_merchant_id, 'merchant');
  exception
    when sqlstate 'BL001' then
      -- Re-read-and-compare, per wbs_5_7_lifecycle_design.md §10: only a
      -- genuine "already cancelled" (double-tap / two tabs) is silent.
      -- Anything else -- e.g. a stale UI trying to cancel an order another
      -- device already advanced to COLLECTED -- is a real, structured
      -- rejection, not swallowed and not a 500.
      if (select status from orders where id = p_order_id) = 'CANCELLED' then
        return jsonb_build_object('ok', true, 'already', true);
      end if;
      return jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION');
  end;

  update orders set cancel_reason = p_reason where id = p_order_id
  returning * into v_order;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_code', v_order.order_code,
      'status', v_order.status,
      'refund_status', v_order.refund_status,
      'cancel_reason', v_order.cancel_reason
    )
  );
end;
$$;

-- 0021_rls.sql's standing `alter default privileges` grants EXECUTE to
-- anon/authenticated/service_role on every function created afterwards -- a
-- bare `revoke all from public` does not touch it (0025 et al. document the
-- same trap; repeating the fix, not the trap, here).
revoke all on function console_cancel_order(uuid, text) from public;
revoke execute on function console_cancel_order(uuid, text) from anon, service_role;
grant execute on function console_cancel_order(uuid, text) to authenticated;

create or replace function console_resolve_refund(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_merchant_id uuid;
  v_order orders%rowtype;
begin
  select store_id into v_store_id from orders where id = p_order_id;
  if v_store_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_store_id not in (select auth_store_ids()) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select auth_merchant_id() into v_merchant_id;

  begin
    -- transition_order()'s CANCELLED -> REFUNDED branch has no side effect
    -- of its own beyond the history row (0032 §1.1) and enforces the
    -- refund_status='pending' invariant itself -- a CANCELLED order whose
    -- refund was never owed (PENDING_PAYMENT cancel) or already resolved
    -- cannot be "resolved" a second time; this correctly BL001s here too.
    v_order := transition_order(p_order_id, 'REFUNDED', v_merchant_id, 'merchant');
  exception
    when sqlstate 'BL001' then
      if (select status from orders where id = p_order_id) = 'REFUNDED' then
        return jsonb_build_object('ok', true, 'already', true);
      end if;
      return jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION');
  end;

  update orders
     set refund_status = 'done',
         refund_resolved_by = v_merchant_id,
         refund_resolved_at = now()
   where id = p_order_id
  returning * into v_order;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_code', v_order.order_code,
      'status', v_order.status,
      'refund_status', v_order.refund_status,
      'refund_resolved_at', v_order.refund_resolved_at
    )
  );
end;
$$;

revoke all on function console_resolve_refund(uuid) from public;
revoke execute on function console_resolve_refund(uuid) from anon, service_role;
grant execute on function console_resolve_refund(uuid) to authenticated;

-------------------------------------------------------------------------
-- 4. public_order_status / public_order_lookup widening
--
-- CREATE OR REPLACE FUNCTION cannot add columns to an existing function's
-- RETURNS TABLE list -- Postgres requires DROP + CREATE for that (changing
-- the return type is explicitly disallowed by plain REPLACE). A DROP
-- removes the anon grant along with the function, so the revoke/grant pair
-- is repeated below for both -- 0021's default-privileges trap applies
-- here too.
-------------------------------------------------------------------------
drop function if exists public_order_status(text);
create function public_order_status(p_order_code text)
returns table (
  order_code text,
  status text,
  pickup_at timestamptz,
  item_name text,
  quantity integer,
  cancel_reason text,
  refund_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.order_code,
    o.status,
    ps.slot_start as pickup_at,
    oi.item_name_snapshot as item_name,
    oi.quantity,
    o.cancel_reason,
    o.refund_status
  from orders o
  join order_items oi on oi.order_id = o.id
  left join pickup_slots ps on ps.id = o.pickup_slot_id
  where o.order_code = p_order_code;
$$;

revoke all on function public_order_status(text) from public;
grant execute on function public_order_status(text) to anon;

-- Widening this DROP+CREATE from the pre-0037 naive shape would silently
-- revert 0037_normalize_order_lookup_phone.sql's fix (0812345678,
-- 081-234-5678, 66812345678, +66 81 234 5678 all failing to match the
-- stored +66XXXXXXXXX row) -- the plpgsql body and its normalisation logic
-- below are byte-for-byte 0037's, with only cancel_reason/refund_status
-- added to the select list and returns table.
drop function if exists public_order_lookup(text, text);
create function public_order_lookup(p_phone text, p_order_code text)
returns table (
  order_code text,
  status text,
  pickup_at timestamptz,
  item_name text,
  quantity integer,
  cancel_reason text,
  refund_status text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_digits text;
begin
  v_phone := nullif(trim(p_phone), '');
  if v_phone is not null then
    v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
    if v_digits ~ '^0[0-9]{9}$' then
      v_phone := '+66' || substr(v_digits, 2);
    elsif v_digits ~ '^66[0-9]{9}$' then
      v_phone := '+' || v_digits;
    end if;
  end if;

  return query
    select
      o.order_code,
      o.status,
      ps.slot_start as pickup_at,
      oi.item_name_snapshot as item_name,
      oi.quantity,
      o.cancel_reason,
      o.refund_status
    from orders o
    join order_items oi on oi.order_id = o.id
    left join pickup_slots ps on ps.id = o.pickup_slot_id
    where o.order_code = p_order_code
      and o.customer_phone = v_phone;
end;
$$;

revoke all on function public_order_lookup(text, text) from public;
grant execute on function public_order_lookup(text, text) to anon;
