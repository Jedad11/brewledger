create table if not exists purchase_invoices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  image_path text not null,
  vendor_name text,
  invoice_date date,
  total_satang integer,
  ocr_status text not null default 'pending'
    check (ocr_status in ('pending','processed','failed','manual')),
  review_status text not null default 'needs_review'
    check (review_status in ('needs_review','confirmed')),
  raw_ocr_output jsonb,
  created_at timestamptz not null default now()
);

create index if not exists purchase_invoices_store_id_idx on purchase_invoices (store_id);
