-- WBS 5.10 — per-IP rate limiting for public-order-status (both the
-- code-only status check and the phone+code lookup share one bucket, since
-- both are the same brute-force-enumeration surface: an attacker trying to
-- guess a valid order_code by scripted requests). Same shape as WBS 4.1's
-- auth_attempts / record_auth_attempt_if_allowed
-- (packages/db/migrations/0024_auth_attempts.sql,
-- 0025_auth_attempts_atomic_check.sql) — a dedicated table rather than
-- reusing auth_attempts directly, because auth_attempts' ip_hash bucket is
-- shared across BOTH its own phone_hash/ip_hash columns with no "purpose"
-- discriminator; folding order-lookup attempts into the same ip_hash rows
-- would let a merchant's own device (requesting an OTP to log into the
-- console) and a customer polling their order status from behind the same
-- NAT collide into one counter, and would let an attacker burn a login
-- IP-bucket's headroom by hammering the tracking endpoint instead. A
-- second table with an identical atomic check-and-record shape keeps the
-- two rate limits genuinely independent.
--
-- Same shape as job_queue/auth_attempts: RLS enabled, ZERO policies. Only
-- service_role (which bypasses RLS) may touch this table.
create table if not exists order_lookup_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  attempted_at timestamptz not null default now()
);

alter table order_lookup_attempts enable row level security;

create index if not exists order_lookup_attempts_ip_hash_idx
  on order_lookup_attempts (ip_hash, attempted_at);

-- Atomic check-and-record, same technique as
-- record_auth_attempt_if_allowed (0025) — the count-check and the insert
-- happen inside one statement, serialised per ip_hash by a
-- transaction-scoped advisory lock, so concurrent requests from the same IP
-- genuinely queue behind each other instead of racing on a stale read.
create or replace function record_order_lookup_attempt_if_allowed(
  p_ip_hash text,
  p_max_per_hour int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  perform pg_advisory_xact_lock(hashtext('order_lookup_attempts:' || p_ip_hash));

  select count(*) < p_max_per_hour into v_allowed
  from order_lookup_attempts
  where ip_hash = p_ip_hash and attempted_at >= now() - interval '1 hour';

  if v_allowed then
    insert into order_lookup_attempts (ip_hash) values (p_ip_hash);
  end if;

  return v_allowed;
end;
$$;

-- Only service_role calls this. `revoke all ... from public` alone is not
-- enough — 0021_rls.sql's `alter default privileges in schema public grant
-- execute on functions to anon, authenticated, service_role` runs as a
-- standing default and grants EXECUTE directly to the anon/authenticated
-- ROLES on every function created afterwards (found the hard way in 0025's
-- own history) — so anon/authenticated are revoked explicitly here too.
revoke all on function record_order_lookup_attempt_if_allowed(text, int) from public;
revoke execute on function record_order_lookup_attempt_if_allowed(text, int) from anon, authenticated;
grant execute on function record_order_lookup_attempt_if_allowed(text, int) to service_role;
