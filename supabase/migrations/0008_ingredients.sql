create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  base_unit text not null check (base_unit in ('g','ml','piece')),
  current_unit_cost_satang integer,                   -- null until a bill is confirmed
  current_stock_base_unit numeric(14,3) not null default 0,
  low_stock_threshold numeric(14,3),
  updated_at timestamptz not null default now()
);

comment on column ingredients.current_unit_cost_satang is
  'Forward-looking: moves to the new value the moment a purchase invoice line
   confirming this ingredient is confirmed. Used to price the NEXT sale, never
   to restate a past one.';

create index if not exists ingredients_store_id_idx on ingredients (store_id);

drop trigger if exists trg_ingredients_set_updated_at on ingredients;
create trigger trg_ingredients_set_updated_at
  before update on ingredients
  for each row
  execute function set_updated_at();
