create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  store_id uuid not null,
  method text not null default 'promptpay_direct',
  payee_alias text not null,                          -- RL-1 evidence, per row: the merchant's
  amount_satang integer not null,
  status text not null check (status in ('pending','succeeded','failed','expired')),
  qr_payload text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payments_order_id_idx on payments (order_id);
