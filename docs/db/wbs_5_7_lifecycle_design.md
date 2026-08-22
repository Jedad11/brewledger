# WBS 5.7 — Order Status Lifecycle: Architect Design

Status: design only. This is the specification `engineer` implements as a SQL
migration (`packages/db/migrations/`, mirrored byte-identical into
`supabase/migrations/`, per the WBS 5.6 precedent) and a thin TypeScript
wrapper in `supabase/functions/_shared/orders/lifecycle.ts`. No `.sql` or
`.ts` ships from this entry.

Inputs consulted: `BrewLedger_WBS_Dictionary.md` lines 3876–3960 (5.7 scope +
Claude Code prompt), lines 3733–3872 (5.6, already shipped, and the exact
shape of the gap it left for 5.7 to fill), lines 4220–4317 (5.11, not yet
built, whose refund/cancel path this entry must not force a redesign of);
`packages/db/migrations/0011_orders.sql`, `0014_payments.sql`,
`0017_stock_ledger.sql`, `0021_rls.sql`, `0028_pickup_slot_generation_and_reservation.sql`,
`0031_payment_confirmation.sql` (the actual shipped code this entry must
interoperate with, not the abstraction the WBS prompt assumes — see §0);
`worker/src/handlers/expireOrders.ts`, `worker/src/handlers/slots.ts`,
`worker/src/queue.ts`, `worker/src/db.ts`; `PROGRESS.md`'s 5.6 row (states
plainly: *"WBS 5.7's `transitionOrder()`/status-history table doesn't exist
— revisit when 5.7 lands"*); `docs/db/schema_design.md`, `docs/db/rls_design.md`.

---

## 0. The load-bearing deviation from the WBS prompt text — read this first

The WBS 5.7 prompt describes `transitionOrder(tx, orderId, to, actor)` as a
TypeScript function taking a transaction handle. **That is not how this
codebase works, and building it that way would reintroduce a bug 0031 already
solved.** 0031's own header comment states it explicitly: *"a rollback across
two independent PostgREST calls is not a thing PostgREST offers."* Edge
Functions in this repo hold a `supabase-js` client scoped to a single RPC
call (`ctx.supabase.rpc(...)`), never a raw Postgres connection — there is no
`tx` to pass. Every stateful, multi-step operation shipped so far
(`checkout_create_order` 0029, `console_confirm_payment`/`console_reject_payment`
0031, `reserve_pickup_slot`/`release_pickup_slot` 0028) is a single `plpgsql`
function whose body is one implicit Postgres transaction. That is the actual
atomicity mechanism in this system, and 5.7 must use the same one.

**Resolution**, matching precedent exactly:

- The real guard — the state machine, the row lock, the side effects, the
  history write — is `transition_order(...)`, a `plpgsql` **Postgres**
  function (§3). This is the "only permitted way to change `orders.status`"
  the WBS acceptance criteria actually cash out to.
- `supabase/functions/_shared/orders/lifecycle.ts` (§5) is a thin typed
  wrapper around `.rpc('transition_order', ...)` — the TypeScript surface the
  prompt names, but it owns no transaction; it forwards to the one that
  already exists in SQL. This mirrors `_shared/console/db.ts`'s role
  (a typed convenience wrapper, not a second source of truth).
- The worker (`expire_orders`, which *does* hold a raw `pg.Pool` per
  `worker/src/db.ts`) calls `transition_order` the same way `expireOrders.ts`
  already calls `release_pickup_slot` today: `select transition_order($1,$2,$3,$4)`
  over its own connection. No outer `BEGIN`/`COMMIT` is needed around it —
  each call is already a fully atomic unit by itself (§6).

Flag this loudly in the 5.7 PR description, same as 3.5 flagged the RLS gap:
anyone reading the WBS prompt literally will reach for a `tx` parameter that
doesn't exist in this architecture.

---

## 1. Transition map, confirmed against real columns

All ten pairs from the WBS prompt, unchanged in substance, annotated with the
**actual** table/column each side effect writes to:

| From | To | Side effects (real tables/columns) |
|---|---|---|
| `PENDING_PAYMENT` | `ACCEPTED` | `stock_ledger` insert (`reason='sale'`, one row per `order_items × bom_lines` join, negative `delta_base_unit` — same shape 0031 already does inline); `job_queue` insert (`job_type='push_notify'`) |
| `PENDING_PAYMENT` | `EXPIRED` | `release_pickup_slot(orders.pickup_slot_id)` if not null |
| `PENDING_PAYMENT` | `CANCELLED` | `release_pickup_slot(orders.pickup_slot_id)` if not null. **No refund** — no payment was ever confirmed, so `refund_status` stays `null` (WBS 5.11 §1d) |
| `ACCEPTED` | `PREPARING` | `job_queue` insert (`push_notify`, customer-facing copy) |
| `ACCEPTED` | `CANCELLED` | `orders.refund_status = 'pending'`; compensating `stock_ledger` insert (`reason='cancellation_reversal'`, mirrors the original `sale` rows for this `order_id` with sign flipped, per WBS 5.11 — original rows never edited); `release_pickup_slot` |
| `PREPARING` | `READY` | `job_queue` insert (`push_notify`) |
| `PREPARING` | `CANCELLED` | same three as `ACCEPTED → CANCELLED` |
| `READY` | `COLLECTED` | none |
| `READY` | `CANCELLED` | same three as `ACCEPTED → CANCELLED` |
| `CANCELLED` | `REFUNDED` | none *inside the guard* — see §1.1 |

### 1.1 What "refund" means here — the RL-1 answer, stated once, precisely

**No code path in this schema or this function ever moves money.** RL-1's own
enforcement (`0020_rl1_structural_proof.sql`) already proves no
balance/escrow/wallet/payout table exists; this entry does not add one or
approximate one.

"Refund" as a `transition_order` side effect means exactly one thing: **write
`orders.refund_status = 'pending'`.** That column already exists
(`0011_orders.sql`, `check (refund_status in ('pending','done'))`, nullable).
It is a flag meaning *"the merchant now owes this customer a transfer they
must make themselves, from their own banking app, and the system has not yet
been told it happened."* It is set automatically by `transition_order`
whenever the `from` state is `ACCEPTED`/`PREPARING`/`READY` (i.e. a payment
was actually confirmed) and the `to` state is `CANCELLED` — the merchant
cancelling a paid order does not need to remember to flag it; the guard does
it as an intrinsic, deterministic consequence of which state the order was
leaving, exactly like stock deduction is intrinsic to leaving
`PENDING_PAYMENT` for `ACCEPTED`.

The `CANCELLED → REFUNDED` transition itself has **no side effect inside
`transition_order`** beyond the history row. Setting `refund_status = 'done'`,
`refund_resolved_by`, `refund_resolved_at` (columns WBS 5.11 adds to `orders`
in its own migration — not this entry's job to create) is the **calling
function's** responsibility, in the same statement/transaction as the call to
`transition_order(orderId, 'REFUNDED', ...)` — this is `console_resolve_refund`,
built in 5.11, not here. This split (guard writes `pending` automatically as
an intrinsic consequence of the `from` state; the human-facing "I actually
sent the money" resolution is a separate write the 5.11 function makes
alongside the transition call) is exactly the shape 5.11's own prompt already
describes ("sets `refund_status = 'done'` ... **and** transitions
`CANCELLED → REFUNDED`") — 5.7 does not have to guess this, it is confirmed
by reading 5.11 ahead, which is why this note exists: **5.11's engineer should
not add refund-status logic to `transition_order` itself; call it, then write
the resolution columns in the same wrapper function, same transaction.**

One additional guard `transition_order` should enforce that the WBS's literal
ten-row table doesn't state but which prevents a real bug: **raise
`IllegalTransition` for `CANCELLED → REFUNDED` if `orders.refund_status` is
not `'pending'`** (i.e. block it for an order that was cancelled while still
`PENDING_PAYMENT`, where nothing was ever owed and `refund_status` is `null`).
Without this, a stray `console_resolve_refund` call on a never-charged
cancelled order would mark it `REFUNDED`, which is a false claim — a transfer
that was never owed cannot be "resolved." This tightens the map; it does not
loosen it, and stays inside "never silently ignore."

---

## 2. `order_status_history` — DDL

One join from `orders`, not denormalised — this table is authenticated-only,
low-QPS (a per-order timeline view, not a hot anon path), so it follows the
`order_item_options`/`menu_options` precedent (one-join RLS policy) rather
than the `order_items`/`payments`/`purchase_line_items` denormalisation list,
which the dictionary names explicitly and does not include this table in.

```sql
-- packages/db/migrations/0032_order_status_history.sql
-- (byte-identical mirror: supabase/migrations/0032_order_status_history.sql)

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
-- Deliberately no anon policy (this is never customer-visible — RL-3 has
-- nothing to do with this table specifically, but there is no product
-- reason to expose it and every reason not to invent a fifth anon SELECT
-- policy beyond WBS 3.6's exactly-four). Deliberately no insert/update/delete
-- policy for `authenticated` either: the only writer is transition_order(),
-- security definer, owned by the migration role — RLS does not apply to the
-- table owner, so no policy is needed to let it write, and none should exist
-- to let anyone else.

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
```

`from_status`/`to_status` are `not null`: every entry in §1's map has a
concrete `from` state (order *creation* at checkout is not a transition and
does not route through `transition_order` or write a history row — it is
`checkout_create_order`'s own `insert into orders`, 0029, unchanged by this
entry). There is no legitimate `null` case to leave room for.

**Aside, out of this entry's scope but worth flagging for `redline_reviewer`**:
`stock_ledger` (`0017_stock_ledger.sql`) does not yet have an append-only
trigger despite CLAUDE.md's explicit rule ("Trigger raising on UPDATE and
DELETE"). `order_status_history` is built correctly from the start here;
`stock_ledger`'s own gap is pre-existing and belongs to whichever entry owns
6.x/7.x stock work, not 5.7.

---

## 3. `transition_order()` — the guard

```sql
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
  -- take its own FOR UPDATE on this row before calling this function; see
  -- the caller-contract note in §4.
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

  -- CANCELLED -> REFUNDED extra invariant, see §1.1. Checked as part of the
  -- same "is this allowed" question, not a separate error path.
  if v_allowed and v_from = 'CANCELLED' and p_to = 'REFUNDED'
     and v_order.refund_status is distinct from 'pending' then
    v_allowed := false;
  end if;

  if not v_allowed then
    -- errcode 'BL001': a fixed, documented application code so callers (and
    -- the TS wrapper, §5) can distinguish this from a generic DB error
    -- without string-matching the message. NEVER caught and swallowed here
    -- — this function always throws for a disallowed pair, self-pairs
    -- (p_to = v_from) included. See §4 for why that's correct and how
    -- callers get idempotent double-tap behaviour anyway.
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
-- other security-definer wrapper functions, which execute as this schema's
-- owner and are therefore unaffected by this revoke — same mechanism
-- documented in 0031's own header comment for its release_pickup_slot call
-- — and (b) the worker's direct DATABASE_URL connection, which bypasses
-- PostgREST/RLS/grants entirely (worker/src/db.ts's own header comment).
revoke all on function transition_order(uuid, text, uuid, text) from public;
revoke execute on function transition_order(uuid, text, uuid, text) from anon, authenticated;
grant execute on function transition_order(uuid, text, uuid, text) to service_role;
```

---

## 4. Idempotency contract — how "throw, never silently ignore" coexists with 5.6's "double-tap is a silent no-op"

This is the one place the WBS's own acceptance criteria for 5.7 and 5.6
appear to pull in opposite directions, and it needs to be resolved explicitly
so `engineer` doesn't have to guess:

- 5.7: *"An illegal transition throws and is never silently ignored — asserted
  for every disallowed pair."*
- 5.6 (already shipped): *"A double-tap or a retried request confirms exactly
  once ... the second returns `{already: true}`, NOT an error."*

A retried/double-tapped call is, from `transition_order`'s point of view, a
**self-transition** (`p_to = v_from`, e.g. `ACCEPTED → ACCEPTED`) —
which is absent from the ten-row map and therefore, correctly, an illegal
pair. **`transition_order` does not special-case this. It throws, exactly as
it throws for any other unmapped pair.** Making the guard itself lenient
about self-transitions would be the same mistake 0031's design notes already
warn against elsewhere in this codebase: leniency baked into the one place
whose entire job is to be strict is how a real bug gets masked as a no-op.

**The idempotent, silent `{already: true}` behaviour belongs entirely to the
calling wrapper function** (`console_confirm_payment`, `console_reject_payment`,
and 5.11's future `console_cancel_order`/`console_resolve_refund`) — exactly
where 0031 already puts it today. The pattern every wrapper must follow:

```sql
-- inside e.g. console_confirm_payment, AFTER the ownership check:
begin
  v_order := transition_order(p_order_id, 'ACCEPTED', p_merchant_id, 'merchant');
exception
  when sqlstate 'BL001' then
    -- Cheap re-read, no lock needed here — we're only distinguishing
    -- "we're already at the target" (expected, silent) from "something else
    -- is wrong" (re-raise, this is the real bug case 5.7 exists to catch).
    if (select status from orders where id = p_order_id) = 'ACCEPTED' then
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    raise;  -- genuinely illegal transition attempt: propagate, do not swallow
end;
```

This satisfies both criteria without contradiction: `transition_order` never
silently no-ops (it always throws for an unmapped pair, self-pairs included);
the *product-facing* silent idempotency a double-tapping merchant needs is
implemented once, consistently, in the thin layer that already owns
ownership-checking too — not duplicated ad hoc per call site, and not hidden
inside the state-machine guard where a real bug could hide behind it.

---

## 5. TypeScript wrapper contract — `supabase/functions/_shared/orders/lifecycle.ts`

Per §0: this wraps the RPC, it does not own a transaction. New directory,
neutral (not under `_shared/console/` or `_shared/public/`), importable from
both scopes without tripping the RL-3 `eslint.config.mjs` boundary rule —
it contains no cost/margin/stock read logic, only an order-status RPC call.

```typescript
// supabase/functions/_shared/orders/lifecycle.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type OrderStatus =
  | "PENDING_PAYMENT" | "ACCEPTED" | "PREPARING" | "READY"
  | "COLLECTED" | "CANCELLED" | "REFUNDED" | "EXPIRED";

export type Actor =
  | { type: "merchant"; id: string }
  | { type: "system" };

export class IllegalTransitionError extends Error {
  constructor(
    public readonly orderId: string,
    public readonly from: string,
    public readonly to: string,
  ) {
    super(`illegal order transition: ${from} -> ${to} (order ${orderId})`);
  }
}

// Thin RPC dispatch — the atomic guard is transition_order() in Postgres
// (packages/db/migrations/0032_order_status_history.sql). This function
// owns no transaction of its own; supabase-js's single .rpc() call IS the
// unit of work, same posture as console-confirm-payment/index.ts's own
// ctx.supabase.rpc("console_confirm_payment", ...) call.
//
// NOTE: this does not, by itself, give a caller the idempotent-double-tap
// behaviour WBS 5.6 requires — that lives in the wrapper Postgres function
// (console_confirm_payment etc., see docs/db/wbs_5_7_lifecycle_design.md §4).
// Call this only from inside such a wrapper's own RPC, never directly from
// an Edge Function index.ts as the sole guard for a merchant-facing action.
export async function transitionOrder(
  supabase: SupabaseClient,
  orderId: string,
  to: OrderStatus,
  actor: Actor,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc("transition_order", {
    p_order_id: orderId,
    p_to: to,
    p_actor: actor.type === "merchant" ? actor.id : null,
    p_actor_type: actor.type,
  });

  if (error) {
    if (error.code === "BL001") {
      const match = /from_status=([A-Z_]+) to_status=([A-Z_]+)/.exec(error.details ?? "");
      throw new IllegalTransitionError(orderId, match?.[1] ?? "?", match?.[2] ?? to);
    }
    throw error;
  }
  return data as Record<string, unknown>;
}
```

This is a direct-use helper for any **future** Edge Function that needs a
one-shot transition with no wrapper-level idempotency concern of its own
(e.g. a hypothetical simple `PREPARING → READY` action with no double-tap
risk worth guarding beyond what a disabled button already gives it). It is
**not** meant to replace the SQL-level wrapper functions for
money/stock-bearing transitions (`ACCEPTED`, `CANCELLED`, `REFUNDED`
entry points) — those need the ownership check + idempotency split from §4,
which must live in `plpgsql` for the same atomicity reason `transition_order`
itself does (§0).

---

## 6. Expiry sweep — worker hook-in

`worker/src/handlers/expireOrders.ts` already exists (shipped under 5.6,
self-perpetuating via `job_queue` job_type `'expire_orders'`, registered in
`worker/src/handlers/index.ts`). **It must be refactored, not replaced**: its
scheduling half (re-enqueueing its own next run, `worker/src/index.ts`
seeding the first run) is unrelated to 5.7 and stays exactly as-is. Only its
sweep body changes, from one bulk `UPDATE ... RETURNING` to a per-row loop
through the guard — matching what the WBS 5.7 prompt's own step 4 already
specifies (`select id ... limit 100` then `transitionOrder(...)` per id),
which turns out to already match the shape the worker needs regardless of
5.7 (a single bulk UPDATE could never call a per-row `plpgsql` guard):

```typescript
// worker/src/handlers/expireOrders.ts — sweep body after refactor
const { rows } = await pool.query<{ id: string }>(
  `select id from orders
    where status = 'PENDING_PAYMENT' and expires_at < now()
    limit 100`,
);

let expiredCount = 0;
for (const { id } of rows) {
  try {
    // Each call is already one atomic unit (transition_order's own body,
    // §0) — no outer BEGIN/COMMIT needed around the loop. A merchant's
    // manual "ยังไม่ได้รับเงิน" (console_reject_payment) racing this same
    // row lands on the self-transition path (§4) and is caught below,
    // not treated as a sweep failure.
    await pool.query(`select transition_order($1, 'EXPIRED', null, 'system')`, [id]);
    expiredCount++;
  } catch (err) {
    if ((err as { code?: string }).code === "BL001") {
      log.info("expire_orders: order already left PENDING_PAYMENT, skipping", { order_id: id });
      continue;
    }
    log.error("expire_orders: transition failed for order", { order_id: id, error: String(err) });
    // do not rethrow — one bad row must not abort the sweep for the other 99
  }
}
```

No new job type, no new scheduling mechanism — the existing self-perpetuating
`expire_orders` job continues to own its own re-enqueue.

---

## 7. Required refactor of already-shipped code

5.7's own acceptance criterion — *"No code path anywhere updates
`orders.status` directly, bypassing the guard"* — **is not met by this
migration alone.** Two call sites pre-date 5.7 and write `orders.status`
directly, exactly as `0031`'s own header comment predicted and deferred
("Route the status change through `transitionOrder()` from WBS 5.7 if that
helper is already in place; otherwise write the history row inline and
refactor when 5.7 lands"):

1. **`packages/db/migrations/0031_payment_confirmation.sql`** —
   `console_confirm_payment` (`update orders set status = 'ACCEPTED', ...`)
   and `console_reject_payment` (`update orders set status = 'EXPIRED' ...`).
2. **`worker/src/handlers/expireOrders.ts`** — the bulk `UPDATE orders SET status='EXPIRED' ...` (§6 above already gives the replacement).

Per migration discipline, do not edit `0031` in place. Ship a new migration
(`packages/db/migrations/0033_route_payment_confirmation_through_lifecycle.sql`,
mirrored to `supabase/migrations/`) that `create or replace function`s both
`console_confirm_payment` and `console_reject_payment` with bodies that keep
their existing ownership check and idempotency pre-check (§4's pattern —
these two already have the "check current status, return `{already:true}`
early" shape, just needs its state-changing half swapped for a call to
`transition_order`) but delegate the actual status write, stock/slot side
effects, and history write to `transition_order`. This is a same-signature
`create or replace`, so nothing calling these RPCs (the two Edge Functions,
the existing test suite) needs to change — only the function bodies. Flag
this as a required follow-up task in the 5.7 PR description, not an optional
cleanup: until it lands, 5.7's own acceptance criterion is false for this
codebase even though the new guard exists and works correctly for any new
call site.

---

## 8. Static analysis CI rule

Pass-through from the WBS prompt, with one necessary correction: the regex
must **exclude** `packages/db/migrations/` and `supabase/migrations/`
(where `transition_order`'s own body legitimately contains
`update orders ... set status = ...`), and should target application code —
`apps/`, `supabase/functions/` (excluding `_shared/orders/lifecycle.ts`
itself, which legitimately references status literals for typing), and
`worker/` (excluding `expireOrders.ts`'s own `SELECT transition_order(...)`
call, which is a function call, not a direct `UPDATE`, and so does not match
the pattern anyway). Suggested placement: a script alongside the existing
`pnpm lint:boundary` RL-3 check (same category of static guard), run in CI.
Message per the WBS prompt: *"Order status must change through
`transitionOrder()`. See WBS 5.7."* — implementation is `engineer`'s job, not
designed further here.

---

## 9. Migration ordering and grep verification

```
0032_order_status_history.sql   -- table, RLS, append-only trigger, transition_order()
0033_route_payment_confirmation_through_lifecycle.sql  -- refactor, §7 (immediately following, same PR)
```

After both land:

```bash
grep -c "create table" packages/db/migrations/*.sql
grep -c "enable row level security" packages/db/migrations/*.sql
```

`order_status_history`'s own file must show both counts incremented by
exactly 1 in the same file (`0032`) — the RLS-in-the-same-migration rule this
schema has followed since `0021` and every table since (`0024_auth_attempts.sql`
is the closest precedent: table + `enable row level security` + policy
decision, all in one file).

---

## 10. Open questions / risks flagged for `engineer` and `redline_reviewer`

- **§7 is a hard dependency, not a suggestion.** If `0033` is skipped or
  deferred, 5.7's acceptance criteria are not actually satisfied for this
  codebase — say so explicitly in the PR, do not mark 5.7 `done` on the
  strength of `0032` alone.
- **`transition_order`'s exception-based contract (§4) requires every future
  wrapper function to adopt the `exception when sqlstate 'BL001'` pattern
  correctly**, including 5.11's `console_cancel_order`/`console_resolve_refund`.
  A wrapper that forgets the re-read-and-compare step and instead treats
  *every* `BL001` as `{already:true}` would silently swallow a genuine bug
  report (e.g. a stray attempt to cancel a `COLLECTED` order) — this is
  exactly the failure mode 5.7's acceptance criteria exist to prevent, and it
  would be reintroduced one layer up if a wrapper gets this shortcut wrong.
  `redline_reviewer` should specifically check this when 5.11 ships.
- **`stock_ledger` has no append-only trigger yet** (§2 aside) — not this
  entry's gap to fix, flagged so it isn't lost.
- **`console_cancel_order`'s guard rail from WBS 5.11** ("a `COLLECTED` order
  cannot be cancelled through the API even if the UI is bypassed") is already
  fully enforced by `transition_order`'s map — `COLLECTED` has no outgoing
  transition to `CANCELLED` at all. 5.11's engineer does not need to add a
  separate check for this; it falls out of the map for free. Worth confirming
  in 5.11's own test suite rather than re-deriving it.

---

## Summary for the report back

- New table `order_status_history` (1 join to `store_id` via `orders`, not
  denormalised — matches the `order_item_options`/`menu_options` precedent,
  not the `order_items`/`payments`/`purchase_line_items` denormalisation
  list). RLS enabled in the same migration, one `authenticated` SELECT
  policy, no anon policy, no write policy for anyone (only the security
  definer guard writes), append-only trigger for defense in depth.
- `transition_order(order_id, to, actor, actor_type)` — `plpgsql`,
  `security definer`, `service_role`-only grant, single row lock, strict
  ten-pair map (plus one added invariant on `CANCELLED → REFUNDED` requiring
  `refund_status = 'pending'`), throws `errcode 'BL001'` for every unmapped
  pair including self-pairs — idempotent double-tap handling is explicitly
  the calling wrapper's job (§4), not baked into the guard.
- "Refund" resolved precisely for RL-1: `transition_order` only ever writes
  `orders.refund_status = 'pending'` as an automatic consequence of leaving a
  paid state into `CANCELLED`. No money moves. Marking it `'done'` is WBS
  5.11's `console_resolve_refund`, layered on top, unchanged in shape by this
  entry.
- `supabase/functions/_shared/orders/lifecycle.ts` is a thin RPC wrapper, not
  a transaction owner — the WBS prompt's literal `tx` parameter does not
  exist in this codebase's architecture (§0), and building it that way would
  reintroduce the cross-call-rollback bug 0031 already avoided.
- Worker's existing `expire_orders` handler needs its sweep body changed from
  one bulk UPDATE to a per-row loop calling `transition_order` (§6) — same
  self-perpetuating scheduling, unchanged.
- **Required follow-up, flagged as a dependency not an option**: refactor
  `console_confirm_payment`/`console_reject_payment` (0031) to call
  `transition_order` instead of writing `orders.status` directly — 5.7's own
  "no code path bypasses the guard" acceptance criterion is false without it.
