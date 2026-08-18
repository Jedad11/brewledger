# WBS 3.5 — Core Data Model: Architect Design

Status: design only. This document is the specification `engineer` implements
as SQL migrations in `packages/db/migrations/`, and `qa_engineer` writes
tests against. It is not itself a migration file — no `.sql` ships from this
entry.

Inputs consulted: `BrewLedger_WBS_Dictionary.md` lines 1523–1829 (abridged
DDL + non-negotiable rules 1–7 + Claude Code prompt), `packages/db/prisma/schema.prisma`
(prior data model, format-ported per `MIGRATION_PLAN.md`), `MIGRATION_PLAN.md`
(payment/fee/webhook delta), `docs/data_dictionary.md` (PUBLIC_SAFE /
MERCHANT_ONLY classification, informs RLS readiness in §5 but is not owned by
this entry).

---

## 1. Complete table list

Sixteen tables: the twelve fully specified in the abridged DDL, unchanged in
substance, plus four I designed (`menu_categories`, `menu_option_groups`,
`menu_options`, `order_item_options`) that the dictionary named but did not
expand. All sixteen carry `store_id` directly or reach one through exactly
one join (rule 5) — table shown per-table in §5.

Conventions applied throughout, matching the abridged DDL's own style:
- `uuid primary key default gen_random_uuid()`
- Enumerated string columns as `text` + `check (... in (...))`, **not** native
  Postgres `enum` types — this is a deliberate divergence from the Prisma
  schema's `enum Tier`, `enum OrderStatus`, etc. (see §7). A `check` constraint
  can be dropped and re-added in one statement; a Postgres enum's value list
  can only grow, and only outside a transaction in older PG — the wrong
  tradeoff for a schema still under active feature change.
- Every money column `integer`, suffixed `_satang`.
- `created_at timestamptz not null default now()` on every table; `updated_at`
  only where the row is mutated post-insert (only `ingredients` in this
  design — see rule 7 below).

### 1.1 Tables from the abridged DDL (verbatim intent, reproduced for completeness)

`merchants`, `stores`, `menu_items`, `ingredients`, `bom_lines`,
`pickup_slots`, `orders`, `order_items`, `payments`, `stock_ledger`,
`purchase_invoices`, `purchase_line_items`, `job_queue`, `daily_financials` —
exactly as given in `BrewLedger_WBS_Dictionary.md` lines 1567–1753. `engineer`
should treat that block as authoritative DDL text to port into individual
migration files (§2), not re-derive. Three things to carry over precisely
because they are easy to drop by habit while translating:

- `orders.payment_confirmed_by` / `payment_confirmed_at` / `refund_status` —
  the manual-confirmation replacement for the webhook flow (`MIGRATION_PLAN.md`).
- `stores.promptpay_id` / `promptpay_type` / `promptpay_verified_at` and
  `payments.payee_alias` — the RL-1 evidence columns.
- `job_queue.store_id` is **nullable** (`references stores(id)`, no
  `not null`) — this is intentional in the abridged DDL, not an omission.
  Some jobs (e.g. a platform-wide nightly sweep) are not store-scoped. Do not
  "fix" this to `not null` while porting.

### 1.2 The four unexpanded tables — my design

**`menu_categories`** — one join from `stores` is unnecessary; give it a
direct `store_id` since it is a top-level per-store list the console CRUDs
independently of any menu item.

```sql
create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (store_id, name)
);
```

`menu_items.category_id uuid references menu_categories(id) on delete set null`
— already present in the abridged DDL, confirms the FK direction.

**`menu_option_groups`** — belongs to one `menu_item`. Reaching `store_id`
through `menu_item_id` alone is a valid single join, but I am **denormalising
`store_id` onto this table anyway**, for the same reason the dictionary
denormalises it onto `order_items`/`payments`/`purchase_line_items`: this is
one of the anon role's exactly-four SELECT policies (WBS 3.6 — "their option
groups and options"), and that policy runs on every menu page load from an
unauthenticated customer. A direct `store_id in (select ...)` predicate is
cheaper and simpler to write correctly than `menu_item_id in (select id from
menu_items where store_id in (...))`.

```sql
create table menu_option_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  -- denormalised: avoids a 2-hop join in the anon "option groups" RLS policy
  -- (WBS 3.6), which runs on every unauthenticated menu page load.
  menu_item_id uuid not null references menu_items(id) on delete cascade,
  name text not null,                    -- "Temperature", "Sweetness"
  is_required boolean not null default false,
  min_select integer not null default 0,
  max_select integer not null default 1,
  sort_order integer not null default 0,
  check (min_select >= 0 and max_select >= min_select)
);
```

**`menu_options`** — belongs to one `menu_option_group`. Because that parent
now carries `store_id` directly, `menu_options` reaches `store_id` through
exactly one join (`option_group_id -> menu_option_groups.store_id`) and does
not need its own denormalised copy — rule 5 is satisfied without it, and
further denormalisation here buys nothing since `menu_options` is always
fetched nested under its group, never queried standalone.

```sql
create table menu_options (
  id uuid primary key default gen_random_uuid(),
  option_group_id uuid not null references menu_option_groups(id) on delete cascade,
  name text not null,                    -- "Hot", "Iced", "50% sweet"
  price_delta_satang integer not null default 0,
  sort_order integer not null default 0
);
```

**`order_item_options`** — the normalized, queryable record of which options
were selected on a sold item (distinct from `order_items.options_snapshot
jsonb`, which is a display-cache the tracking page reads directly without a
join; keep both — jsonb for cheap render, this table for reporting/aggregation
such as "how many iced vs hot sold this week", which the dictionary's Phase 7
reporting entries will need and a jsonb column cannot index cleanly).
`order_item_id -> order_items.store_id` (already denormalised per the
dictionary) is one join, so no further denormalisation needed here either.

```sql
create table order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  menu_option_id uuid references menu_options(id) on delete set null,  -- nullable: menu can change later
  option_group_name_snapshot text not null,
  option_name_snapshot text not null,
  price_delta_snapshot_satang integer not null default 0
);
```

No trigger analogous to the cost-snapshot immutability trigger is needed here:
these rows are never updated by application code (they're written once at
order-item insert, same transaction), so there's nothing to guard against —
unlike `unit_cost_snapshot_satang`, which a costing recompute job could
plausibly touch by mistake if the trigger didn't exist.

---

## 2. Migration ordering

`packages/db/migrations/`, one file per numbered step, strict FK-dependency
order. Each file contains its table's own indexes and any trigger that
belongs to it — do not centralise all indexes or all triggers into one
tail-end file; a trigger or index shipped in a different migration than its
table risks the two drifting out of sync under `IF NOT EXISTS` reruns.

```
0000_extensions.sql              -- create extension if not exists pgcrypto;
0001_functions.sql               -- set_updated_at(), prevent_cost_snapshot_update(),
                                  -- prevent_stock_ledger_mutation() — generic, no table dependency
0002_merchants.sql
0003_stores.sql
0004_menu_categories.sql
0005_menu_items.sql              -- FK to menu_categories
0006_menu_option_groups.sql      -- FK to menu_items, stores
0007_menu_options.sql            -- FK to menu_option_groups
0008_ingredients.sql             -- attaches set_updated_at trigger
0009_bom_lines.sql               -- FK to menu_items, ingredients — RL-2 table
0010_pickup_slots.sql
0011_orders.sql                  -- FK to pickup_slots
0012_order_items.sql             -- FK to orders, menu_items; attaches cost-snapshot trigger
0013_order_item_options.sql      -- FK to order_items, menu_options
0014_payments.sql                -- FK to orders
0015_stock_ledger.sql            -- FK to ingredients, orders, purchase_invoices (forward ref, see note)
0016_purchase_invoices.sql
0017_purchase_line_items.sql     -- FK to purchase_invoices, ingredients
0018_job_queue.sql
0019_daily_financials.sql
0020_rl1_structural_proof.sql    -- comment-only, no-op migration (see §4)
```

**Forward-reference note on `0015_stock_ledger.sql`**: the abridged DDL's
`stock_ledger` has an FK to `purchase_invoices(id)`, but `purchase_invoices`
is not created until `0016`. `engineer` must either (a) move
`purchase_invoices`/`purchase_line_items` ahead of `stock_ledger` in the
sequence (cleanest — swap 0015 and 0016/0017), or (b) create `stock_ledger`
without that FK and add it via `alter table` in a later migration once
`purchase_invoices` exists. I recommend (a): reorder so `purchase_invoices`
(0015) and `purchase_line_items` (0016) precede `stock_ledger` (0017); nothing
else in the dependency graph forces `stock_ledger` before purchases. Renumber
`job_queue` and `daily_financials` to 0018/0019 accordingly — the sequence
above should be corrected to this order before implementation.

Each file: `IF NOT EXISTS` guards throughout, RLS `enable row level security`
statements are **out of scope for this entry** (WBS 3.6) — but per the
architect agent's own migration discipline, `engineer` should still run

```bash
grep -c "create table" packages/db/migrations/*.sql
grep -c "enable row level security" packages/db/migrations/*.sql
```

after 3.5 lands and expect the second count to be `0`, not equal — 3.6 is a
separate, immediately-following entry, and every table this migration set
creates is unprotected until it lands. Flag this loudly in the 3.5 PR
description so nobody mistakes a green `supabase db reset` for RLS coverage.

---

## 3. The cost-snapshot trigger — exact design

This is, per the dictionary, "the most important rule in the schema." Two
columns, two different jobs:

```sql
comment on column ingredients.current_unit_cost_satang is
  'Forward-looking: moves to the new value the moment a purchase invoice line
   confirming this ingredient is confirmed. Used to price the NEXT sale, never
   to restate a past one.';

comment on column order_items.unit_cost_snapshot_satang is
  'Historical truth, frozen at sale. NULL when the menu item had no bom_lines
   at time of sale (RL-2) — never 0, which would silently claim a 100% margin.
   Protected from UPDATE by trg_order_items_cost_snapshot_immutable. A latte
   sold 1 March at 12 THB cost must still report 12 THB cost on 1 April even
   after milk rises to 15 THB — otherwise last month''s P&L changes every time
   an ingredient price moves.';

create or replace function prevent_cost_snapshot_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.unit_cost_snapshot_satang is distinct from old.unit_cost_snapshot_satang then
    raise exception
      'order_items.unit_cost_snapshot_satang is immutable after insert (WBS 3.5 cost-snapshot rule) — insert a new order_item or a stock_ledger adjustment row instead, never rewrite historical cost';
  end if;
  return new;
end;
$$;

create trigger trg_order_items_cost_snapshot_immutable
  before update on order_items
  for each row
  execute function prevent_cost_snapshot_update();
```

Design notes for `engineer`:
- The guard is `is distinct from`, not `<>` — `<>` returns `null` (not true)
  when comparing against a `null` snapshot, which would silently let a
  `null -> 5000` update through on a zero-BOM item picking up a late recipe.
  `is distinct from` treats `null -> anything` as a real change and blocks it,
  which is correct: once frozen, frozen, even from `null`.
- `before update`, not `after` — reject before the write lands, not after.
  `after` triggers can't raise to prevent the row change; only `before` (or a
  constraint trigger) can.
- The trigger fires on every `update` to the row, not just ones touching this
  column — the `if` inside it is what narrows to the one protected column.
  Other `order_items` columns (there are none expected to be updated
  post-insert in this design, but if one is added later) remain updatable.
- `search_path = public` per the architect agent's own rule for every
  security-relevant function, even though this one is not `security definer`
  — cheap insurance against a future refactor that makes it one.

The QA test this design implies (qa_engineer's job, listed here so the
contract is explicit): insert an `order_items` row with a non-null snapshot,
attempt `update ... set unit_cost_snapshot_satang = <different value>`, assert
it raises; separately assert every *other* column on the same row remains
updatable.

---

## 4. RL-1 structural proof — placement

Confirmed: no table in §1 represents a platform balance, escrow, float,
wallet, ledger account, or payout. `payments` records one row per
order-level payment attempt with `payee_alias` (the merchant's own PromptPay
alias, RL-1 evidence per row) and a `status`; it holds no balance field, no
running total, no "amount owed to platform" — money is never modeled as
passing through Brew Ledger. `stock_ledger` is a ledger of *stock quantity*
(base units of an ingredient), not of money — its name only coincidentally
contains "ledger"; do not let a future migration read that name and assume it
is money-shaped.

Placement: `packages/db/migrations/0020_rl1_structural_proof.sql`, a
comment-only, no-op migration (valid, re-runnable SQL — a file of nothing but
`comment on schema public is ...` and block comments has no side effect and
is safe to reapply). Rationale for a dedicated final file rather than a
comment appended to `0019_daily_financials.sql`: it makes the proof
independently discoverable by filename and by `git log -- packages/db/migrations/0020_rl1_structural_proof.sql`
without requiring a reader to know it's appended to an unrelated table's
migration. Content:

```sql
-- ============================================================================
-- RL-1 STRUCTURAL PROOF
-- ============================================================================
-- This schema contains no table representing a platform balance, escrow,
-- float, wallet, ledger_account, or payout. This absence is deliberate, not
-- an oversight: BrewLedger money moves directly from the customer's bank to
-- the merchant's own PromptPay account (see stores.promptpay_id/_type and
-- payments.payee_alias). BrewLedger never holds, nets, or settles money on a
-- merchant's behalf, so no table here should ever be added to represent one.
--
-- Asserted by an introspection test (WBS 3.5 acceptance criteria) that fails
-- the build if any table name matches /balance|escrow|float|wallet|payout|
-- ledger_account/. stock_ledger is stock-quantity, not money — the "ledger"
-- in its name refers to an append-only movement log, matching the same
-- append-only pattern used for accounting ledgers, but it carries no
-- currency amount and is not a match for that regex.
-- ============================================================================
```

The introspection test itself (qa_engineer's job) should run this query
against `information_schema.tables` — I flag the exact predicate here so the
test and this comment stay in agreement:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
  and table_name ~* '(balance|escrow|float|wallet|payout|ledger_account)';
-- must return zero rows
```

Note `stock_ledger` does not match this pattern (`ledger_account` is a
two-word compound, `stock_ledger` doesn't contain it) — worth a comment in
the test itself so a future reader doesn't "fix" the regex to catch it.

---

## 5. RLS scoping readiness (for WBS 3.6, not built here)

Every table's path to `store_id`, so 3.6 doesn't have to re-derive it:

| Table | Path to `store_id` |
|---|---|
| `merchants` | no `store_id` — scoped by `auth_user_id = auth.uid()` instead; stores reach merchants, not the reverse |
| `stores` | is the root — `id = store_id` |
| `menu_categories` | direct column |
| `menu_items` | direct column |
| `menu_option_groups` | direct column (denormalised, §1.2) |
| `menu_options` | one join: `option_group_id -> menu_option_groups.store_id` |
| `ingredients` | direct column |
| `bom_lines` | direct column (present in the abridged DDL already) |
| `pickup_slots` | direct column |
| `orders` | direct column |
| `order_items` | direct column (denormalised per dictionary rule 5) |
| `order_item_options` | one join: `order_item_id -> order_items.store_id` |
| `payments` | direct column (denormalised per dictionary rule 5) |
| `stock_ledger` | direct column |
| `purchase_invoices` | direct column |
| `purchase_line_items` | direct column (denormalised per dictionary rule 5) |
| `job_queue` | direct column, **nullable** — 3.6 needs a policy that accounts for `store_id is null` rows (platform-internal jobs), likely `service_role`-only with no `anon`/`authenticated` policy at all |
| `daily_financials` | direct column |

For the anon role's exactly-four SELECT policies (WBS 3.6): published
`stores`, their non-hidden `menu_items`, their `menu_option_groups` +
`menu_options`, their open/future/non-full `pickup_slots`. All four resolve
in zero or one join given the table above — `menu_options` needs its one join
to `menu_option_groups`, everything else the anon role touches has direct
`store_id`.

---

## 6. Index list

The seven from dictionary rule 6, plus additions for the four new tables and
for every FK column that rule 6 didn't separately name (Postgres does not
auto-index foreign keys — only the referenced side's primary key is indexed
automatically). RLS predicates will filter on `store_id` on nearly every
query once 3.6 lands, so every `store_id` column not already covered by a
more specific composite index below should carry its own btree index.

**From rule 6, verbatim:**
```sql
create index on orders (store_id, created_at desc);
-- orders(order_code): already covered by the `unique (order_code)` constraint's
-- implicit index — no separate index statement needed.
create index on orders (status) where status = 'PENDING_PAYMENT';
create index on payments (order_id);
create index on stock_ledger (store_id, ingredient_id, created_at desc);
-- daily_financials(store_id, business_date): already covered by the
-- `unique (store_id, business_date)` constraint's implicit index.
create index on job_queue (status, run_after) where status = 'pending';
-- pickup_slots(store_id, slot_start): already covered by the
-- `unique (store_id, slot_start)` constraint's implicit index.
```

**Additional, for the four new tables and uncovered FKs:**
```sql
create index on menu_categories (store_id);
create index on menu_items (store_id, sort_order);
create index on menu_items (category_id);
create index on menu_option_groups (menu_item_id);
create index on menu_option_groups (store_id);
create index on menu_options (option_group_id);
create index on order_item_options (order_item_id);
create index on order_item_options (menu_option_id);
create index on ingredients (store_id);
create index on bom_lines (ingredient_id);   -- (menu_item_id, ingredient_id) unique already covers menu_item_id lookups
create index on order_items (order_id);
create index on order_items (store_id);
create index on order_items (menu_item_id);
create index on purchase_invoices (store_id);
create index on purchase_line_items (invoice_id);
create index on purchase_line_items (store_id);
create index on purchase_line_items (ingredient_id);
```

Place each index statement in the same migration file as the table it
indexes (§2), not a separate indexes-only file — keeps table and index
definitions from drifting apart under re-runs.

---

## 7. What NOT to port from Prisma

Explicit, so `engineer` doesn't reintroduce any of this out of translation
habit. Grouped by why.

**Gateway/fee/webhook — RL-1, per `MIGRATION_PLAN.md`, already explicit in the task:**
- `Merchant.absorbGatewayFee`, `gatewayProvider`, `gatewayMerchantId`,
  `gatewayKycStatus` (and the `KycStatus` enum) — no gateway, no gateway KYC.
  `stores.promptpay_verified_at` is the entire replacement for KYC status: a
  timestamp, not a state machine, because the only "verification" left is the
  merchant scanning their own QR and confirming it resolves to them (WBS 4.5).
- `Order.gatewayFeeSatang`, `feeBorneBy` (and the `FeeBearer` enum) — no fee
  exists to record or attribute.
- `Payment.provider`, `providerChargeId`, `feeSatang`, `idempotencyKey`,
  `rawPayload`, `settledToMerchantAccount` — all gateway-shaped. Replaced by
  the abridged DDL's leaner `payments` (`method`, `payee_alias`, `qr_payload`,
  `expires_at`). Note `idempotencyKey` guarded against *duplicate webhook
  delivery* specifically — since there's no webhook, that specific risk is
  gone, but a related one isn't: a merchant could still double-tap "confirm
  payment" in the console. That's an application-layer idempotency concern
  for the Edge Function in WBS 3.7/5.6, not a schema column; flagging so it
  isn't lost, not solving it here.
- `webhook_events`, `dead_letter_webhooks` — named in `MIGRATION_PLAN.md` as
  tables to remove, but they don't actually exist in
  `packages/db/prisma/schema.prisma` as I read it. Nothing to drop. Recording
  this so nobody goes looking for a deletion that was already a no-op.

**Redundant with a leaner replacement already in the abridged DDL:**
- `CostHistory` — Prisma logged ingredient cost changes as their own table
  (`ingredientId`, `unitCostSatang`, `effectiveAt`). The abridged DDL doesn't
  include it, and I'm not adding it: `purchase_line_items` (`ingredient_id`,
  `unit_cost_satang`, joined to `purchase_invoices.invoice_date`) already
  gives the same audit trail — every confirmed bill line *is* a cost-history
  entry. A separate `cost_history` table would be two sources of truth for
  the same fact. If Phase 7 reporting later needs cost-over-time queries
  faster than that join provides, that's a materialised view or index
  decision for 7.8, not a schema table now.
- `Expense` / `ExpenseLine` — reshaped, not dropped: `purchase_invoices` /
  `purchase_line_items` cover the OCR-bill-capture path Expense/ExpenseLine
  served. **Flagging a real gap, not resolving it unilaterally**:
  `daily_financials.other_expense_satang` (abridged DDL) implies some
  non-ingredient expense (rent, wages) is tracked in aggregate, but no source
  table for it exists anywhere in the abridged DDL — `purchase_invoices` is
  explicitly ingredient/stock-linked (it feeds `stock_ledger` via
  `purchase_invoice_id`). Either `other_expense_satang` is meant to be
  manually entered directly on `daily_financials` with no line-item detail
  ever (a real product decision, not a schema gap), or a table is missing.
  I am not inventing one — out of scope for what the dictionary specified —
  but this should be confirmed with whoever owns Phase 7 before that entry
  is designed, since 7.8's index design depends on knowing which shape wins.

**Deferred as out of current scope, not silently dropped:**
- `StaffUser` (OWNER/STAFF roles) — not referenced anywhere in WBS 3.5's
  abridged DDL or elsewhere in `CLAUDE.md`'s current-phase description; the
  schema assumes single-owner (`merchants.auth_user_id`) for now. Prisma's
  own comment called this "Phase 2 scope" — still true. Adding it later is
  additive (new table, no existing column touched), so deferring costs
  nothing structurally.
- `BomLine.isSuggested` (seeded-template flag, F26) — not in the abridged
  `bom_lines` DDL. Additive to add later; omitting now rather than inventing
  a column the dictionary didn't ask for.

**Format change, not a content change (worth naming since it's the biggest visual diff from the Prisma file):**
- Native Postgres `enum` types (`Tier`, `OrderStatus`, `Channel`, `BaseUnit`,
  `LedgerReason`, `OcrStatus`, etc.) become `text` + `check (... in (...))`
  throughout, matching the abridged DDL's own convention. Reasoning in §1.
- Prisma's `cuid()` string PKs become `uuid default gen_random_uuid()`
  throughout, matching the abridged DDL and Supabase/PostgREST convention
  (`auth.users.id` is `uuid`; FK types must match).

---

## Summary for the report back

- 16 tables total: 12 from the abridged DDL as-is, 4 designed here
  (`menu_categories`, `menu_option_groups`, `menu_options`, `order_item_options`).
- Migration file count: 20 (`0000`–`0019`), plus the corrected ordering note
  in §2 (swap `stock_ledger` to after `purchase_invoices`/`purchase_line_items`)
  that `engineer` must apply before numbering the final sequence.
- RL-1 structural proof: confirmed no balance/escrow/float/wallet/ledger_account/
  payout table exists; placement is a dedicated no-op migration `0020_rl1_structural_proof.sql`.
- RL-2: `bom_lines` unchanged from the abridged DDL — no `NOT NULL`, no FK
  from `menu_items`, no trigger requiring a row.
- Every table reaches `store_id` in ≤1 join (§5 table).
