-- WBS 5.5 — PromptPay QR issuance. payments (0014_payments.sql) already
-- carries every column this needs; no schema change, one RPC only.
--
-- Deliberately NO unique constraint on payments.order_id: reissue
-- ("ขอ QR ใหม่") is append-only, same posture as stock_ledger — each
-- successful call inserts a fresh row rather than updating a prior one, so
-- the payments table stays a true history of every QR ever issued for an
-- order, not just the latest.
--
-- The guard is `o.status = 'PENDING_PAYMENT'`, not an expires_at
-- comparison. orders.status is the single source of truth for "is the slot
-- still held" — it only leaves PENDING_PAYMENT when the (not-yet-built)
-- WBS 5.6/5.7 expiry sweep or merchant confirmation runs. payments.expires_at
-- here is a fresh 15-minute UI countdown recomputed on every issuance
-- (initial and reissue alike); it is never capped to orders.expires_at —
-- that would be solving a problem that does not exist at this layer.
create or replace function create_payment_charge(
  p_order_code text,
  p_qr_payload text
) returns table (
  id uuid,
  order_id uuid,
  amount_satang integer,
  expires_at timestamptz,
  status text
)
language sql
security definer
set search_path = public
as $$
  insert into payments (order_id, store_id, method, payee_alias, amount_satang, status, qr_payload, expires_at)
  select o.id, o.store_id, 'promptpay_direct', s.promptpay_id, o.total_satang, 'pending', p_qr_payload, now() + interval '15 minutes'
    from orders o
    join stores s on s.id = o.store_id
   where o.order_code = p_order_code
     and o.status = 'PENDING_PAYMENT'
     and s.promptpay_id is not null
     and s.promptpay_verified_at is not null
  returning id, order_id, amount_satang, expires_at, status;
$$;

-- 0021_rls.sql's standing `alter default privileges ... grant execute on
-- functions to anon, authenticated, service_role` grants EXECUTE directly
-- to those roles on every function created afterwards — a plain
-- `revoke all ... from public` does not touch it (found the hard way by
-- 0025_auth_attempts_atomic_check.sql; same trap 0028/0029 already guard
-- against). Revoke from anon and authenticated explicitly.
revoke all on function create_payment_charge(text, text) from public;
revoke execute on function create_payment_charge(text, text) from anon, authenticated;
grant execute on function create_payment_charge(text, text) to service_role;
