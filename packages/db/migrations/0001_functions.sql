create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function prevent_cost_snapshot_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.unit_cost_snapshot_satang is distinct from old.unit_cost_snapshot_satang then
    raise exception
      'order_items.unit_cost_snapshot_satang is immutable after insert (WBS 3.5 cost-snapshot rule) — insert a new order_item or a stock_ledger adjustment row instead, never rewrite historical cost';
  end if;
  return new;
end;
$$;
