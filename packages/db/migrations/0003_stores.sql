create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  slug text not null unique,                          -- brewledger.app/s/{slug}
  name text not null,
  pickup_address text,
  timezone text not null default 'Asia/Bangkok',
  opens_at time, closes_at time,
  promptpay_id text,                                  -- RL-1: the MERCHANT's own alias
  promptpay_type text check (promptpay_type in ('msisdn','nid','taxid')),
  promptpay_verified_at timestamptz,                  -- merchant scanned and confirmed (4.5)
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);
