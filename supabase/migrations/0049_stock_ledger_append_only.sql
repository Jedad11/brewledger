-- WBS 6.8 -- Automatic Stock Deduction and Stock Ledger: append-only
-- enforcement, genuinely missing until now.
--
-- The deduction/reversal writers already exist and are untouched by this
-- migration: transition_order() (0032, PENDING_PAYMENT -> ACCEPTED 'sale'
-- rows and *->CANCELLED 'cancellation_reversal' rows) and
-- console_confirm_purchase_invoice() (0044/0045, 'purchase' rows). What has
-- never existed is anything stopping a row from being UPDATEd or DELETEd
-- after insert -- append-only was described in 0017's own header comment
-- ("Append-only. Stock level is DERIVED from this, never overwritten in
-- place.") but never enforced. A stock number a merchant disputes must be
-- traceable to the exact movements that produced it, and a mutable ledger
-- cannot do that (WBS 6.8 Scope).
--
-- SAME append-only-vs-cascade problem this repo has hit and fixed for
-- order_status_history (0032/0034/0035, WBS 5.7) and ingredient_cost_history
-- (0045, WBS 6.6) -- applying the same narrow-shape approach directly, not
-- the depth-only version 0034 tried first and 0035 had to correct.
-- stock_ledger (0017_stock_ledger.sql) carries FOUR foreign keys, one more
-- than either precedent:
--   store_id             -> stores(id)             on delete cascade
--   ingredient_id        -> ingredients(id)         on delete cascade
--   order_id             -> orders(id)              on delete set null
--   purchase_invoice_id  -> purchase_invoices(id)   on delete set null
-- and orders.store_id / purchase_invoices.store_id / ingredients.store_id
-- all themselves reference stores(id) on delete cascade (0008/0011/0015). So
-- one `delete from stores` (itself reachable via merchants -> stores from a
-- `delete from auth.users`, the same chain 0034 exercises) fans out into
-- several independent, unordered RI actions that can each touch a given
-- stock_ledger row: this row's OWN store_id cascade deletes it directly;
-- this row's OWN ingredient_id cascade ALSO deletes it directly, since the
-- referenced ingredient's store cascades in the same top-level delete; the
-- row's order_id's parent order being cascade-deleted (via orders.store_id)
-- fires a SET NULL update on order_id; and the row's purchase_invoice_id's
-- parent invoice being cascade-deleted (via purchase_invoices.store_id)
-- fires a SET NULL update on purchase_invoice_id. Postgres does not
-- guarantee these interleave in any particular order relative to each other
-- (0035's own finding) -- the exemption below checks SHAPE (does the
-- specific parent this mutation implies really no longer exist), exactly
-- 0035/0045's fix, not merely pg_trigger_depth(). DELETE is exempted only
-- when OLD.store_id no longer resolves in stores OR OLD.ingredient_id no
-- longer resolves in ingredients (either parent gone is sufficient -- same
-- reasoning 0045 applies for its own two-cascade-FK case). UPDATE is
-- exempted only when it is exactly an order_id SET NULL shape with the
-- parent order gone, or exactly a purchase_invoice_id SET NULL shape with
-- the parent invoice gone. Depth 1 (any direct top-level UPDATE/DELETE)
-- always raises, and any depth > 1 mutation matching none of the shapes
-- above also still raises -- an append-only ledger that silently let
-- through anything merely nested would not be one.
--
-- Scope of the guarantee: this holds against UPDATE/DELETE from any role
-- holding only the standard PostgREST grants (anon/authenticated/
-- service_role via PostgREST) -- the trigger fires regardless of role for
-- both statement forms. It does NOT cover TRUNCATE (row-level BEFORE
-- UPDATE/DELETE triggers never fire on TRUNCATE, and no statement-level
-- BEFORE TRUNCATE trigger exists here) or ALTER TABLE ... DISABLE TRIGGER,
-- and it cannot cover a session holding the direct DATABASE_URL credential
-- (worker/src/db.ts's connection, documented elsewhere as already bypassing
-- RLS entirely) -- that credential holds table-owner-level privilege and
-- could issue either statement with zero resistance, though no code path
-- today does. Same posture, and the same unaddressed gap, as
-- order_status_history (0032/0034/0035) and ingredient_cost_history (0045).
create or replace function prevent_stock_ledger_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    if TG_OP = 'DELETE' then
      if not exists (select 1 from stores where id = OLD.store_id)
         or not exists (select 1 from ingredients where id = OLD.ingredient_id) then
        return old;
      end if;
    elsif TG_OP = 'UPDATE' then
      if NEW.order_id is null and OLD.order_id is not null
         and not exists (select 1 from orders where id = OLD.order_id) then
        return new;
      end if;
      if NEW.purchase_invoice_id is null and OLD.purchase_invoice_id is not null
         and not exists (select 1 from purchase_invoices where id = OLD.purchase_invoice_id) then
        return new;
      end if;
    end if;
  end if;

  raise exception
    'stock_ledger is append-only (WBS 6.8) -- a stock number a merchant disputes must be traceable to the exact movements that produced it; insert a new compensating row instead (reason ''cancellation_reversal'' or ''adjustment'')';
end;
$$;

drop trigger if exists trg_stock_ledger_append_only on stock_ledger;
create trigger trg_stock_ledger_append_only
  before update or delete on stock_ledger
  for each row
  execute function prevent_stock_ledger_mutation();

-- 0021_rls.sql's standing `alter default privileges` grants EXECUTE to
-- anon/authenticated/service_role on every function created afterwards --
-- repeating the revoke here per this repo's standing convention
-- (0025/0028/.../0045/0046/0048 all document the same trap).
revoke all on function prevent_stock_ledger_mutation() from public;
revoke execute on function prevent_stock_ledger_mutation() from anon, authenticated, service_role;

-- Defensive, not a confirmed-necessary fix: 0045's own header comment
-- documents that the "an unrelated SET NULL update re-validates a different,
-- non-deferred FK on the same row" mechanism was tested directly against a
-- real Postgres 17 instance for ingredient_cost_history's own topology and
-- found FALSE. Kept here anyway, by the same structural analogy 0045 itself
-- argues for: deferring a constraint only delays its check to end-of-
-- transaction and can never hide a real violation, so it costs nothing and
-- cannot make correctness worse. store_id and ingredient_id are the two
-- CASCADE-shaped FKs reachable from the same `stores` deletion that also
-- drives order_id/purchase_invoice_id's SET NULL actions -- if some future
-- Postgres version (or an interleaving this repo's tests have not forced)
-- ever does make one of them a "victim", both are already covered.
-- order_id/purchase_invoice_id are deliberately left non-deferrable, same
-- reasoning as ingredient_cost_history.source_invoice_id: a SET NULL
-- action's own FK check trivially passes when writing NULL, since NULL
-- always satisfies a foreign key -- there is no failure mode for it to
-- guard against.
alter table stock_ledger
  alter constraint stock_ledger_store_id_fkey
  deferrable initially deferred;

alter table stock_ledger
  alter constraint stock_ledger_ingredient_id_fkey
  deferrable initially deferred;
