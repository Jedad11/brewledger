create table if not exists menu_options (
  id uuid primary key default gen_random_uuid(),
  option_group_id uuid not null references menu_option_groups(id) on delete cascade,
  name text not null,                    -- "Hot", "Iced", "50% sweet"
  price_delta_satang integer not null default 0,
  sort_order integer not null default 0
);

create index if not exists menu_options_option_group_id_idx on menu_options (option_group_id);
