-- WBS 4.1 — second-layer OTP rate limiting (beyond Supabase's own
-- auth.rate_limit), both buckets (phone_hash 5/hour, ip_hash 20/hour)
-- enforced from the single call site that sees both: console-auth-
-- request-otp (supabase/functions/console-auth-request-otp/index.ts), the
-- only point in the request path that has the caller's phone number, the
-- caller's IP, AND runs before Supabase Auth's own (Vonage-backed) phone
-- provider ever sends anything. An earlier draft split this across a second
-- Edge Function (a custom Auth Send SMS Hook, which sees phone but never IP)
-- and this table's own two-call-site design followed from that split; the
-- hook was removed before ever running against real credentials, and both
-- checks now live in console-auth-request-otp alone. See docs/ops/auth.md.
--
-- Same shape as job_queue (WBS 3.6 §2.2): RLS enabled, ZERO policies. Only
-- service_role (which bypasses RLS entirely) may touch this table — no
-- anon/authenticated policy is ever appropriate here, so none is written.
-- Do not add one without re-reading this comment first.
--
-- phone_hash/ip_hash are HMAC-SHA256, not raw values and not bare SHA-256:
-- a Thai mobile number is 9 digits after the country code, small enough that
-- unsalted SHA-256 is reversible by brute force in well under a second on
-- commodity hardware. The HMAC key (AUTH_ATTEMPTS_HASH_SALT) lives only in
-- Edge Function secrets, never in this schema.
create table if not exists auth_attempts (
  id uuid primary key default gen_random_uuid(),
  phone_hash text,
  ip_hash text,
  attempted_at timestamptz not null default now()
);

alter table auth_attempts enable row level security;

create index if not exists auth_attempts_phone_hash_idx
  on auth_attempts (phone_hash, attempted_at);
create index if not exists auth_attempts_ip_hash_idx
  on auth_attempts (ip_hash, attempted_at);
