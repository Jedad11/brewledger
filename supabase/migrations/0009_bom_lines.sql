-- RL-2: OPTIONAL. A menu_item is sellable with zero rows here.
create table if not exists bom_lines (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete restrict,
  qty_base_unit numeric(14,4) not null check (qty_base_unit > 0),
  unique (menu_item_id, ingredient_id)
);

create index if not exists bom_lines_ingredient_id_idx on bom_lines (ingredient_id);
