create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  order_code text not null unique,                    -- short, customer-facing
  customer_name text not null,
  customer_phone text,
  pickup_slot_id uuid references pickup_slots(id) on delete restrict,
  channel text not null default 'online' check (channel in ('online','cash')),
  status text not null default 'PENDING_PAYMENT' check (status in
    ('PENDING_PAYMENT','ACCEPTED','PREPARING','READY','COLLECTED','CANCELLED','REFUNDED','EXPIRED')),
  subtotal_satang integer not null,
  total_satang integer not null,
  total_cost_snapshot_satang integer,                 -- null when no item had a BOM
  paid_at timestamptz,
  payment_confirmed_by text,                          -- 5.6: which session confirmed
  payment_confirmed_at timestamptz,
  refund_status text check (refund_status in ('pending','done')),  -- 5.11
  expires_at timestamptz,                             -- PENDING_PAYMENT auto-expiry
  created_at timestamptz not null default now()
);

create index if not exists orders_store_id_created_at_idx on orders (store_id, created_at desc);
create index if not exists orders_pending_payment_idx on orders (status) where status = 'PENDING_PAYMENT';
