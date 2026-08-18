create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  phone text not null,
  subscription_tier text not null default 'free'
    check (subscription_tier in ('free','starter','growth','scale')),
  created_at timestamptz not null default now()
);
