-- WBS 5.10 — redline_reviewer finding (2026-08-22): order_lookup_attempts'
-- only bucket was ip_hash, and extractClientIp's first-x-forwarded-for-entry
-- read (ported from console-auth-request-otp, itself already documented as
-- spoofable by any caller with direct API access — see that file's own
-- 2026-08-19 finding, supabase/functions/console-auth-request-otp/index.ts)
-- makes the ip_hash bucket a no-op against a scripted caller: a fresh
-- spoofed octet buys a fresh 20/hour budget every request. Reproduced live:
-- 25 requests against one order, rotating x-forwarded-for by one octet each
-- time, all returned 200 — none blocked.
--
-- Unlike console-auth-request-otp, this endpoint had no second, non-spoofable
-- bucket to fall back on — its ip_hash bucket WAS the entire defense.
--
-- Decision: add a phone_hash bucket, not a phone+code bucket. Reasoning
-- (see also supabase/functions/public-order-status/index.ts's updated
-- comment):
--   - The code-only branch (public_order_status) is deliberately NEVER
--     rate-limited (it's what /o/[code] polls every 5s for real customers
--     behind shared shop wifi) and returns full status for a bare
--     order_code, no phone required. An attacker who already holds a valid
--     code gains nothing extra from the phone+code branch, so that is not
--     the risk this bucket needs to cover.
--   - A bucket keyed on the GUESSED (phone, code) PAIR would not bound the
--     attack that matters here: every new guess is a fresh pair, so a
--     pair-keyed bucket resets on every attempt exactly the way the
--     spoofed-ip_hash bucket already does. It would look like a fix and not
--     be one.
--   - The attack this branch actually enables is narrower and more
--     concerning than random pair-guessing: an attacker who already knows
--     (or has specifically targeted) a real phone number — a rival, an
--     ex-partner, anyone whose number is simply known socially — and wants
--     to enumerate order_codes against it, searching the 28^6 (~482M)
--     keyspace WBS 5.4 sized specifically to resist this, while rotating
--     fake IPs to dodge ip_hash. A bucket keyed on phone_hash ALONE bounds
--     exactly that: it counts attempts against a given phone number
--     regardless of which code was guessed or which IP (real or spoofed)
--     sent the request, so it cannot be rotated away from the way ip_hash
--     can.
--   - Phone numbers rotate too, in principle, but rotating the phone
--     abandons the "targeted victim" attack (the one with a real, harmed
--     party) for undirected mass-pair-guessing, which is already what the
--     482M-keyspace order_code is sized to make impractical even with zero
--     rate limiting.
--
-- Mirrors console-auth-request-otp's own two-bucket shape (phone_hash
-- checked first as "the real backstop", ip_hash checked second as a coarse,
-- known-spoofable defense-in-depth signal against unsophisticated scripts —
-- see that function's header comment) but does NOT copy its numbers: OTP's
-- 5/hour phone cap exists to bound real SMS cost/harassment against a real
-- recipient; this cap only bounds enumeration attempts, so it reuses the
-- 20/hour figure already justified in public-order-status/index.ts as
-- "generous for a real person, meaningfully bounding for a script."
--
-- Table/function reshaped to match auth_attempts' own (column, hash) shape
-- (0024_auth_attempts.sql / 0025_auth_attempts_atomic_check.sql) rather than
-- bolting on a second parallel function, so both rate limiters read the same
-- way. The ip_hash-only record_order_lookup_attempt_if_allowed(text, int)
-- from 0036 is dropped and replaced, not left as a second overload —
-- _shared/public/rateLimit.ts is the only caller. 0036/0037 are not edited
-- in place.
alter table order_lookup_attempts add column if not exists phone_hash text;
alter table order_lookup_attempts alter column ip_hash drop not null;

create index if not exists order_lookup_attempts_phone_hash_idx
  on order_lookup_attempts (phone_hash, attempted_at);

drop function if exists record_order_lookup_attempt_if_allowed(text, int);

create or replace function record_order_lookup_attempt_if_allowed(
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
    raise exception 'record_order_lookup_attempt_if_allowed: invalid column %', p_column;
  end if;

  -- Lock keyed on (table, column, hash) so a burst against one phone
  -- number/IP serialises without blocking unrelated buckets, and without
  -- colliding with auth_attempts' own advisory locks which key on
  -- ('phone_hash' | 'ip_hash') || ':' || hash alone.
  perform pg_advisory_xact_lock(hashtext('order_lookup_attempts:' || p_column || ':' || p_hash));

  if p_column = 'phone_hash' then
    select count(*) < p_max_per_hour into v_allowed
    from order_lookup_attempts
    where phone_hash = p_hash and attempted_at >= now() - interval '1 hour';

    if v_allowed then
      insert into order_lookup_attempts (phone_hash) values (p_hash);
    end if;
  else
    select count(*) < p_max_per_hour into v_allowed
    from order_lookup_attempts
    where ip_hash = p_hash and attempted_at >= now() - interval '1 hour';

    if v_allowed then
      insert into order_lookup_attempts (ip_hash) values (p_hash);
    end if;
  end if;

  return v_allowed;
end;
$$;

-- Same posture as 0025/0036: `revoke all ... from public` alone is not
-- enough because 0021_rls.sql's standing default grants EXECUTE directly to
-- the anon/authenticated ROLES on every function created afterwards.
revoke all on function record_order_lookup_attempt_if_allowed(text, text, int) from public;
revoke execute on function record_order_lookup_attempt_if_allowed(text, text, int) from anon, authenticated;
grant execute on function record_order_lookup_attempt_if_allowed(text, text, int) to service_role;
