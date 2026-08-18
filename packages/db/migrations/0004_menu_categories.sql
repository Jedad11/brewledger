create table if not exists menu_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (store_id, name)
);

create index if not exists menu_categories_store_id_idx on menu_categories (store_id);
