create table if not exists order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  menu_option_id uuid references menu_options(id) on delete set null,  -- nullable: menu can change later
  option_group_name_snapshot text not null,
  option_name_snapshot text not null,
  price_delta_snapshot_satang integer not null default 0
);

create index if not exists order_item_options_order_item_id_idx on order_item_options (order_item_id);
create index if not exists order_item_options_menu_option_id_idx on order_item_options (menu_option_id);
