-- ============================================================================
-- WBS 3.6 — ROW LEVEL SECURITY: PRIMARY ENFORCEMENT POINT OF RL-3
-- ============================================================================
-- Design: docs/db/rls_design.md. This migration enables RLS on every real
-- table (18), adds deny-by-default merchant/anon policies per the design's
-- §2 decision table, and exposes customer order lookup through two
-- security-definer RPCs rather than a table-level anon policy on
-- orders/order_items. Do not add a table-level anon policy on
-- menu_categories or job_queue without re-reading docs/db/rls_design.md §2.1
-- and §2.2 first — both omissions are deliberate.
-- ============================================================================

-- SECTION 0: PostgREST role grants
--
-- A hosted Supabase project's own bootstrap already grants anon/authenticated/
-- service_role broad table-level privileges in schema public (verified: the
-- engineer leg's ad hoc curl tests against the real linked brewledger-dev
-- project returned correctly-filtered [] results, not 42501 permission
-- errors). A fresh LOCAL `supabase start` does not reproduce that bootstrap
-- and `supabase/config.toml`'s `auto_expose_new_tables` does not default to
-- exposing new tables on this CLI version, so every PostgREST request 42501s
-- regardless of RLS -- found by qa_engineer's adversarial suite failing 42/51
-- assertions on permission-denied rather than a real filtering defect.
--
-- This is SAFE to grant broadly: every table below has RLS enabled (SECTION
-- 1) with an explicit deny-by-default policy set (or no policy at all, e.g.
-- job_queue/menu_categories per §2.1/§2.2) -- a GRANT only permits the
-- *attempt*; RLS decides which rows, if any, are actually visible. This
-- mirrors Supabase's own hosted-project convention rather than depending on
-- an implicit, CLI-version-dependent local-only toggle, so local and hosted
-- behave identically.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- SECTION 1: enable RLS on every table (§1)

alter table merchants            enable row level security;
alter table stores               enable row level security;
alter table menu_categories      enable row level security;
alter table menu_items           enable row level security;
alter table menu_option_groups   enable row level security;
alter table menu_options         enable row level security;
alter table ingredients          enable row level security;
alter table bom_lines            enable row level security;
alter table pickup_slots         enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table order_item_options   enable row level security;
alter table payments             enable row level security;
alter table stock_ledger         enable row level security;
alter table purchase_invoices    enable row level security;
alter table purchase_line_items  enable row level security;
alter table job_queue            enable row level security;
alter table daily_financials     enable row level security;

-- SECTION 2: auth_store_ids() helper (§3)

create or replace function auth_store_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from stores s
  join merchants m on m.id = s.merchant_id
  where m.auth_user_id = auth.uid();
$$;

-- SECTION 3: merchant policies, direct-store_id tables (§3)

drop policy if exists merchant_rw_stores on stores;
create policy merchant_rw_stores on stores
  for all to authenticated
  using      (id in (select auth_store_ids()))
  with check (id in (select auth_store_ids()));

drop policy if exists merchant_rw_menu_categories on menu_categories;
create policy merchant_rw_menu_categories on menu_categories
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_menu_items on menu_items;
create policy merchant_rw_menu_items on menu_items
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_menu_option_groups on menu_option_groups;
create policy merchant_rw_menu_option_groups on menu_option_groups
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_ingredients on ingredients;
create policy merchant_rw_ingredients on ingredients
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_bom_lines on bom_lines;
create policy merchant_rw_bom_lines on bom_lines
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_pickup_slots on pickup_slots;
create policy merchant_rw_pickup_slots on pickup_slots
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_orders on orders;
create policy merchant_rw_orders on orders
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_order_items on order_items;
create policy merchant_rw_order_items on order_items
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_payments on payments;
create policy merchant_rw_payments on payments
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_stock_ledger on stock_ledger;
create policy merchant_rw_stock_ledger on stock_ledger
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_purchase_invoices on purchase_invoices;
create policy merchant_rw_purchase_invoices on purchase_invoices
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_purchase_line_items on purchase_line_items;
create policy merchant_rw_purchase_line_items on purchase_line_items
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

drop policy if exists merchant_rw_daily_financials on daily_financials;
create policy merchant_rw_daily_financials on daily_financials
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

-- SECTION 4: merchant policies, one-join tables + merchants itself (§3)

drop policy if exists merchant_rw_menu_options on menu_options;
create policy merchant_rw_menu_options on menu_options
  for all to authenticated
  using (
    option_group_id in (
      select id from menu_option_groups
      where store_id in (select auth_store_ids())
    )
  )
  with check (
    option_group_id in (
      select id from menu_option_groups
      where store_id in (select auth_store_ids())
    )
  );

drop policy if exists merchant_rw_order_item_options on order_item_options;
create policy merchant_rw_order_item_options on order_item_options
  for all to authenticated
  using (
    order_item_id in (
      select id from order_items
      where store_id in (select auth_store_ids())
    )
  )
  with check (
    order_item_id in (
      select id from order_items
      where store_id in (select auth_store_ids())
    )
  );

drop policy if exists merchant_rw_self on merchants;
create policy merchant_rw_self on merchants
  for all to authenticated
  using      (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- SECTION 5: the four anon SELECT policy groups (§4)

drop policy if exists anon_read_published_stores on stores;
create policy anon_read_published_stores on stores
  for select to anon
  using (is_published = true);

drop policy if exists anon_read_published_menu_items on menu_items;
create policy anon_read_published_menu_items on menu_items
  for select to anon
  using (
    availability <> 'hidden'
    and store_id in (select id from stores where is_published = true)
  );

drop policy if exists anon_read_menu_option_groups on menu_option_groups;
create policy anon_read_menu_option_groups on menu_option_groups
  for select to anon
  using (
    store_id in (select id from stores where is_published = true)
    and menu_item_id in (select id from menu_items where availability <> 'hidden')
  );

drop policy if exists anon_read_menu_options on menu_options;
create policy anon_read_menu_options on menu_options
  for select to anon
  using (
    option_group_id in (
      select mog.id
      from menu_option_groups mog
      join menu_items mi on mi.id = mog.menu_item_id
      join stores s on s.id = mog.store_id
      where mi.availability <> 'hidden'
        and s.is_published = true
    )
  );

drop policy if exists anon_read_open_pickup_slots on pickup_slots;
create policy anon_read_open_pickup_slots on pickup_slots
  for select to anon
  using (
    is_open = true
    and booked_count < capacity
    and slot_start > now()
    and store_id in (select id from stores where is_published = true)
  );

-- SECTION 6: public_order_status / public_order_lookup RPCs (§5)

create or replace function public_order_status(p_order_code text)
returns table (
  order_code text,
  status text,
  pickup_at timestamptz,
  item_name text,
  quantity integer
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
    oi.quantity
  from orders o
  join order_items oi on oi.order_id = o.id
  left join pickup_slots ps on ps.id = o.pickup_slot_id
  where o.order_code = p_order_code;
$$;

revoke all on function public_order_status(text) from public;
grant execute on function public_order_status(text) to anon;

create or replace function public_order_lookup(p_phone text, p_order_code text)
returns table (
  order_code text,
  status text,
  pickup_at timestamptz,
  item_name text,
  quantity integer
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
    oi.quantity
  from orders o
  join order_items oi on oi.order_id = o.id
  left join pickup_slots ps on ps.id = o.pickup_slot_id
  where o.order_code = p_order_code
    and o.customer_phone = p_phone;
$$;

revoke all on function public_order_lookup(text, text) from public;
grant execute on function public_order_lookup(text, text) to anon;
