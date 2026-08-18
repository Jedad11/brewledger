-- Append-only. Stock level is DERIVED from this, never overwritten in place.
create table if not exists stock_ledger (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  delta_base_unit numeric(14,4) not null,
  reason text not null check (reason in
    ('purchase','sale','waste','adjustment','cancellation_reversal')),
  order_id uuid references orders(id) on delete set null,
  purchase_invoice_id uuid references purchase_invoices(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stock_ledger_store_id_ingredient_id_created_at_idx
  on stock_ledger (store_id, ingredient_id, created_at desc);
