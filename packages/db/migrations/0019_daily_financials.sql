create table if not exists daily_financials (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  business_date date not null,
  gross_revenue_satang integer not null default 0,
  total_cogs_satang integer,                          -- null-aware: excludes untracked
  untracked_item_count integer not null default 0,    -- disclosed in 7.5, never hidden
  other_expense_satang integer not null default 0,
  net_profit_satang integer,
  order_count integer not null default 0,
  unique (store_id, business_date)
);
