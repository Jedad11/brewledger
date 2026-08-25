-- WBS 5.8/7.1's Realtime feed (useOrdersFeed.ts, useDashboardSummary.ts) and
-- WBS 5.1's live menu availability (apps/shop's MenuList.tsx) both subscribe
-- to postgres_changes on `orders`/`menu_items` -- but no migration has ever
-- added either table to the `supabase_realtime` publication, so those
-- subscriptions have never fired on any project this migration chain has
-- touched (confirmed live on brewledger-dev: `select * from
-- pg_publication_tables where pubname = 'supabase_realtime'` returned zero
-- rows). Every affected screen still works via its own mandatory polling
-- fallback (10s for orders, per interaction_spec.md's own "primary path for
-- iPhone users, not a fallback nicety" framing) -- this migration is about
-- making updates arrive instantly rather than up to 10s late, not about a
-- screen being broken outright.
--
-- Guarded with a existence check rather than a bare ADD TABLE: ALTER
-- PUBLICATION ... ADD TABLE errors on a table already in the publication,
-- and this project's publication membership has so far only ever been
-- managed ad hoc (Studio UI clicks against whichever project a
-- session happened to be linked to, never a migration) -- a re-run must not
-- assume its own starting state.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table orders;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'menu_items'
  ) then
    alter publication supabase_realtime add table menu_items;
  end if;
end $$;
