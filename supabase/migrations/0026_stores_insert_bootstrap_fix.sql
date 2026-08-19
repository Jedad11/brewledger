-- WBS 4.3 hotfix — RLS bootstrap gap on stores INSERT
--
-- merchant_rw_stores (0021_rls.sql) gated ALL commands on stores through
-- auth_store_ids(), which itself queries stores to find rows the calling
-- merchant already owns. For INSERT, WITH CHECK evaluates against the new
-- row before it is committed, so auth_store_ids() can never see it and a
-- merchant can never create their first store:
--   "new row violates row-level security policy for table \"stores\""
-- Reproduced against a real `supabase db reset` + psql session during
-- WBS 4.3 (Store Profile Setup). UPDATE of an existing owned store, and
-- cross-tenant denial, were confirmed working — this is INSERT-only.
--
-- Root cause: stores is the only merchant-owned table that carries
-- merchant_id directly (0003_stores.sql). Every other merchant-owned table
-- only carries store_id and genuinely needs auth_store_ids()'s join through
-- stores -> merchants. stores's own policy never needed that join at all --
-- merchant_id is right there on the row -- so routing it through
-- auth_store_ids() was the mistake, not an INSERT-specific special case.
-- The fix below stops going through stores for its own policy entirely.
--
-- auth_merchant_id() cannot hit the same bootstrap problem because it only
-- reads merchants, never stores -- and the merchants row for this
-- auth_user_id already exists by the time any Owner Console screen runs
-- (WBS 4.1's provision_merchant_on_signup() creates it synchronously on
-- first OTP verify, before a session bearing a merchant JWT can exist).
--
-- auth_store_ids() itself is untouched. Every other merchant_rw_* policy in
-- 0021_rls.sql still routes through it correctly -- none of those tables IS
-- the table auth_store_ids() queries, so none of them share this defect.

create or replace function auth_merchant_id()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id
  from merchants m
  where m.auth_user_id = auth.uid();
$$;

drop policy if exists merchant_rw_stores on stores;
create policy merchant_rw_stores on stores
  for all to authenticated
  using      (merchant_id in (select auth_merchant_id()))
  with check (merchant_id in (select auth_merchant_id()));
