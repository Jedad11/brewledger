-- WBS 4.1 — atomic check-and-record for the OTP rate limiter (redline_reviewer
-- finding, 2026-08-19: the previous SELECT-count-then-INSERT in
-- supabase/functions/_shared/auth/rateLimit.ts was two separate PostgREST
-- round trips, not one transaction — N concurrent requests for the same
-- phone/IP within the same window could all read the same under-the-limit
-- count before any insert landed, letting a burst exceed 5/hour or 20/hour).
--
-- This function does the count-check and the insert in one statement inside
-- one implicit PostgREST-RPC transaction, serialised per (column, hash) by a
-- transaction-scoped advisory lock (auto-released at the end of that single
-- transaction — an RPC call is one statement, so there is nothing to leak).
-- Two concurrent calls for the same hash now genuinely queue behind each
-- other instead of racing on a stale read.
create or replace function record_auth_attempt_if_allowed(
  p_column text,
  p_hash text,
  p_max_per_hour int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  if p_column not in ('phone_hash', 'ip_hash') then
    raise exception 'record_auth_attempt_if_allowed: invalid column %', p_column;
  end if;

  -- Lock keyed on (column, hash) so a burst against one phone number/IP
  -- serialises without blocking unrelated buckets.
  perform pg_advisory_xact_lock(hashtext(p_column || ':' || p_hash));

  if p_column = 'phone_hash' then
    select count(*) < p_max_per_hour into v_allowed
    from auth_attempts
    where phone_hash = p_hash and attempted_at >= now() - interval '1 hour';

    if v_allowed then
      insert into auth_attempts (phone_hash) values (p_hash);
    end if;
  else
    select count(*) < p_max_per_hour into v_allowed
    from auth_attempts
    where ip_hash = p_hash and attempted_at >= now() - interval '1 hour';

    if v_allowed then
      insert into auth_attempts (ip_hash) values (p_hash);
    end if;
  end if;

  return v_allowed;
end;
$$;

-- Only service_role calls this (via console-auth-request-otp's service
-- client, same access shape as auth_attempts itself — see 0024's own
-- comment). No anon/authenticated grant is ever appropriate here.
--
-- `revoke all ... from public` alone is NOT enough: 0021_rls.sql's own
-- `alter default privileges in schema public grant execute on functions to
-- anon, authenticated, service_role` runs as a standing default and grants
-- EXECUTE directly to the anon and authenticated ROLES on every function
-- created afterwards, not to the PUBLIC pseudo-role — so a plain
-- `revoke ... from public` leaves anon/authenticated able to call this
-- SECURITY DEFINER function directly over PostgREST with the public anon
-- key, bypassing console-auth-request-otp's phone/IP validation entirely
-- (found by querying has_function_privilege('anon', ...) after applying
-- this migration as originally written — it returned true). Revoke from
-- anon and authenticated explicitly, the same two roles the default grant
-- names.
revoke all on function record_auth_attempt_if_allowed(text, text, int) from public;
revoke execute on function record_auth_attempt_if_allowed(text, text, int) from anon, authenticated;
grant execute on function record_auth_attempt_if_allowed(text, text, int) to service_role;
