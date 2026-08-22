-- WBS 5.7 — Order Status Lifecycle.
--
-- Design: docs/db/wbs_5_7_lifecycle_design.md. Read that file's §0 before
-- touching this one: the WBS prompt describes transitionOrder(tx, orderId,
-- to, actor) as a TypeScript function taking a transaction handle, but this
-- codebase has no `tx` to pass — supabase-js's Edge Function client is
-- scoped to a single RPC call, never a raw Postgres connection (0031's own
-- header comment: "a rollback across two independent PostgREST calls is not
-- a thing PostgREST offers"). The real guard is transition_order() below, a
-- plpgsql function whose body is one implicit Postgres transaction — same
-- atomicity mechanism checkout_create_order (0029) and
-- console_confirm_payment/console_reject_payment (0031) already use.
-- supabase/functions/_shared/orders/lifecycle.ts is a thin RPC wrapper
-- around it, not a second source of truth.
--
-- order_status_history: one join to store_id via orders, not denormalised
-- — this table is authenticated-only, low-QPS (a per-order timeline view,
-- not a hot anon path), matching the order_item_options/menu_options
-- one-join RLS precedent rather than the order_items/payments/
-- purchase_line_items denormalisation list.

create table if not exists order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  actor uuid references merchants(id) on delete set null,  -- null for actor_type='system'
  actor_type text not null check (actor_type in ('merchant', 'system')),
  created_at timestamptz not null default now()
);

create index if not exists order_status_history_order_id_created_at_idx
  on order_status_history (order_id, created_at desc);

alter table order_status_history enable row level security;

drop policy if exists merchant_read_order_status_history on order_status_history;
create policy merchant_read_order_status_history on order_status_history
  for select to authenticated
  using (
    order_id in (
      select id from orders where store_id in (select auth_store_ids())
    )
  );
-- Deliberately no anon policy — this repo carries exactly four anon SELECT
-- policies (published stores, their menu items, their option groups, their
-- open future slots, per CLAUDE.md RL-3) and there is no product reason to
-- add a fifth for a merchant-only audit trail. Deliberately no insert/
-- update/delete policy for `authenticated` either: the only writer is
-- transition_order(), security definer, owned by the migration role — RLS
-- does not apply to the table owner, so no policy is needed to let it
-- write, and none should exist to let anyone else.

create or replace function prevent_order_status_history_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception
    'order_status_history is append-only (WBS 5.7) — a transition audit trail that can be edited after the fact is not an audit trail; insert a new row instead';
end;
$$;

drop trigger if exists trg_order_status_history_append_only on order_status_history;
create trigger trg_order_status_history_append_only
  before update or delete on order_status_history
  for each row
  execute function prevent_order_status_history_mutation();

-- transition_order() — the ONLY permitted way to change orders.status.
-- Loads the row FOR UPDATE, checks the (from, to) pair against a fixed
-- ten-row map, throws errcode 'BL001' for every pair not in it (self-pairs
-- included — see the idempotency note below), applies side effects and
-- writes the history row in the same statement/transaction as the status
-- write.
--
-- "Refund" here means exactly one thing, precisely for RL-1: writing
-- orders.refund_status = 'pending' as an automatic consequence of leaving a
-- paid state (ACCEPTED/PREPARING/READY) into CANCELLED. No table anywhere
-- in this schema represents a platform balance, escrow, wallet, or payout
-- (0020_rl1_structural_proof.sql) and this function does not add one or
-- approximate one — no money moves here. Marking refund_status = 'done' is
-- WBS 5.11's console_resolve_refund, layered on top, not this entry's job.
--
-- Idempotency: this function NEVER silently no-ops. A double-tapped or
-- retried caller looks like a self-transition (p_to = v_from), which is
-- absent from the map and therefore, correctly, thrown as BL001 like any
-- other illegal pair. The product-facing silent "{already: true}" behaviour
-- WBS 5.6 requires belongs to the CALLING wrapper function
-- (console_confirm_payment, console_reject_payment — 0033), which already
-- owns the ownership check: catch sqlstate 'BL001', re-read the current
-- status, return {already:true} only if it already equals the target,
-- otherwise re-raise. Baking leniency into this guard would hide the exact
-- bug class 5.7 exists to catch.
create or replace function transition_order(
  p_order_id uuid,
  p_to text,
  p_actor uuid,          -- merchants.id, or null when p_actor_type = 'system'
  p_actor_type text       -- 'merchant' | 'system'
) returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders%rowtype;
  v_from text;
  v_allowed boolean;
begin
  if p_actor_type not in ('merchant', 'system') then
    raise exception 'transition_order: invalid actor_type %', p_actor_type;
  end if;
  if p_actor_type = 'merchant' and p_actor is null then
    raise exception 'transition_order: merchant-actor transitions require p_actor';
  end if;

  -- THE row lock. Single source of truth for atomicity — no caller should
  -- take its own FOR UPDATE on this row before calling this function.
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'transition_order: order % not found', p_order_id;
  end if;
  v_from := v_order.status;

  v_allowed := exists (
    select 1 from (values
      ('PENDING_PAYMENT', 'ACCEPTED'),
      ('PENDING_PAYMENT', 'EXPIRED'),
      ('PENDING_PAYMENT', 'CANCELLED'),
      ('ACCEPTED',        'PREPARING'),
      ('ACCEPTED',        'CANCELLED'),
      ('PREPARING',       'READY'),
      ('PREPARING',       'CANCELLED'),
      ('READY',           'COLLECTED'),
      ('READY',           'CANCELLED'),
      ('CANCELLED',       'REFUNDED')
    ) as t(from_status, to_status)
    where t.from_status = v_from and t.to_status = p_to
  );

  -- CANCELLED -> REFUNDED extra invariant, not in the WBS's literal ten-row
  -- table but load-bearing: blocks "resolving" a refund on an order that
  -- was cancelled while still PENDING_PAYMENT, where nothing was ever owed
  -- and refund_status is null. Checked as part of "is this allowed", not a
  -- separate error path.
  if v_allowed and v_from = 'CANCELLED' and p_to = 'REFUNDED'
     and v_order.refund_status is distinct from 'pending' then
    v_allowed := false;
  end if;

  if not v_allowed then
    -- errcode 'BL001': a fixed, documented application code so callers (and
    -- the TS wrapper) can distinguish this from a generic DB error without
    -- string-matching the message. NEVER caught and swallowed here — this
    -- function always throws for a disallowed pair, self-pairs included.
    raise exception using
      errcode = 'BL001',
      message = format('illegal order transition: %s -> %s', v_from, p_to),
      detail  = format('order_id=%s from_status=%s to_status=%s', p_order_id, v_from, p_to);
  end if;

  update orders set status = p_to where id = p_order_id returning * into v_order;

  -- Side effects, keyed on the (from, to) pair that just passed the guard.
  if v_from = 'PENDING_PAYMENT' and p_to = 'ACCEPTED' then
    insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, order_id)
    select v_order.store_id, bl.ingredient_id, -(bl.qty_base_unit * oi.quantity), 'sale', p_order_id
      from order_items oi
      join bom_lines bl on bl.menu_item_id = oi.menu_item_id
     where oi.order_id = p_order_id;
    insert into job_queue (store_id, job_type, payload)
    values (v_order.store_id, 'push_notify',
            jsonb_build_object('orderId', p_order_id, 'kind', 'merchant_new_order'));

  elsif p_to in ('EXPIRED', 'CANCELLED') and v_from = 'PENDING_PAYMENT' then
    if v_order.pickup_slot_id is not null then
      perform release_pickup_slot(v_order.pickup_slot_id);
    end if;

  elsif p_to = 'CANCELLED' and v_from in ('ACCEPTED', 'PREPARING', 'READY') then
    update orders set refund_status = 'pending' where id = p_order_id;
    insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, order_id)
    select store_id, ingredient_id, -delta_base_unit, 'cancellation_reversal', order_id
      from stock_ledger
     where order_id = p_order_id and reason = 'sale';
    if v_order.pickup_slot_id is not null then
      perform release_pickup_slot(v_order.pickup_slot_id);
    end if;

  elsif p_to in ('PREPARING', 'READY') then
    insert into job_queue (store_id, job_type, payload)
    values (v_order.store_id, 'push_notify',
            jsonb_build_object('orderId', p_order_id, 'kind', 'customer_status_update'));

  -- READY -> COLLECTED and CANCELLED -> REFUNDED: no side effect, falls
  -- through to the history write below.
  end if;

  insert into order_status_history (order_id, from_status, to_status, actor, actor_type)
  values (p_order_id, v_from, p_to, p_actor, p_actor_type);

  select * into v_order from orders where id = p_order_id;
  return v_order;
end;
$$;

-- service_role-only, same posture as reserve_pickup_slot/release_pickup_slot
-- (0028) — an internal primitive with money/stock side effects, never called
-- directly by anon or authenticated. Reached only via (a) nested calls from
-- other security-definer wrapper functions (console_confirm_payment,
-- console_reject_payment — 0033), which execute as this schema's owner and
-- are therefore unaffected by this revoke, same mechanism 0031's own header
-- comment documents for its release_pickup_slot call, and (b) the worker's
-- direct DATABASE_URL connection, which bypasses PostgREST/RLS/grants
-- entirely (worker/src/db.ts's own header comment).
revoke all on function transition_order(uuid, text, uuid, text) from public;
revoke execute on function transition_order(uuid, text, uuid, text) from anon, authenticated;
grant execute on function transition_order(uuid, text, uuid, text) to service_role;
