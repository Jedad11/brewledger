-- ============================================================================
-- WBS 3.8 — SUPABASE STORAGE FOR BILL IMAGES: bucket-scoped RLS on
-- storage.objects. RL-3 touch: a supplier invoice contains purchase prices,
-- exactly the data RL-3 protects. The `bills` bucket is never public.
-- ============================================================================
--
-- Bucket creation itself is a manual dashboard step on brewledger-dev/
-- brewledger-prod (see BrewLedger_WBS_Dictionary.md WBS 3.8's Thai manual
-- action block) and, for the local Docker stack, a declarative
-- `[storage.buckets.*]` block in supabase/config.toml (applied by
-- `supabase start`, not by this migration). This migration only adds the
-- policies on storage.objects -- it is correct and idempotent whether or not
-- the buckets already exist, because a policy predicate referencing
-- bucket_id = 'bills' never requires the row to be present in
-- storage.buckets first; it simply never matches until it is.
--
-- Path convention (both buckets): {store_id}/{file}.ext -- the bucket_id
-- column already scopes by bucket, so the object name itself starts with
-- the store folder, not a second "bills/" prefix (storage.foldername(name))
-- splits on '/' within the object name, so (storage.foldername(name))[1] is
-- the FIRST path segment of `name`, i.e. the store_id folder:
--   bucket_id = 'bills', name = '{store_id}/{invoice_id}.jpg'
--   bucket_id = 'menu-images', name = '{store_id}/{menu_item_id}.webp'

-- SECTION 1: bills -- PRIVATE, merchant-scoped, no anon policy of any kind.

drop policy if exists merchant_insert_bills on storage.objects;
create policy merchant_insert_bills on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'bills'
    and (storage.foldername(name))[1]::uuid in (select auth_store_ids())
  );

drop policy if exists merchant_select_bills on storage.objects;
create policy merchant_select_bills on storage.objects
  for select to authenticated
  using (
    bucket_id = 'bills'
    and (storage.foldername(name))[1]::uuid in (select auth_store_ids())
  );

drop policy if exists merchant_delete_bills on storage.objects;
create policy merchant_delete_bills on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'bills'
    and (storage.foldername(name))[1]::uuid in (select auth_store_ids())
  );

-- Deliberately no `for update` policy and NO anon policy of any kind on
-- `bills` -- a supplier invoice reveals purchase prices, precisely the data
-- RL-3 protects. If a caller ever needs to add an anon policy here, that is
-- itself the RL-3 violation, not a missing feature.

-- SECTION 2: menu-images -- PUBLIC READ, merchant-scoped writes.

drop policy if exists anon_select_menu_images on storage.objects;
create policy anon_select_menu_images on storage.objects
  for select to anon
  using (bucket_id = 'menu-images');

drop policy if exists merchant_insert_menu_images on storage.objects;
create policy merchant_insert_menu_images on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'menu-images'
    and (storage.foldername(name))[1]::uuid in (select auth_store_ids())
  );

drop policy if exists merchant_select_menu_images on storage.objects;
create policy merchant_select_menu_images on storage.objects
  for select to authenticated
  using (
    bucket_id = 'menu-images'
    and (storage.foldername(name))[1]::uuid in (select auth_store_ids())
  );

drop policy if exists merchant_update_menu_images on storage.objects;
create policy merchant_update_menu_images on storage.objects
  for update to authenticated
  using (
    bucket_id = 'menu-images'
    and (storage.foldername(name))[1]::uuid in (select auth_store_ids())
  )
  with check (
    bucket_id = 'menu-images'
    and (storage.foldername(name))[1]::uuid in (select auth_store_ids())
  );

drop policy if exists merchant_delete_menu_images on storage.objects;
create policy merchant_delete_menu_images on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'menu-images'
    and (storage.foldername(name))[1]::uuid in (select auth_store_ids())
  );
