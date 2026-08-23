# WBS 5.11 — Order Cancellation and Merchant-Initiated Refund: Architect Design

Status: design only. This is the specification `engineer` implements as a SQL
migration (`packages/db/migrations/0051_*.sql`, mirrored byte-identical into
`supabase/migrations/`, per the WBS 5.6/5.7 precedent), two Edge Functions
(`supabase/functions/console-cancel-order/`, `supabase/functions/console-resolve-refund/`),
and edits to `packages/shared/src/serializers/public.ts` /
`public.schema.ts`. No `.sql` or `.ts` ships from this entry.

Inputs consulted: `BrewLedger_WBS_Dictionary.md` lines 4220–4317 (5.11 scope
+ Claude Code prompt); `docs/design/gaps.md` GAP-9 (lines 280–315);
`packages/db/migrations/0011_orders.sql`, `0032_order_status_history.sql`,
`0033_route_payment_confirmation_through_lifecycle.sql`,
`0040_console_advance_order.sql`, `0049_stock_ledger_append_only.sql`,
`0050_console_cash_sale.sql`, `0021_rls.sql` §6 (`public_order_status`/
`public_order_lookup`); `docs/db/wbs_5_7_lifecycle_design.md` (all sections,
particularly §1.1 and §10); `supabase/functions/console-advance-order/index.ts`;
`packages/shared/src/serializers/public.ts` / `public.schema.ts`;
`docs/design/state_matrix.md` (Cancelled/Refunded entries),
`docs/design/interaction_spec.md:18` (reason picker), `docs/design/
component_inventory.md:11` (`OrderCard.onCancel`).

Most of this entry's state machine already shipped under WBS 5.7/5.9/5.12.
What's actually new here is narrow: one column for the reason, two columns
for refund resolution, two thin wrapper functions, and a widened public RPC
contract. Nothing below touches `transition_order()`'s signature or its
existing CANCELLED-transition side effects (stock reversal, slot release,
`refund_status = 'pending'`) — those are unchanged and are not duplicated by
any function in this design.

---

## 1. Cancellation-reason storage

### Decision: a column on `orders`, not on `order_status_history`

`orders.cancel_reason text`, written by `console_cancel_order` directly on
the `orders` row, in the same transaction and under the same `FOR UPDATE`
lock as the call to `transition_order(..., 'CANCELLED', ...)` — **not** a
new parameter threaded through `transition_order()` itself.

This mirrors the existing precedent exactly: `console_confirm_payment`
(`0033`) calls `transition_order(..., 'ACCEPTED', ...)` for the generic,
map-enforced state change, then writes `payment_confirmed_by` /
`payment_confirmed_at` — columns specific to *that* wrapper, not generic to
every transition reaching `ACCEPTED` — directly on `orders` in the same
statement/transaction, while the row lock `transition_order()` took is still
held. `cancel_reason` is the identical shape: specific to a
merchant-initiated cancel with a reason, not generic to every path that can
reach `CANCELLED`.

**Why not `order_status_history`, even though it's the natural "one row per
transition" audit table:** `order_status_history`'s insert lives *inside*
`transition_order()` itself (`0032`'s final statement), generic across all
ten transition pairs. Adding a reason column there would force
`transition_order()` to grow a new parameter that only one of its ten pairs
ever uses — and every existing caller would need updating, including
`console_undo_cash_sale` (`0050`), which already calls
`transition_order(p_order_id, 'CANCELLED', p_merchant_id, 'merchant')` for a
transition that is *not* a merchant reason-driven cancel (it's a same-
interaction till-mistake correction with "no customer, nothing to track" —
that migration's own header comment). Forcing that call site to supply a
reason (or a sentinel meaning "no reason applies") would be a real
regression for no benefit: `CANCELLED` is terminal (except `→ REFUNDED`), so
there is at most one cancellation per order, and a single column on `orders`
carries that fact exactly as well as a row in a per-transition table would,
without touching a function eleven other things already depend on.

### Exact DDL

```sql
alter table orders add column if not exists cancel_reason text
  check (cancel_reason in (
    'out_of_stock',        -- ของหมด
    'equipment_failure',   -- เครื่องเสีย
    'customer_request',    -- ลูกค้าขอยกเลิก
    'unexpected_closure',  -- ร้านปิดกะทันหัน
    'other'                -- อื่นๆ
  ));
```

Nullable, no `not null`, no table-level "reason required when
status=CANCELLED" constraint. Two reasons:

1. `console_undo_cash_sale`'s `CANCELLED` orders (see above) legitimately
   have no reason and must not be forced to fabricate one.
2. "Required" is a per-call-site UX rule (the WBS's own Input line:
   "reason (required — ...)"), not a schema invariant — enforced by
   `console_cancel_order` returning `VALIDATION_ERROR` for a missing/invalid
   value, the same posture every other RPC in this codebase uses for input
   validation (never a table constraint standing in for an API contract).

Five fixed codes, English/snake_case, matching every other enum-shaped
column in this schema (`stock_ledger.reason`, `orders.status`,
`orders.channel`) — Thai display text is a `state_matrix.md`/component
concern, never stored. **No free-text field alongside `อื่นๆ`.** Neither the
WBS's own Input line, `interaction_spec.md`'s reason-picker description
("two steps, both dismissible" — a picker, not a picker-plus-textarea), nor
`component_inventory.md` describes a free-text control for this flow, and
GAP-9's own example customer-facing copy (`เหตุผลจากร้าน: วัตถุดิบหมด`) is
itself one of the five canned strings, not an ad-hoc merchant sentence.
Flagged below as an explicit open question — if product later wants free
text, it's a new column and a new component, not a retrofit of this one.

`cancel_reason` is **never cleared** on `CANCELLED → REFUNDED` — it persists
as the historical record of why the order was cancelled in the first place,
same append-only spirit as the rest of this schema even though this is a
single column, not a ledger table.

---

## 2. `refund_status` / `refund_resolved_by` / `refund_resolved_at`

`orders.refund_status` already exists (`0011_orders.sql`:
`check (refund_status in ('pending','done'))`, nullable) and is already
written by `transition_order()` (`0032` §1.1) as an intrinsic, automatic
consequence of leaving `ACCEPTED`/`PREPARING`/`READY` into `CANCELLED`. This
entry adds only the two resolution columns, both new:

```sql
alter table orders add column if not exists refund_resolved_by uuid
  references merchants(id) on delete set null;
alter table orders add column if not exists refund_resolved_at timestamptz;
```

**`refund_resolved_by` is a proper FK to `merchants(id)`, not a `text` cast**
— deliberately *not* following `payment_confirmed_by`'s existing `text`
pattern (`0011`/`0031`: `payment_confirmed_by = p_merchant_id::text`).
`payment_confirmed_by` being `text` is disclosed, pre-existing technical
debt (`0031`'s own header comment: "merchant-level, not session-level...
acceptable for a sole-proprietor pilot... revisit alongside WBS 4.1/4.2"),
predating `order_status_history.actor`'s FK convention. `refund_resolved_by`
is a fresh column with no legacy constraint forcing a shape — it follows the
newer, correct precedent (`order_status_history.actor uuid references
merchants(id) on delete set null`), not the older one. Do not propagate the
`text` pattern into new columns; it is debt to retire, not a style to match.

`console_resolve_refund` sets both columns **after** the call to
`transition_order(order_id, 'REFUNDED', ...)` returns successfully, in the
same statement/transaction, under the same row lock — identical ordering to
`console_confirm_payment`'s `payment_confirmed_by`/`payment_confirmed_at`
write and to `console_cancel_order`'s `cancel_reason` write above. This is
exactly the split `docs/db/wbs_5_7_lifecycle_design.md` §1.1 already
specifies ahead of this entry: *"5.11's engineer should not add
refund-status logic to `transition_order` itself; call it, then write the
resolution columns in the same wrapper function, same transaction."*

### Index for the "รอคืนเงิน" console list

The pending-refund section is explicitly required to "persist... indefinitely"
and never age out (Acceptance). A `store_id, refund_status='pending'` query
against `orders` has no supporting index today (only
`orders_store_id_created_at_idx` and the `PENDING_PAYMENT` partial index
exist). Add, same partial-index style as the existing one:

```sql
create index if not exists orders_refund_pending_idx
  on orders (store_id, created_at desc)
  where refund_status = 'pending';
```

Cheap (the predicate keeps the index tiny — only orders genuinely awaiting a
transfer are in it) and directly supports a list the product spec forbids
from ever being paginated away.

---

## 3. `console_cancel_order` and `console_resolve_refund`

Both follow `console_advance_order`'s (`0040`) posture exactly:
`security definer` plpgsql, `set search_path = public`, two-step ownership
check (`NOT_FOUND` vs `FORBIDDEN`, mutates nothing on either branch) before
any write, actor resolved via `auth_merchant_id()` (never trusted client
input), `revoke all ... from public; revoke execute ... from anon,
service_role; grant execute ... to authenticated` (repeating the revoke is
required — `0021_rls.sql`'s standing `alter default privileges` grants
EXECUTE to every role on every function created afterward; a bare `revoke
all from public` does not undo that, per every migration since `0025`'s own
documented trap).

**`console_cancel_order` does not restrict which `orders.status` may be
cancelled.** No `p_to`-style allow-list, no extra `WHERE status IN (...)`
guard. `transition_order()`'s own map is the single source of truth for
legality — this is the same principle `docs/db/wbs_5_7_lifecycle_design.md`
§10 already states for the `COLLECTED`-can't-cancel guard rail ("falls out
of the map for free, no extra check needed"), extended here to the whole
eligibility question rather than re-derived per wrapper. Concretely this
means `console_cancel_order` legally accepts a `PENDING_PAYMENT` order too
(`('PENDING_PAYMENT','CANCELLED')` is in the map) — which is exactly what
the WBS's own guard-rail bullet 3 describes ("cancelling a PENDING_PAYMENT
order releases the slot and owes no refund"): `transition_order`'s
`PENDING_PAYMENT → CANCELLED` branch already never touches `refund_status`,
so it stays `null`, satisfying that bullet with zero extra code. The WBS's
guard-rail bullet 1 ("only ACCEPTED, PREPARING, or READY may be cancelled by
the merchant") is the **console UI's own scope** — `OrderCard.onCancel`
(component-inventory) only appears in the working-queue/detail screens that
list those three statuses in the first place; it is not a second
application-level restriction this RPC needs to duplicate.

```sql
create or replace function console_cancel_order(
  p_order_id uuid,
  p_reason   text   -- one of the five codes in orders.cancel_reason's check
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_merchant_id uuid;
  v_order orders%rowtype;
begin
  if p_reason not in (
    'out_of_stock', 'equipment_failure', 'customer_request',
    'unexpected_closure', 'other'
  ) then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR',
      'message', 'invalid cancel reason');
  end if;

  select store_id into v_store_id from orders where id = p_order_id;
  if v_store_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_store_id not in (select auth_store_ids()) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select auth_merchant_id() into v_merchant_id;

  begin
    -- transition_order() performs the row lock, the map check, the
    -- compensating stock_ledger insert, refund_status='pending' (only when
    -- leaving a paid state), and slot release -- all unchanged from 0032,
    -- nothing duplicated here.
    v_order := transition_order(p_order_id, 'CANCELLED', v_merchant_id, 'merchant');
  exception
    when sqlstate 'BL001' then
      -- Re-read-and-compare, per wbs_5_7_lifecycle_design.md §10: only a
      -- genuine "already cancelled" (double-tap / two tabs) is silent.
      -- Anything else -- e.g. a stale UI trying to cancel an order another
      -- device already advanced to COLLECTED -- is a real, structured
      -- rejection, not swallowed and not a 500.
      if (select status from orders where id = p_order_id) = 'CANCELLED' then
        return jsonb_build_object('ok', true, 'already', true);
      end if;
      return jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION');
  end;

  update orders set cancel_reason = p_reason where id = p_order_id
  returning * into v_order;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_code', v_order.order_code,
      'status', v_order.status,
      'refund_status', v_order.refund_status,
      'cancel_reason', v_order.cancel_reason
    )
  );
end;
$$;

revoke all on function console_cancel_order(uuid, text) from public;
revoke execute on function console_cancel_order(uuid, text) from anon, service_role;
grant execute on function console_cancel_order(uuid, text) to authenticated;
```

```sql
create or replace function console_resolve_refund(
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_merchant_id uuid;
  v_order orders%rowtype;
begin
  select store_id into v_store_id from orders where id = p_order_id;
  if v_store_id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_store_id not in (select auth_store_ids()) then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  end if;

  select auth_merchant_id() into v_merchant_id;

  begin
    -- transition_order()'s CANCELLED -> REFUNDED branch has no side effect
    -- of its own beyond the history row (0032 §1.1) and enforces the
    -- refund_status='pending' invariant itself -- a CANCELLED order whose
    -- refund was never owed (PENDING_PAYMENT cancel) or already resolved
    -- cannot be "resolved" a second time; this correctly BL001s here too.
    v_order := transition_order(p_order_id, 'REFUNDED', v_merchant_id, 'merchant');
  exception
    when sqlstate 'BL001' then
      if (select status from orders where id = p_order_id) = 'REFUNDED' then
        return jsonb_build_object('ok', true, 'already', true);
      end if;
      return jsonb_build_object('ok', false, 'code', 'ILLEGAL_TRANSITION');
  end;

  update orders
     set refund_status = 'done',
         refund_resolved_by = v_merchant_id,
         refund_resolved_at = now()
   where id = p_order_id
  returning * into v_order;

  return jsonb_build_object(
    'ok', true,
    'already', false,
    'order', jsonb_build_object(
      'id', v_order.id,
      'order_code', v_order.order_code,
      'status', v_order.status,
      'refund_status', v_order.refund_status,
      'refund_resolved_at', v_order.refund_resolved_at
    )
  );
end;
$$;

revoke all on function console_resolve_refund(uuid) from public;
revoke execute on function console_resolve_refund(uuid) from anon, service_role;
grant execute on function console_resolve_refund(uuid) to authenticated;
```

### BL001 posture: structured rejection, not `raise` — a deliberate choice, flagged for double-check

`docs/db/wbs_5_7_lifecycle_design.md` §10 mandates the re-read-and-compare
step (both functions above do it) but does not mandate *which* of the two
existing precedents to follow once a genuine (non-"already") BL001 is
found: `console_confirm_payment` (`0033`) hard `raise`s (→ 500, "only one
legal pair reaches here, so anything else is unambiguously a bug");
`console_advance_order` (`0040`) returns a structured `{ok:false,
code:'ILLEGAL_TRANSITION'}` (→ 409, "bulk actions and multi-device races are
an expected, recoverable condition"). Both functions above follow the
`console_advance_order` shape. Reasoning: the WBS's own guard-rail wording
for cancel — "a COLLECTED order cannot be cancelled through the API **even
if the UI is bypassed**" — anticipates exactly the kind of stale-client/
multi-device race `console_advance_order`'s reasoning describes, not a
one-legal-pair function where any miss is definitionally a server bug.
Flagged for `redline_reviewer`/`qa_engineer` to confirm this read is right
for both functions — if either is judged to have only one truly legal
"from" state in practice, the stricter `raise` may be more appropriate there
instead.

### Edge Function contract (thin wrappers, `engineer`'s job — signatures only)

- `supabase/functions/console-cancel-order/index.ts` — `POST { orderId:
  string, reason: 'out_of_stock'|'equipment_failure'|'customer_request'|
  'unexpected_closure'|'other' }` → `ctx.supabase.rpc('console_cancel_order',
  { p_order_id, p_reason: reason })`. Code mapping, same as
  `console-advance-order/index.ts`: `FORBIDDEN`→403, `NOT_FOUND`→404,
  `VALIDATION_ERROR`→400, `ILLEGAL_TRANSITION`→409. Success:
  `{ ok: true, already: boolean, order: {...} }`.
- `supabase/functions/console-resolve-refund/index.ts` — `POST { orderId:
  string }` → `ctx.supabase.rpc('console_resolve_refund', { p_order_id })`.
  Same code mapping (no `VALIDATION_ERROR` case — no body field to
  validate beyond `orderId`'s presence/shape).

The Owner Console's reason picker (`interaction_spec.md:18`'s five Thai
labels) maps to these five English codes client-side before calling the
Edge Function — the codes never appear as literal strings in
`apps/console`'s UI copy, same separation every other status enum in this
schema already keeps.

---

## 4. `public_order_status` / `public_order_lookup` widening

### Decision: add both `cancel_reason` and `refund_status`, unchanged names, to both RPCs' output

Both RPCs currently return `order_code, status, pickup_at, item_name,
quantity` (`0021_rls.sql` §6). Add two columns to each, identical shape:

```sql
-- CREATE OR REPLACE FUNCTION cannot add columns to an existing function's
-- RETURNS TABLE list -- Postgres requires DROP + CREATE for that (changing
-- the return type is explicitly disallowed by plain REPLACE). Drop first,
-- in the SAME migration, then recreate with the revoke/grant pair repeated
-- -- a DROP removes the anon grant along with the function; 0021's default-
-- privileges trap (§3 above) applies here too.
drop function if exists public_order_status(text);
create function public_order_status(p_order_code text)
returns table (
  order_code text,
  status text,
  pickup_at timestamptz,
  item_name text,
  quantity integer,
  cancel_reason text,
  refund_status text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.order_code,
    o.status,
    ps.slot_start as pickup_at,
    oi.item_name_snapshot as item_name,
    oi.quantity,
    o.cancel_reason,
    o.refund_status
  from orders o
  join order_items oi on oi.order_id = o.id
  left join pickup_slots ps on ps.id = o.pickup_slot_id
  where o.order_code = p_order_code;
$$;

revoke all on function public_order_status(text) from public;
grant execute on function public_order_status(text) to anon;

-- public_order_lookup(p_phone, p_order_code): identical drop + widen,
-- identical two added columns, identical select-list change (o.cancel_reason,
-- o.refund_status), unchanged WHERE clause (order_code + customer_phone
-- match).
```

Flagged explicitly for `engineer`: **use `DROP FUNCTION` + `CREATE
FUNCTION`, not `CREATE OR REPLACE`, for this migration.** `CREATE OR REPLACE
FUNCTION` on a function returning `TABLE(...)` errors if the output column
list changes shape — this is a real Postgres restriction, not a style
preference, and the mistake would only surface at migration-apply time.

### RL-3 safety check — neither field is a red-line field

`cancel_reason` (one of five generic operational categories, no free text)
and `refund_status` (`pending`/`done`/`null`, an obligation flag) are
per-order **operational state**, the same category `status` itself already
is (already exposed, unauthenticated, by these RPCs today). Neither is
cost, margin, profit, expense, stock, or a store-aggregate — RL-3's four
forbidden categories. `refund_resolved_by`/`refund_resolved_at` are
deliberately **excluded** from both RPCs: they're merchant-internal audit
fields (an internal `merchants.id`, and a resolution timestamp the customer
has no product reason to see) with no role in customer-facing copy — nothing
in `state_matrix.md`'s Cancelled/Refunded entries or GAP-9's own quoted
target copy needs them. Both RPCs already reach `orders` only through their
own `security definer` body (no anon table-level policy on `orders` exists
or is added by this design — the narrow-RPC pattern `CLAUDE.md`/WBS 3.7
mandate for order lookup is unchanged).

### The load-bearing invariant: `refund_status`, never `cancel_reason`, gates any refund copy

**`cancel_reason` being non-null does NOT mean a refund is owed.** A
`PENDING_PAYMENT` order cancelled through `console_cancel_order` (§3 above)
gets a `cancel_reason` (reason is required for every call, regardless of
originating status) but `refund_status` stays `null` — nothing was ever
paid, so nothing is owed (WBS guard-rail bullet 3; `transition_order`'s
`PENDING_PAYMENT → CANCELLED` branch never touches `refund_status`). If a
future `apps/shop` `/o/{code}` implementation renders the refund-timeframe
line whenever `cancel_reason` is present — a very plausible bug, since both
lines appear together in the Cancelled visual state — it would falsely
promise a refund on an order that never took payment.

**This must be enforced by which field the frontend branches on, not by
trusting the frontend to get the branch right on its own** — the RPC
contract's job is to make the *correct* signal the only signal available:
`refund_status` is the sole authoritative source (populated only from
`orders.refund_status`, itself only ever set by `transition_order`/
`console_resolve_refund`, never guessed or derived), and it is returned as a
tri-state (`'pending' | 'done' | null`) specifically so a consumer must
branch on it explicitly — there is no "truthy string" shortcut the way
there would be with a boolean-ish default. The rule for whoever writes the
`state_matrix.md` follow-up (GAP-9, owner M2) and for `redline_reviewer` to
check once built:

- `refund_status = null` → never render a refund claim or timeframe, cancel
  or not (matches the existing "Cancelled" title-only state for exactly
  this reason today).
- `refund_status = 'pending'` → render the refund-timeframe line
  (`เงินจะคืนเข้าบัญชีเดิมภายใน 3–5 วันทำการ`).
- `refund_status = 'done'` → render the already-refunded line
  (`เงินคืนเข้าบัญชีเดิมเรียบร้อยแล้ว`, `status = REFUNDED` case, already
  specified in `state_matrix.md`).
- `cancel_reason` (when non-null) drives *only* the reason line
  (`เหตุผลจากร้าน: ...`) and must never be treated as a proxy for whether to
  show refund copy.

### `packages/shared/src/serializers/public.ts` / `public.schema.ts`

```ts
export interface PublicOrderStatus {
  orderCode: string;
  status: string;
  pickupAt: string | null;
  itemName: string;
  quantity: number;
  cancelReason: string | null;
  // 'pending' | 'done' | null. null = no refund owed -- THE gating field
  // for any refund-timeframe copy. Never derive this from cancelReason's
  // presence; see wbs_5_11_refund_design.md §4.
  refundStatus: "pending" | "done" | null;
}

export function toPublicOrderStatus(row: {
  order_code: string;
  status: string;
  pickup_at: string | null;
  item_name: string;
  quantity: number;
  cancel_reason: string | null;
  refund_status: string | null;
}): PublicOrderStatus {
  return {
    orderCode: row.order_code,
    status: row.status,
    pickupAt: row.pickup_at,
    itemName: row.item_name,
    quantity: row.quantity,
    cancelReason: row.cancel_reason,
    refundStatus: row.refund_status as PublicOrderStatus["refundStatus"],
  };
}
```

```ts
export const publicOrderStatusSchema = z.object({
  orderCode: z.string(),
  status: z.string(),
  pickupAt: z.string().nullable(),
  itemName: z.string(),
  quantity: z.number().int().positive(),
  cancelReason: z.enum([
    "out_of_stock", "equipment_failure", "customer_request",
    "unexpected_closure", "other",
  ]).nullable(),
  refundStatus: z.enum(["pending", "done"]).nullable(),
}).strict();
```

`.strict()` preserved at every level, matching this file's existing
discipline — any accidental extra field (e.g. a stray
`refund_resolved_by`) fails `parseOrThrow` loudly at the RPC boundary rather
than silently reaching the browser.

---

## 5. Open questions / risks flagged for `engineer` and `redline_reviewer`

- **No free-text field for `อื่นๆ`** (§1) — confirmed against every
  available spec source, but if product later wants a merchant-typed reason
  alongside the fixed five, that's a new column (`cancel_reason_detail
  text`, additive) and a new picker-plus-textarea component, not a
  reinterpretation of the fixed-five `check` constraint designed here.
- **BL001 posture choice (§3)** — both new functions return structured
  `{ok:false, code:'ILLEGAL_TRANSITION'}` rather than `raise`, following
  `console_advance_order`'s reasoning rather than `console_confirm_payment`'s
  stricter one. Double-check this read is right for both — `redline_reviewer`
  should specifically verify the re-read-and-compare step is present (not
  just "any BL001 → already:true", the exact failure mode
  `wbs_5_7_lifecycle_design.md` §10 warns about) regardless of which posture
  is chosen.
- **`console_cancel_order` accepts `PENDING_PAYMENT` as a legal "from"
  state** (§3), relying entirely on `transition_order`'s existing map rather
  than an extra application check. `qa_engineer`'s test suite should
  specifically assert a `PENDING_PAYMENT` cancel via this RPC ends with
  `refund_status IS NULL` and does **not** appear in the "รอคืนเงิน" list —
  this is WBS 5.11's own listed acceptance test, and it is expected to pass
  by construction (no new code path needed), not by a special case in
  `console_cancel_order`.
- **`DROP FUNCTION` + `CREATE FUNCTION`, not `CREATE OR REPLACE`** (§4) —
  a real Postgres restriction on widening a `RETURNS TABLE` column list;
  flagged because it's an easy migration-time mistake to make and only
  surfaces when the migration is actually applied.
- **`docs/data_dictionary.md` is stale relative to the live schema** — it
  still names Prisma-era columns (`publicCode`, `gatewayFeeSatang`,
  `feeBorneBy`) that don't exist in any shipped migration and has no entry
  at all for `refund_status`/`payment_confirmed_by`/etc. This design doc
  states the classification inline (§4: `cancel_reason`/`refund_status`
  PUBLIC_SAFE, `refund_resolved_by`/`refund_resolved_at` MERCHANT_ONLY) but
  does not attempt to reconcile the whole file — that drift predates this
  entry and is out of this design's scope. Flagged so it isn't mistaken for
  "already covered."
- **`state_matrix.md`'s Cancelled entry still needs its own follow-up edit**
  (GAP-9, owner M2) once these columns/RPC fields exist — restoring the
  reason and refund-timeframe lines, gated exactly per §4's invariant above.
  Not this entry's job to write, but the exact gating rule it must follow is
  now specified precisely enough that M2 shouldn't have to re-derive it.

---

## Summary for the report back

- `orders.cancel_reason text check (... 5 fixed codes ...)`, nullable, no
  free text, written by `console_cancel_order` directly on `orders` (not
  threaded through `transition_order()`), same statement/lock as the
  `CANCELLED` transition — mirrors `payment_confirmed_by`'s existing
  pattern, not a new `order_status_history` column.
- `orders.refund_resolved_by uuid references merchants(id) on delete set
  null`, `orders.refund_resolved_at timestamptz` — proper FK (the newer
  `order_status_history.actor` pattern), deliberately not `payment_
  confirmed_by`'s legacy `text` cast. Written by `console_resolve_refund`
  after `transition_order(..., 'REFUNDED', ...)` succeeds, same
  transaction. Plus a partial index, `orders_refund_pending_idx`, for the
  never-aging-out console list.
- `console_cancel_order(p_order_id, p_reason)` / `console_resolve_refund
  (p_order_id)` — `security definer`, `authenticated`-only, same ownership/
  idempotency posture as `console_advance_order`, BL001 handled via
  re-read-and-compare per `wbs_5_7_lifecycle_design.md` §10, genuine
  illegal transitions returned as structured `{ok:false,
  code:'ILLEGAL_TRANSITION'}` rather than raised. `console_cancel_order`
  duplicates none of `transition_order`'s existing side effects and adds no
  eligibility check beyond the map itself.
- `public_order_status`/`public_order_lookup` widened (DROP + CREATE, not
  REPLACE) to return `cancel_reason` and `refund_status` — confirmed
  RL-3-safe (operational state, not cost/margin/stock/aggregate),
  `refund_resolved_by`/`refund_resolved_at` deliberately excluded. The
  load-bearing rule: `refund_status`, never `cancel_reason`'s presence, is
  the only field permitted to gate refund-claim copy — stated explicitly so
  the frontend consuming this contract can't get the branch wrong by
  accident.
