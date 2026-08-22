-- WBS 5.7 §7 — required follow-up, not optional cleanup: route
-- console_confirm_payment / console_reject_payment (0031) through
-- transition_order() (0032) instead of writing orders.status directly.
--
-- Per docs/db/wbs_5_7_lifecycle_design.md §7/§10: 5.7's own acceptance
-- criterion ("no code path anywhere updates orders.status directly,
-- bypassing the guard") is false for this codebase without this migration,
-- even though 0032 exists and works correctly for any new call site. Do not
-- mark 5.7 done on the strength of 0032 alone.
--
-- Same signature `create or replace` for both functions — nothing calling
-- these RPCs (console-confirm-payment/index.ts, console-reject-payment/
-- index.ts, the existing test suite) needs to change, only the bodies.
-- Ownership check and idempotency pre-check shape (0031) is unchanged; only
-- the state-changing half is swapped for a call to transition_order(),
-- following the exception-catch-and-compare pattern
-- docs/db/wbs_5_7_lifecycle_design.md §4 specifies: transition_order()
-- itself never treats a double-tap as a silent no-op (a self-transition is
-- absent from its map and always throws BL001) — the silent {already:true}
-- a double-tapping merchant needs is produced here, in the wrapper that
-- already owns ownership-checking, by catching BL001 and comparing the
-- CURRENT status against the target: equal means "we're already there"
-- (silent), anything else means a genuinely illegal attempt and must
-- propagate, never be swallowed.
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

  begin
    -- transition_order() itself performs the row lock, the PENDING_PAYMENT
    -- -> ACCEPTED map check, the stock_ledger deduction, and the
    -- push_notify job_queue insert (0032) — the stock/notify inserts that
    -- used to live directly in this function's body are gone from here,
    -- not duplicated.
    v_order := transition_order(p_order_id, 'ACCEPTED', p_merchant_id, 'merchant');
  exception
    when sqlstate 'BL001' then
      -- Cheap re-read, no lock needed: only distinguishing "we're already
      -- at the target" (expected, silent) from "something else is wrong"
      -- (re-raise — this is the real bug case 5.7 exists to catch).
      if (select status from orders where id = p_order_id) = 'ACCEPTED' then
        return jsonb_build_object('ok', true, 'already', true);
      end if;
      raise;
  end;

  -- Columns transition_order() does not own: payment-confirmation-specific,
  -- not generic to every ACCEPTED-reaching transition. Same transaction as
  -- the transition_order() call above (this whole function is one implicit
  -- Postgres transaction, same posture as checkout_create_order/0029) — the
  -- FOR UPDATE lock transition_order() took is still held here, so this is
  -- not a second race window.
  update orders
     set paid_at = now(),
         payment_confirmed_by = p_merchant_id::text, -- merchant-level, not session-level; see 0031's header comment
         payment_confirmed_at = now()
   where id = p_order_id
  returning * into v_order;

  -- Only the row(s) still 'pending' become 'succeeded' — an already-expired
  -- or already-failed payments row (e.g. from an earlier QR reissue,
  -- 0030_promptpay_charge.sql) is left as-is rather than overwritten.
  update payments
     set status = 'succeeded'
   where order_id = p_order_id
     and status = 'pending';

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

revoke all on function console_confirm_payment(uuid, uuid) from public;
revoke execute on function console_confirm_payment(uuid, uuid) from anon, service_role;
grant execute on function console_confirm_payment(uuid, uuid) to authenticated;

-- "ยังไม่ได้รับเงิน" — expires the order immediately and releases the slot,
-- no stock movement (unchanged from 0031: PENDING_PAYMENT -> EXPIRED has no
-- stock side effect in transition_order()'s map either). Same
-- ownership/idempotency split as console_confirm_payment above.
--
-- This function's signature carries no p_merchant_id (0031, unchanged
-- here — a same-signature create or replace). transition_order() requires
-- a non-null actor for actor_type='merchant', so the merchant id is derived
-- the same way auth_store_ids() derives store ownership: via auth.uid(),
-- through the existing auth_merchant_id() helper
-- (0026_stores_insert_bootstrap_fix.sql). By the point this is reached, the
-- ownership check above has already confirmed v_store_id is one of the
-- caller's own stores, so a matching merchant row is guaranteed to exist —
-- auth_merchant_id() cannot return zero rows here.
create or replace function console_reject_payment(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_merchant_id uuid;
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
    perform transition_order(p_order_id, 'EXPIRED', v_merchant_id, 'merchant');
  exception
    when sqlstate 'BL001' then
      if (select status from orders where id = p_order_id) = 'EXPIRED' then
        return jsonb_build_object('ok', true, 'already', true);
      end if;
      raise;
  end;

  return jsonb_build_object('ok', true, 'already', false);
end;
$$;

revoke all on function console_reject_payment(uuid) from public;
revoke execute on function console_reject_payment(uuid) from anon, service_role;
grant execute on function console_reject_payment(uuid) to authenticated;
