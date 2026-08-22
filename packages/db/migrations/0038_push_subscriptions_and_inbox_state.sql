-- WBS 5.8 — Owner Order Inbox and Web Push Notification.
--
-- push_subscriptions: one row per browser Push subscription (one per
-- device/browser, not per merchant), scoped by store_id like every other
-- direct-store_id table (0021_rls.sql §3's merchant_rw_* pattern). The
-- worker (service_role, bypasses RLS) reads these to fan out push_notify
-- jobs -- 0031_payment_confirmation.sql and 0032_order_status_history.sql
-- already enqueue 'push_notify' job_queue rows on PENDING_PAYMENT->ACCEPTED
-- and ->PREPARING/READY; this table is what that handler (previously a stub
-- in worker/src/handlers/index.ts) needed to actually send anything.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (store_id, endpoint)
);

create index if not exists push_subscriptions_store_id_idx on push_subscriptions (store_id);

alter table push_subscriptions enable row level security;

drop policy if exists merchant_rw_push_subscriptions on push_subscriptions;
create policy merchant_rw_push_subscriptions on push_subscriptions
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));

-- Inbox "new since last seen" cursor and the audible-cue mute toggle (WBS
-- 5.8 deliverables 1 and 4) both live on `stores` -- the merchant's existing
-- settings row -- rather than a new table, same posture as
-- promptpay_verified_at/is_published already living there per-store.
alter table stores add column if not exists orders_last_seen_at timestamptz;
alter table stores add column if not exists notify_sound_muted boolean not null default false;
