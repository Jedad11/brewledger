create table if not exists purchase_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references purchase_invoices(id) on delete cascade,
  store_id uuid not null,
  ingredient_id uuid references ingredients(id) on delete set null,
  raw_text text,
  qty_base_unit numeric(14,3),
  unit_cost_satang integer,
  total_satang integer,
  mapping_confidence numeric(3,2)
);

create index if not exists purchase_line_items_invoice_id_idx on purchase_line_items (invoice_id);
create index if not exists purchase_line_items_store_id_idx on purchase_line_items (store_id);
create index if not exists purchase_line_items_ingredient_id_idx on purchase_line_items (ingredient_id);
