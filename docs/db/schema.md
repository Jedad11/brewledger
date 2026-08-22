# Database Schema — Brew Ledger

WBS 3.5 deliverable. Documents the schema as it exists in
`packages/db/migrations/` (21 files, `0000_extensions.sql` through
`0020_rl1_structural_proof.sql`). Design rationale for the four tables not
in the WBS dictionary's abridged DDL (`menu_categories`, `menu_option_groups`,
`menu_options`, `order_item_options`) lives in `docs/db/schema_design.md` —
this file documents the schema as built, that one documents why it was
designed that way.

**RLS is not yet applied** — WBS 3.6, a separate entry, adds
`enable row level security` and policies to every table here. Every table
below is currently unprotected at the database level; the only guard today
is the application layer, which doesn't exist yet either. Do not treat a
clean `supabase db push` of this schema as a security boundary.

## Why cost is stored twice

The single most important rule in this schema. Two columns, two different
jobs, and conflating them is the fastest way to make every profit number in
the product wrong:

- **`ingredients.current_unit_cost_satang`** — forward-looking. It moves the
  moment a purchase invoice line confirming that ingredient is confirmed.
  It answers "what does this ingredient cost *right now*," and is used to
  price the *next* sale.
- **`order_items.unit_cost_snapshot_satang`** — historical truth, frozen at
  the moment of sale. It is written once, at insert, and a database trigger
  (`trg_order_items_cost_snapshot_immutable`, on `order_items`, calling
  `prevent_cost_snapshot_update()`) raises an exception on any later attempt
  to change it.

**Worked example**: a latte sells on 1 March. At that moment, milk costs 12
THB per liter equivalent, so the sale's `order_items` row gets
`unit_cost_snapshot_satang` frozen at whatever that latte's true ingredient
cost was — say 12 THB. On 15 March, a new purchase invoice is confirmed
showing milk now costs 15 THB. `ingredients.current_unit_cost_satang` moves
to reflect that — every latte sold *from 15 March onward* will snapshot at
the new, higher cost. But the 1 March sale's report, viewed on 1 April,
**must still show 12 THB cost**, not 15. Without the snapshot column and its
immutability trigger, a naive schema would compute historical cost by
joining back to `ingredients.current_unit_cost_satang` at report time — and
last month's profit would silently change every time an ingredient's price
moves. That is not just confusing, it is accounting-wrong: a P&L for a
closed period is supposed to be a fixed historical fact.

When a menu item has no `bom_lines` (see RL-2 below),
`unit_cost_snapshot_satang` is `NULL` — never `0`. Zero would silently
imply a 100% margin, which flatters the merchant and misinforms their
pricing. `MoneyValue` (the shared rendering component, `packages/ui`, not
yet built) renders `NULL` cost as `—`.

## Costing method: latest purchase price, not weighted average

`ingredients.current_unit_cost_satang` moves to the exact price of the most
recently *confirmed* purchase for that ingredient (WBS 6.4's confirm
transaction, `console_confirm_purchase_invoice`,
`packages/db/migrations/0044_console_confirm_purchase_invoice.sql`) — not a
weighted average across purchase history, not FIFO. This is a deliberate
choice, not an omission: the merchant's real question is "what does this
ingredient cost me *today*," which drives today's pricing decision, not "what
did my inventory cost *on average*," which is the accountant's question.

Trade-off, stated honestly: a single unusually expensive emergency purchase
(buying milk from a convenience store at 3x the supplier price because a
delivery failed) moves this value until the next normal purchase corrects
it. This system does not smooth that away — WBS 7.4's drift alert is the
intended way it gets surfaced to the merchant, so they can see the spike and
judge it themselves rather than have it silently averaged into invisibility.

`ingredient_cost_history` (WBS 6.6, `packages/db/migrations/
0045_ingredient_cost_history.sql`) is the append-only audit trail this
method produces: one row per confirmed purchase that actually moved
`current_unit_cost_satang`, carrying the old cost, the new cost, and the
source invoice. It is the only way to answer "why did this ingredient's
cost change" after the fact, and it is what WBS 7.4's drift baseline reads.
Only `console_confirm_purchase_invoice` writes to it; no policy grants
`authenticated` or `anon` write access, the same posture as
`order_status_history` (0032).

## RL-1 — no platform balance, ever

`packages/db/migrations/0020_rl1_structural_proof.sql` is a dedicated,
comment-only, no-op migration stating explicitly that this schema contains
no table representing a platform balance, escrow, float, wallet,
ledger_account, or payout. This absence is structural, not incidental:
Brew Ledger money moves directly from the customer's bank to the merchant's
own PromptPay account (`stores.promptpay_id`/`promptpay_type`,
`payments.payee_alias` — one row per payment attempt, carrying the
merchant's own alias as evidence). Brew Ledger never holds, nets, or
settles money on a merchant's behalf.

`stock_ledger` is a ledger of *stock quantity* (base units of an
ingredient — grams, milliliters, pieces), not of money. Its name contains
"ledger" only because it follows the same append-only movement-log pattern
as an accounting ledger; it carries no currency amount and does not match
the RL-1 introspection test's regex (`/balance|escrow|float|wallet|payout|
ledger_account/` — note `ledger_account` is a compound the bare word
`stock_ledger` does not contain).

## RL-2 — no forced recipe

`bom_lines` (Bill of Materials) is entirely optional. A `menu_items` row
can be inserted, published, and sold with **zero** related `bom_lines`
rows — there is no `NOT NULL`, no foreign key *from* `menu_items`, and no
trigger requiring a recipe. The seed data (`packages/db/seed.sql`) includes
exactly this case: of the 4 demo menu items, one has zero `bom_lines`, so
its cost resolves to `NULL` — proving the path works, not just documenting
that it should.

## Table reference

Grouped by area. `store_id` column noted as `direct` or the join path to
reach one (every table reaches `store_id` in at most one join, per WBS 3.5
rule 5 — this is what makes WBS 3.6's RLS policies possible without
multi-hop subqueries).

### Identity

| Table | Purpose | `store_id` |
|---|---|---|
| `merchants` | One row per Supabase Auth user who owns a store. `auth_user_id` is the link to `auth.users`. | n/a — scoped by `auth_user_id = auth.uid()` instead; stores reach merchants, not the reverse. |
| `stores` | The tenant root. `slug` is the public URL segment (`/s/{slug}`). Carries the RL-1 PromptPay evidence columns and `is_published`. | is the root — `id = store_id` |

### Menu

| Table | Purpose | `store_id` |
|---|---|---|
| `menu_categories` | Per-store category list, CRUD independent of menu items. | direct |
| `menu_items` | Sellable items. `price_satang`, `availability`. | direct |
| `menu_option_groups` | E.g. "Temperature", "Sweetness" — belongs to one menu item. `store_id` is **denormalised** here (not strictly required by the join graph) because this table backs one of the anon role's four RLS SELECT policies (WBS 3.6) that run on every unauthenticated menu page load — a direct predicate is cheaper than a two-hop subquery. | direct (denormalised) |
| `menu_options` | E.g. "Hot", "Iced" — belongs to one option group, carries `price_delta_satang`. | one join: `option_group_id → menu_option_groups.store_id` |
| `ingredients` | Store's raw-material list. `current_unit_cost_satang` is nullable (null until a bill is confirmed). Only table in this schema with `updated_at` + trigger, since it's the one row that's legitimately mutated post-insert. | direct |
| `bom_lines` | Recipe lines. Optional — see RL-2 above. | direct |

### Ordering

| Table | Purpose | `store_id` |
|---|---|---|
| `pickup_slots` | Time-slot capacity. `booked_count <= capacity` is a hard constraint the slot-booking logic (WBS 5.3) relies on. | direct |
| `orders` | One row per order. `status` lifecycle: `PENDING_PAYMENT → ACCEPTED → PREPARING → READY → COLLECTED`, or `CANCELLED`/`REFUNDED`/`EXPIRED`. Carries the manual payment-confirmation columns (`payment_confirmed_by`, `payment_confirmed_at`) that replace the old gateway-webhook flow. | direct |
| `order_items` | Line items, with the frozen cost/price snapshot columns. `store_id` denormalised per dictionary rule 5. | direct (denormalised) |
| `order_item_options` | Normalized record of which options were selected — distinct from `order_items.options_snapshot` (a jsonb display cache the tracking page reads directly). Kept separate because Phase 7 reporting needs to aggregate option selections ("how many iced vs hot"), which a jsonb column can't index cleanly. | one join: `order_item_id → order_items.store_id` |
| `payments` | One row per payment attempt. `payee_alias` is the RL-1 evidence (the merchant's own PromptPay alias, not Brew Ledger's). `store_id` denormalised per dictionary rule 5. | direct (denormalised) |

### Inventory & purchasing

| Table | Purpose | `store_id` |
|---|---|---|
| `stock_ledger` | Append-only stock movement log. Stock level is *derived* from this, never overwritten in place. `reason` enumerates why a movement happened. | direct |
| `purchase_invoices` | One row per OCR-captured or manually entered bill. `ocr_status`/`review_status` track the capture→review pipeline. | direct |
| `purchase_line_items` | Individual line items on an invoice, mapped (or not yet mapped) to an ingredient. `store_id` denormalised per dictionary rule 5. | direct (denormalised) |

### Platform

| Table | Purpose | `store_id` |
|---|---|---|
| `job_queue` | Generic async job table for the Render worker. `store_id` is **nullable** — some jobs (e.g. a platform-wide nightly sweep) aren't store-scoped. This is intentional, not an omission. | direct, nullable |
| `daily_financials` | One row per store per day — pre-aggregated for fast reporting. `total_cogs_satang`/`net_profit_satang` are nullable ("null-aware: excludes untracked") and `untracked_item_count` discloses how many sales had no cost data rather than hiding the gap. | direct |

## Indexes

Every index lives in the same migration file as the table it belongs to
(not a separate indexes-only file), so table and index definitions can't
drift apart under repeated `IF NOT EXISTS` runs. Full list, by table, in
the migration files themselves; the ones called out explicitly by the WBS
dictionary (rule 6):

- `orders (store_id, created_at desc)`
- `orders (status) where status = 'PENDING_PAYMENT'` — partial index, only indexes the hot-path status
- `payments (order_id)`
- `stock_ledger (store_id, ingredient_id, created_at desc)`
- `job_queue (status, run_after) where status = 'pending'` — partial index
- `pickup_slots (store_id, slot_start)` — covered by the `unique (store_id, slot_start)` constraint's implicit index, no separate statement needed
- `daily_financials (store_id, business_date)` — covered by the `unique (store_id, business_date)` constraint's implicit index

Plus one per uncovered foreign key on the four new tables and elsewhere
(Postgres does not auto-index the referencing side of a foreign key) —
see `docs/db/schema_design.md` §6 for the complete additional list and
reasoning.

## Seed data

`packages/db/seed.sql` — one demo merchant (phone-OTP auth user), one
published store (`slug = 'demo-cafe'`), 4 menu items (exactly one with zero
`bom_lines`, proving RL-2), 3 costed ingredients, today's pickup slots at
15-minute intervals from 07:00 to 10:00 (capacity 3 each), and one
confirmed purchase invoice. Verified against the live linked `brewledger-dev`
project: loads with zero FK violations, and the zero-BOM item is
independently confirmed via query (`items_with_no_bom = 1` of 4 total).

## What's deliberately not here yet

See `docs/db/schema_design.md` §7 for the full list of what was
consciously not ported from the old Prisma schema (gateway/fee/webhook
columns and tables — no gateway exists in this architecture; `CostHistory`
— redundant with `purchase_line_items` joined to `purchase_invoices`;
`StaffUser` — deferred, single-owner model for now) and one flagged real
gap: `daily_financials.other_expense_satang` implies a non-ingredient
expense source (rent, wages) that has no source table anywhere in this
schema — either it's meant to be entered directly with no line-item detail,
or a table is missing. Not resolved here; needs a product decision before
WBS 7.8 is designed.
