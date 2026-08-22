-- WBS 5.7 follow-up — qa_engineer bug report on WBS 5.7 testing.
--
-- 0032's append-only trigger on order_status_history raised unconditionally
-- on BEFORE UPDATE OR DELETE, with no exception for a DELETE arriving via
-- ON DELETE CASCADE from a legitimate parent deletion. order_id references
-- orders(id) on delete cascade, chained orders -> stores -> merchants ->
-- auth.users, all on delete cascade. Net effect: once any order for a
-- merchant had a status transition (any order_status_history row at all),
-- that merchant's account could never be deleted through the normal cascade
-- path (account closure, GDPR erasure, admin cleanup) — the trigger fires
-- regardless of role and regardless of whether the DELETE arrived directly
-- or via cascade, so even a superuser DELETE FROM auth.users aborted.
--
-- Fix: gate on pg_trigger_depth(), but NOT at threshold 0 as first proposed.
-- Verified empirically against a live Postgres 17 instance (see WBS 5.7 QA
-- fix report): pg_trigger_depth() is never 0 from *inside* this trigger
-- function's own body — entering any trigger's execution already counts as
-- being "inside a trigger". A direct top-level
-- `delete from order_status_history ...` fires this trigger at depth 1. A
-- cascade-originated delete (this row's own FK's internal RI trigger
-- deleting it as a side effect of a parent delete) fires this trigger
-- nested one level deeper, at depth 2. So the correct guard distinguishing
-- "direct mutation attempt" from "side effect of a legitimate parent
-- deletion" is depth > 1, not depth = 0 — the latter would exempt nothing
-- and leave the bug exactly as it was.
--
-- UPDATE also needs the same exemption, which the original bug report
-- (framed around order_id -> orders ON DELETE CASCADE only) did not
-- anticipate: order_status_history.actor references merchants(id) ON
-- DELETE SET NULL. Deleting a merchant therefore fires two separate
-- cascade-originated operations against this table — the DELETE reached
-- via order_id -> orders -> ... , and independently an UPDATE (the RI
-- SET NULL action) nulling `actor` on any history row that merchant
-- authored. Blocking that UPDATE unconditionally would leave the exact
-- same account-deletion cascade broken, just one FK later. Confirmed by
-- reproducing the two-step failure locally before writing this fix: the
-- DELETE-only exemption still aborted the same `delete from auth.users`
-- cascade, on the SET NULL UPDATE instead of the DELETE.
--
-- For the exempted UPDATE case this returns NEW, not OLD: OLD would
-- silently discard the SET NULL and leave `actor` pointing at a
-- merchants.id that the same cascade is about to remove, which Postgres
-- would then reject as its own FK violation. For the exempted DELETE case
-- this returns OLD, the standard "let the delete proceed unmodified" value
-- for a BEFORE DELETE row trigger.
--
-- A direct, non-cascade UPDATE (pg_trigger_depth() = 1, e.g. someone
-- hand-editing a row's to_status) is still blocked, same as before this
-- migration — only depth > 1 (nested inside another trigger, i.e. a side
-- effect of a parent table's own delete) is exempted.
--
-- Same function signature, `create or replace` per this repo's migration
-- convention (0033's own header) — the existing
-- trg_order_status_history_append_only trigger definition (0032) already
-- points at this function by name and needs no change.
create or replace function prevent_order_status_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    if TG_OP = 'DELETE' then
      return old;
    else
      return new;
    end if;
  end if;

  raise exception
    'order_status_history is append-only (WBS 5.7) — a transition audit trail that can be edited after the fact is not an audit trail; insert a new row instead';
end;
$$;

-- Second, independent bug surfaced only by testing the trigger fix above
-- against a real cascade: exempting the trigger is not sufficient by
-- itself. order_status_history sits under merchants via two different FK
-- paths that both fire as part of one `delete from auth.users` cascade —
-- (a) order_id -> orders -> stores -> merchants, ON DELETE CASCADE, and
-- (b) actor -> merchants directly, ON DELETE SET NULL. Postgres does not
-- guarantee these two RI action queues interleave in dependency order:
-- reproduced locally, the actor SET NULL update on a given
-- order_status_history row can fire before that same row's CASCADE delete
-- (queued via its orders parent) has run, and at that instant the row's own
-- order_id already points at an orders row that a sibling cascade path
-- already removed. order_status_history_order_id_fkey is NOT DEFERRABLE
-- (the default), so its "does order_id still exist" check runs immediately
-- against that transient state and fails — even though the row is about to
-- be deleted anyway by the very same statement, and the full transaction
-- ends in a perfectly consistent state.
--
-- Fix: defer this FK's validation to end of transaction, which is exactly
-- the standard Postgres answer for a constraint that is momentarily
-- unsatisfied mid-cascade but satisfied once the whole statement finishes.
-- This changes only the constraint's check timing, not the relationship it
-- expresses — order_id still cannot reference a nonexistent order once the
-- transaction commits.
alter table order_status_history
  alter constraint order_status_history_order_id_fkey
  deferrable initially deferred;
