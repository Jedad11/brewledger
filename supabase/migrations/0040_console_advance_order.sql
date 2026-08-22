-- WBS 5.9 — merchant-driven forward transitions (ACCEPTED->PREPARING,
-- PREPARING->READY, READY->COLLECTED), the three buttons "เริ่มทำ" /
-- "พร้อมรับ" / "รับแล้ว".
--
-- Same posture as console_confirm_payment/console_reject_payment
-- (0031/0033, docs/db/wbs_5_7_lifecycle_design.md §4): transition_order()
-- itself is `revoke`d from `authenticated` (0032_order_status_history.sql
-- §3 — service_role only, reached only via a nested call from another
-- security-definer wrapper). A console-* Edge Function's ctx.supabase holds
-- an `authenticated`-role client (the merchant's own JWT forwarded, per
-- supabase/functions/_shared/console/auth.ts), so it CANNOT call
-- `.rpc('transition_order', ...)` directly -- that RPC would 403 at the
-- Postgres grant layer before transition_order's own body ever runs. This
-- wrapper is that requirement, not an optional convenience: without it,
-- WBS 5.9's own acceptance criterion "each action routes through
-- transitionOrder" has no legal caller from the console at all.
--
-- Ownership + ownership-derived actor: identical split to
-- console_reject_payment -- a two-step ownership check (NOT_FOUND vs
-- FORBIDDEN, distinguishable, mutates nothing on either) before the
-- transition itself, actor id resolved via auth_merchant_id() (the caller's
-- own JWT, RLS's own source of truth) rather than trusted client input.
--
-- p_to allow-list (PREPARING/READY/COLLECTED only): this wrapper is scoped
-- to the three forward transitions WBS 5.9 owns. CANCELLED/REFUNDED stay
-- exclusively WBS 5.11's own console_cancel_order/console_resolve_refund
-- (not yet built) -- accepting an arbitrary p_to here would let this single
-- function silently grow into the cancel path too, which
-- docs/db/wbs_5_7_lifecycle_design.md §1.1 explicitly assigns elsewhere.
--
-- Idempotency deviation from the 0033 precedent, disclosed: 0033's wrapper
-- functions each cover exactly ONE from->to pair, so any BL001 that isn't
-- "we're already at the target" is unambiguously a real bug and 0033
-- `raise`s it back out as a hard error. This wrapper covers three pairs
-- behind one signature and is also the target of WBS 5.9's own bulk action
-- (multiple orders in a slot, advanced in sequence, one Edge Function call
-- per hop) -- a genuinely illegal attempt here (e.g. a second open tab
-- already advanced the order past p_to, or two merchants racing the same
-- bulk button) is an expected, recoverable condition the UI must roll back
-- and explain, not a 500. So a genuine BL001 here returns
-- {ok:false, code:'ILLEGAL_TRANSITION'} instead of re-raising -- the Edge
-- Function turns that into 409, and the console client shows a specific
-- "this order's status already changed" message rather than the generic
-- failure copy. Flagged for redline_reviewer as an intentional divergence
-- from 0033's stricter re-raise, not an oversight.
create or replace function console_advance_order(
  p_order_id uuid,
  p_to text
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
  if p_to not in ('PREPARING', 'READY', 'COLLECTED') then
    return jsonb_build_object('ok', false, 'code', 'INVALID_TARGET');
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
    -- transition_order() itself performs the row lock, the map check, and
    -- every side effect (push_notify job_queue insert for
    -- ACCEPTED->PREPARING/PREPARING->READY; none for READY->COLLECTED) --
    -- see docs/db/wbs_5_7_lifecycle_design.md §3. Nothing duplicated here.
    v_order := transition_order(p_order_id, p_to, v_merchant_id, 'merchant');
  exception
    when sqlstate 'BL001' then
      if (select status from orders where id = p_order_id) = p_to then
        return jsonb_build_object('ok', true, 'already', true);
      end if;
      -- Genuinely illegal (not the "already at target" double-tap race):
      -- surface the detail transition_order() raised so this is
      -- distinguishable in logs from the benign race above, per
      -- redline_reviewer's WBS 5.9 finding.
      raise warning 'console_advance_order: illegal transition order_id=% p_to=% detail=%',
        p_order_id, p_to, sqlerrm;
      return jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION');
  end;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_code', v_order.order_code,
      'status', v_order.status
    )
  );
end;
$$;

-- 0021_rls.sql's standing `alter default privileges` grants EXECUTE to
-- anon/authenticated/service_role on every function created afterwards -- a
-- bare `revoke all from public` does not touch it (0025/0028/0029/0030/0031
-- all document the same trap; repeating the fix, not the trap, here).
revoke all on function console_advance_order(uuid, text) from public;
revoke execute on function console_advance_order(uuid, text) from anon, service_role;
grant execute on function console_advance_order(uuid, text) to authenticated;
