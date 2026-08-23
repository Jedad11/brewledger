-- Bug found merging WBS 6.7 into origin/main: reproduced against a clean
-- origin/main worktree (no WBS 6.7 code at all) -- 0046's own trigger fails
-- on `delete from auth.users` cascade, confirmed pre-existing on origin/main,
-- not something WBS 6.7 introduced.
--
-- 0046's enqueue_menu_item_cost_recalc() fires AFTER INSERT OR UPDATE OR
-- DELETE on bom_lines and unconditionally does
--   insert into menu_item_cost_cache (menu_item_id, store_id, is_stale)
--   values (v_menu_item_id, v_store_id, true)
--   on conflict (menu_item_id) do update ...
-- When a bom_lines row is deleted as a CASCADE side effect of its own
-- parents being deleted (auth.users -> merchants -> stores -> menu_items ->
-- bom_lines, and separately stores -> bom_lines directly, both on delete
-- cascade -- see 0009_bom_lines.sql), this INSERT can name a menu_item_id
-- and/or store_id that is itself mid-deletion in the very same cascading
-- DELETE statement, and menu_item_cost_cache.menu_item_id/store_id are both
-- `references ... on delete cascade`, non-deferrable (0046's own table
-- definition) --
--   error: insert or update on table "menu_item_cost_cache" violates
--   foreign key constraint "menu_item_cost_cache_menu_item_id_fkey"
--
-- SAME BUG CLASS this repo has already hit and fixed twice --
-- order_status_history (0034/0035, WBS 5.7) and ingredient_cost_history
-- (0045, WBS 6.6): a trigger that treats every mutation as a live, direct
-- one instead of distinguishing "someone is actually recording a change"
-- from "this row is disappearing as a side effect of its own parent's
-- deletion". DIFFERENT MECHANISM here, though, and worth being explicit
-- about which:
--   - 0034/0035 guard a BEFORE trigger that BLOCKS a mutation (append-only
--     enforcement on order_status_history/ingredient_cost_history
--     themselves) and had to tell apart "a real RI cascade" from "any other
--     nested-trigger context" using pg_trigger_depth() plus a shape check,
--     because the thing at risk was wrongly *raising an exception* on a
--     legitimate cascade delete of THAT table's own rows.
--   - This trigger does not block anything and does not protect bom_lines
--     itself -- it fires an INSERT into a SEPARATE table
--     (menu_item_cost_cache) as a side effect. The failure here is not
--     "wrongly rejected", it is "wrongly attempted": writing a cache-refresh
--     row for a menu item that is being deleted in the same breath. The fix
--     is a plain existence guard on the parents the INSERT is about to
--     reference, not a trigger-depth/shape test on bom_lines' own mutation --
--     there is nothing to distinguish "direct bom_lines delete" from
--     "cascade-originated bom_lines delete" for THIS purpose, because in
--     BOTH cases the right question is simply "does the menu item this cache
--     row would describe still exist to have a cost recomputed for it?".
--     Skipping the cache-upsert and the job-enqueue when the answer is no is
--     strictly correct on its own terms, not just a workaround: there is no
--     value in enqueuing a cost_recalc for a menu item that is mid-deletion,
--     and menu_item_cost_cache's own `on delete cascade` will remove any
--     existing cache row for it anyway once the delete completes.
--
-- WHICH PARENT(S) TO CHECK -- reasoned from the actual FK topology, not
-- assumed: menu_item_cost_cache has two FKs that could each be the one
-- about to fail --
--   menu_item_id references menu_items(id) on delete cascade
--   store_id     references stores(id)     on delete cascade
-- bom_lines (0009_bom_lines.sql) itself carries BOTH
--   menu_item_id references menu_items(id) on delete cascade
--   store_id     references stores(id)     on delete cascade
-- as two INDEPENDENT cascade paths from the SAME `delete from stores`
-- event (menu_items.store_id also references stores(id) on delete cascade,
-- 0005_menu_items.sql) -- one hop via store_id directly, two hops via
-- menu_items. Postgres does not document or guarantee an ordering between
-- sibling RI cascade actions fired off one parent delete, so a bom_lines row
-- can be cascade-deleted via ITS OWN store_id FK before the menu_items row
-- it points at has been cascade-deleted via menu_items' OWN store_id FK --
-- at that moment menu_items.id = v_menu_item_id can still resolve (not yet
-- processed) even though the stores row driving the whole cascade is
-- already gone (a parent's ON DELETE CASCADE RI trigger fires only after
-- the parent row itself is deleted, so `stores` is unconditionally gone
-- before ANY of its cascade children start firing). Checking menu_items
-- alone is therefore NOT sufficient by itself for the store-cascade path --
-- it would insert a menu_item_cost_cache row whose store_id no longer
-- resolves, hitting menu_item_cost_cache_store_id_fkey instead of the
-- menu_item_id one. This is exactly 0045's own finding for
-- ingredient_cost_history, which checks ingredient_id OR store_id missing,
-- not ingredient_id alone -- applying the same reasoning here, not copying
-- the code (0045 guards a block-on-mutation trigger; this guards a
-- skip-the-insert trigger, per the mechanism note above), yields the same
-- shape of check: either parent missing is sufficient to skip.
--
-- (For the menu_item_id-direct-cascade path -- a single menu item deleted
-- without its whole store going -- checking menu_items alone already
-- suffices, since menu_items' own on-delete-cascade to bom_lines fires only
-- after the menu_items row is gone. The stores check adds nothing wrong in
-- that path; it is simply already-true and costs one extra lookup.)
create or replace function enqueue_menu_item_cost_recalc()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_menu_item_id uuid;
  v_store_id uuid;
begin
  v_menu_item_id := coalesce(NEW.menu_item_id, OLD.menu_item_id);
  v_store_id := coalesce(NEW.store_id, OLD.store_id);

  if not exists (select 1 from menu_items where id = v_menu_item_id)
     or not exists (select 1 from stores where id = v_store_id) then
    return coalesce(NEW, OLD);
  end if;

  insert into menu_item_cost_cache (menu_item_id, store_id, is_stale)
  values (v_menu_item_id, v_store_id, true)
  on conflict (menu_item_id) do update set is_stale = true;

  insert into job_queue (store_id, job_type, payload)
  values (v_store_id, 'cost_recalc', jsonb_build_object('menuItemIds', to_jsonb(array[v_menu_item_id])));

  return coalesce(NEW, OLD);
end;
$$;

-- 0021_rls.sql's standing `alter default privileges` grants EXECUTE to
-- anon/authenticated/service_role on every function created afterwards --
-- explicitly revoked here, same trap/fix documented in 0025/0028/0029/0030/
-- 0031/0040/0044/0045/0046. `create or replace` does not reset an existing
-- ACL, so this is redundant with 0046's own revoke -- kept anyway per this
-- repo's convention of repeating the fix rather than relying on a prior
-- migration's ACL still being intact.
revoke all on function enqueue_menu_item_cost_recalc() from public;
revoke execute on function enqueue_menu_item_cost_recalc() from anon, authenticated, service_role;
