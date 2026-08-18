create table if not exists job_queue (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','processing','done','failed')),
  attempts integer not null default 0,
  run_after timestamptz,
  claimed_at timestamptz, claimed_by text,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists job_queue_pending_idx on job_queue (status, run_after) where status = 'pending';
