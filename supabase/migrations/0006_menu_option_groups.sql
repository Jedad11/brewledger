create table if not exists menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  -- denormalised: avoids a 2-hop join in the anon "option groups" RLS policy
  -- (WBS 3.6), which runs on every unauthenticated menu page load.
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  name text not null,                    -- "Temperature", "Sweetness"
  is_required boolean not null default false,
  min_select integer not null default 0,
  max_select integer not null default 1,
  sort_order integer not null default 0,
  check (min_select >= 0 and max_select >= min_select)
);

create index if not exists menu_option_groups_menu_item_id_idx on menu_option_groups (menu_item_id);
create index if not exists menu_option_groups_store_id_idx on menu_option_groups (store_id);
