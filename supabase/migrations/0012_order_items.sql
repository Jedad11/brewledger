create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  store_id uuid not null,                             -- denormalised for RLS scoping
  menu_item_id uuid references menu_items(id) on delete set null,
  item_name_snapshot text not null,                   -- name at time of sale
  quantity integer not null check (quantity > 0),
  unit_price_snapshot_satang integer not null,
  unit_cost_snapshot_satang integer,                  -- NULL, never 0, when no BOM (RL-2)
  options_snapshot jsonb not null default '[]'::jsonb
);

comment on column order_items.unit_cost_snapshot_satang is
  'Historical truth, frozen at sale. NULL when the menu item had no bom_lines
   at time of sale (RL-2) — never 0, which would silently claim a 100% margin.
   Protected from UPDATE by trg_order_items_cost_snapshot_immutable. A latte
   sold 1 March at 12 THB cost must still report 12 THB cost on 1 April even
   after milk rises to 15 THB — otherwise last month''s P&L changes every time
   an ingredient price moves.';

create index if not exists order_items_order_id_idx on order_items (order_id);
create index if not exists order_items_store_id_idx on order_items (store_id);
create index if not exists order_items_menu_item_id_idx on order_items (menu_item_id);

drop trigger if exists trg_order_items_cost_snapshot_immutable on order_items;
create trigger trg_order_items_cost_snapshot_immutable
  before update on order_items
  for each row
  execute function prevent_cost_snapshot_update();
