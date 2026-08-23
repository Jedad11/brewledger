-- WBS 6.7 -- Suggested BOM and Optional Recipe Editor.
-- RL-2: dismissing a standard-recipe suggestion is permanent and silent --
-- this column is that memory, nothing more. NULL (the default, for every
-- existing and future menu item) means "never dismissed, still eligible for
-- a suggestion"; it is never read as "incomplete" or surfaced anywhere as a
-- deficiency, and setting it never blocks or alters anything else about the
-- item. No new RLS policy needed -- merchant_rw_menu_items (0021_rls.sql)
-- already grants the owning merchant full read/write on every column of
-- their own menu_items row.
alter table menu_items
  add column if not exists recipe_suggestion_dismissed_at timestamptz;

comment on column menu_items.recipe_suggestion_dismissed_at is
  'Set once, the first time the merchant dismisses this item''s standard-
   recipe suggestion. NULL forever if never dismissed or never offered one.
   Never re-offer a suggestion once this is set (WBS 6.7).';
