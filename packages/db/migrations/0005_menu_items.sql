create table if not exists menu_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  category_id uuid references menu_categories(id) on delete set null,
  name text not null,
  description text,
  image_path text,
  price_satang integer not null check (price_satang >= 0),
  availability text not null default 'available'
    check (availability in ('available','out_of_stock','hidden')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists menu_items_store_id_sort_order_idx on menu_items (store_id, sort_order);
create index if not exists menu_items_category_id_idx on menu_items (category_id);
