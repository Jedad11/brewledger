create table if not exists pickup_slots (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  capacity integer not null check (capacity > 0),
  booked_count integer not null default 0 check (booked_count >= 0),
  is_open boolean not null default true,
  unique (store_id, slot_start),
  check (booked_count <= capacity)                    -- 5.3 relies on this
);
