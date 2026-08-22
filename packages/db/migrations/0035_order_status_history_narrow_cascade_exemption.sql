-- redline_reviewer finding on 0034: `pg_trigger_depth() > 1` exempts ANY
-- nested-trigger context, not specifically the two legitimate RI-cascade
-- cases (order_id's parent order being deleted; actor's parent merchant
-- being deleted). Reproduced live: an unrelated AFTER INSERT trigger on a
-- scratch table that directly UPDATEs order_status_history.to_status runs at
-- depth 2 and slipped through unblocked. Depth alone cannot tell "a real RI
-- cascade" from "any other trigger nesting" — replace it with a check that
-- the mutation is actually shaped like one of the two known cascades:
--   DELETE: only if OLD.order_id no longer resolves in orders (the parent
--     order really was just deleted).
--   UPDATE: only if it is exactly the actor SET NULL side effect (NEW.actor
--     IS NULL, OLD.actor IS NOT NULL) AND OLD.actor no longer resolves in
--     merchants (the parent merchant really was just deleted).
-- Depth 1 (any direct top-level UPDATE/DELETE) still always raises,
-- unchanged from 0032/0034. Any depth > 1 mutation that doesn't match one of
-- the two shapes above also still raises.
create or replace function prevent_order_status_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    if TG_OP = 'DELETE' then
      if not exists (select 1 from orders where id = OLD.order_id) then
        return old;
      end if;
    elsif TG_OP = 'UPDATE' then
      if NEW.actor is null and OLD.actor is not null
         and not exists (select 1 from merchants where id = OLD.actor) then
        return new;
      end if;
    end if;
  end if;

  raise exception
    'order_status_history is append-only (WBS 5.7) — a transition audit trail that can be edited after the fact is not an audit trail; insert a new row instead';
end;
$$;
