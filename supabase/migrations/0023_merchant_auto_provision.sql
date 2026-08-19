-- WBS 4.1 — merchant auto-provision on first successful phone-OTP verify.
--
-- Supabase Auth inserts into auth.users the moment verifyOtp succeeds; there
-- is no separate "post-verify hook" event, so the AFTER INSERT trigger below
-- IS the post-verify hook. ON CONFLICT (auth_user_id) DO NOTHING makes it
-- idempotent — a re-run migration or (hypothetically) a replayed insert
-- cannot produce a second merchants row for the same auth user, matching the
-- acceptance criterion "first verification creates exactly one merchants row".
--
-- security definer is required: this function runs as the trigger owner
-- (postgres), not as the newly-inserted auth user, because at the moment of
-- insert there is no session yet for RLS on merchants to authenticate.
create or replace function provision_merchant_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into merchants (auth_user_id, phone, subscription_tier)
  values (new.id, new.phone, 'free')
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_provision_merchant
  after insert on auth.users
  for each row execute function provision_merchant_on_signup();
