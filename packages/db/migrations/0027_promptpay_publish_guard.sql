-- WBS 4.5 hotfix — RL-1 primary enforcement point moved into the DB layer
--
-- redline_reviewer audit (post-4.5): "a store cannot be published without a
-- verified PromptPay ID" was enforced only in
-- apps/console/src/app/console/(app)/settings/store/actions.ts
-- (saveStoreProfile). merchant_rw_stores (0021_rls.sql,
-- 0026_stores_insert_bootstrap_fix.sql) only checks ownership
-- (merchant_id in (select auth_merchant_id())) -- nothing about
-- promptpay_verified_at. Because apps/console/src/lib/supabase/client.ts
-- hands the browser an authenticated client reading the merchant's own
-- session, any merchant can call
--   supabase.from('stores').update({ is_published: true })
-- directly and skip the Server Action entirely. Same category of gap
-- CLAUDE.md calls out for RL-3: an app-only gate is a suggestion, not a
-- gate, and this is RL-1's primary enforcement point.
--
-- A second path reaches the identical forbidden state -- is_published =
-- true, promptpay_verified_at = null -- through completely ordinary use,
-- no bypass required: savePromptPaySettings
-- (apps/console/src/app/console/(app)/settings/payments/actions.ts) nulls
-- promptpay_verified_at whenever the merchant edits the PromptPay
-- identifier on an already-published store (correct -- the old
-- verification doesn't carry over to a new number) but never touches
-- is_published. A live store then keeps accepting orders against an
-- unverified payee identifier.
--
-- Fix has two parts, applied in this order:
--
-- 1. A BEFORE INSERT OR UPDATE trigger that forces is_published back to
--    false whenever a row's NEW state would otherwise be
--    (is_published = true, promptpay_verified_at is null). This is the
--    PRIMARY mechanism, not a CHECK constraint, deliberately:
--
--    - The direct-bypass write above is silently defeated: the UPDATE
--      still succeeds (200, row written) but the persisted is_published
--      is false, not what the caller asked for -- the same failure shape
--      as RLS's own "unauthorized row is just absent from the result set"
--      posture, rather than a distinguishable error that helps a bypass
--      attempt iterate.
--    - savePromptPaySettings needs NO change to stay correct: its UPDATE
--      only ever sets promptpay_id/type/verified_at, never is_published,
--      so Postgres's NEW row for that statement carries the *unchanged*
--      old is_published alongside the *new* (possibly null)
--      verified_at -- exactly the combination this trigger watches for.
--      The store is auto-unpublished as a side effect, transparently, on
--      the very write that created the risk, with no raw constraint-
--      violation error surfacing through a code path that was never
--      written expecting one.
--    - This matches the project's stated posture for exactly this
--      failure mode (RL-3's own reasoning: don't rely on every future
--      write path remembering to do the right thing) -- a bare CHECK
--      constraint would instead throw 23514 out of savePromptPaySettings
--      the moment a merchant fixed a typo in their PromptPay number,
--      unless the app layer were ALSO changed to null is_published in
--      that same statement -- which reintroduces "only enforced in app
--      code," just relocated to a second Server Action instead of fixed
--      at the root.
--
--    saveStoreProfile's existing app-layer check
--    (PUBLISH_REQUIRES_PROMPTPAY_VERIFICATION) becomes redundant against
--    this trigger but stays in place deliberately -- it is the only
--    source of the friendly Thai copy; the trigger's silent coercion is a
--    backstop for a forged request, not a UX surface.
--
-- 2. A `not valid` CHECK constraint carrying the same invariant, validated
--    against current data in a separate statement. This is intentionally
--    redundant with the trigger under every normal write: Postgres runs
--    BEFORE ROW triggers before it evaluates CHECK constraints on the
--    resulting row, so by the time the constraint is checked, NEW has
--    already been corrected and the constraint never fires in practice.
--    It exists as a backstop independent of the trigger's continued
--    presence -- e.g. a future migration that runs with
--    `session_replication_role = replica` (which suppresses ordinary
--    triggers but NOT check constraints), or a later change that drops or
--    redefines this trigger without carrying the invariant forward. Two
--    independent mechanisms enforcing the same rule is not a conflict:
--    the trigger fires first and makes the constraint moot on the
--    happy path; the constraint is what still holds if the trigger ever
--    doesn't run.
--
-- Before validating the constraint, any row already sitting in the
-- forbidden state is healed the same way the trigger would have healed it
-- going forward -- auto-unpublished, not deleted, not errored. `stores`
-- is a small table (one row per merchant store, not an order-scale
-- table), so this UPDATE and the subsequent VALIDATE CONSTRAINT scan are
-- cheap; there is no long-lock-during-service-hours concern here the way
-- there would be on orders/order_items. Per the environment caveat in
-- CLAUDE.md, no live data has been observed in this environment -- the
-- backfill is included because production-safety requires it be here
-- regardless, not because a bad row is known to exist. Confirm a backup
-- ran within 24h before applying to a production project with real rows,
-- per standard migration discipline.
--
-- FLAGGED, not fixed here (architect scope stops at schema/constraint/
-- trigger design): the auto-unpublish path is currently silent end to
-- end. savePromptPaySettings's result type
-- (SavePromptPayResult / { ok, promptpayId, promptpayType,
-- promptpayVerifiedAt }) does not report is_published at all, so neither
-- the Server Action's caller nor any console UI can tell a store just
-- went offline as a side effect of an identifier edit. This is a real
-- gap: a merchant who fixes a typo in their PromptPay number, without
-- re-verifying, silently stops taking orders with no visible signal
-- anywhere in the product. Recommend a follow-up WBS entry (payments
-- settings screen, WBS 4.5's own surface) to: (a) have
-- savePromptPaySettings select is_published in its RETURNING clause
-- (supabase-js `.update(...).select(...)` returns the row's final
-- post-trigger state for free -- no extra query needed) so the action can
-- report whether the store was just auto-unpublished, and (b) surface
-- that as a visible banner/toast in the payments settings screen per
-- docs/design/state_matrix.md. Not built here -- engineer/UI scope, and
-- needs a state_matrix entry with exact Thai copy before it's built, per
-- CLAUDE.md's design precedence rules.

-- 1. Trigger: force is_published false whenever it would otherwise stand
--    published with no verified PromptPay identifier. Covers INSERT (a
--    hypothetical bulk-import or future write path that sets both columns
--    in one statement) as well as UPDATE (the two real paths above).
create or replace function guard_promptpay_before_publish()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_published and new.promptpay_verified_at is null then
    new.is_published := false;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_promptpay_before_publish on stores;
create trigger guard_promptpay_before_publish
  before insert or update on stores
  for each row
  execute function guard_promptpay_before_publish();

-- 2. Heal any row already in the forbidden state before validating the
--    constraint below (see rationale above -- same correction the trigger
--    applies going forward, applied once to existing rows).
update stores
set is_published = false
where is_published = true
  and promptpay_verified_at is null;

-- 3. CHECK constraint: backstop invariant, independent of the trigger's
--    continued presence. `not valid` + a separate `validate constraint`
--    avoids a long-held lock scanning the table; added here purely as
--    correct general practice since `stores` is small either way.
alter table stores drop constraint if exists stores_publish_requires_verified_promptpay;

alter table stores
  add constraint stores_publish_requires_verified_promptpay
  check (is_published = false or promptpay_verified_at is not null)
  not valid;

alter table stores
  validate constraint stores_publish_requires_verified_promptpay;
