# WBS 3.6 — Row Level Security: Architect Design

Status: design only. This is the specification `engineer` implements as a SQL
migration in `packages/db/migrations/`, and `qa_engineer` writes
`packages/db/tests/rls.test.ts` against. No `.sql` or `.ts` ships from this
entry. Companion to `docs/db/schema_design.md` (WBS 3.5), which this design
consumes directly (§5 of that doc gives every table's join path to
`store_id` — not re-derived here).

This is the **primary enforcement point of RL-3**: Supabase exposes Postgres
to the browser through PostgREST using the `anon` key, which ships inside the
Customer Web bundle. A table without RLS is a table anyone can `curl`.
Deny-by-default, then a minimal explicit allow-list.

---

## 0. The dictionary/schema gap, resolved

`BrewLedger_WBS_Dictionary.md`'s WBS 3.6 text was written against an earlier,
abridged table list. It never mentions `order_item_options` at all, and its
Step 3 merchant-policy enumeration and Step 1 pseudocode both predate the
as-built 18-table schema (`docs/db/schema.md`). This design covers **all 18
real tables**, not the dictionary's literal list. Where I extend past the
dictionary's exact text (`menu_categories`'s anon visibility, `job_queue`'s
access model), I flag the reasoning explicitly — see §2 and §1 respectively.

---

## 1. RLS enabled, every table, one statement per line

```sql
alter table merchants            enable row level security;
alter table stores               enable row level security;
alter table menu_categories      enable row level security;
alter table menu_items           enable row level security;
alter table menu_option_groups   enable row level security;
alter table menu_options         enable row level security;
alter table ingredients          enable row level security;
alter table bom_lines            enable row level security;
alter table pickup_slots         enable row level security;
alter table orders               enable row level security;
alter table order_items          enable row level security;
alter table order_item_options   enable row level security;
alter table payments             enable row level security;
alter table stock_ledger         enable row level security;
alter table purchase_invoices    enable row level security;
alter table purchase_line_items  enable row level security;
alter table job_queue            enable row level security;
alter table daily_financials     enable row level security;
```

18 statements, 18 tables. No `DO` block, no loop over
`information_schema.tables` — a table added later without an explicit line
here is a table someone forgot, and forgetting must be loud, not silently
absorbed by a loop.

---

## 2. Policy decision per table (all 18, explicit)

| # | Table | RLS enabled | Merchant policy (`authenticated`) | `anon` policy | Notes |
|---|---|---|---|---|---|
| 1 | `merchants` | yes | `FOR ALL` — `auth_user_id = auth.uid()` | none | root of merchant scoping, no `store_id` |
| 2 | `stores` | yes | `FOR ALL` — `id in (select auth_store_ids())` | **SELECT**, published only | anon policy #1 |
| 3 | `menu_categories` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | **none** — see §2.1 | extends past dictionary's literal 4; decided against |
| 4 | `menu_items` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | **SELECT**, non-hidden + published store | anon policy #2 |
| 5 | `menu_option_groups` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | **SELECT**, visible menu item | anon policy #3 |
| 6 | `menu_options` | yes | `FOR ALL` via one join — see §3 | **SELECT**, visible menu item | anon policy #3 (continued) |
| 7 | `ingredients` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | none | cost data, RL-3 |
| 8 | `bom_lines` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | none | recipe data, RL-3 |
| 9 | `pickup_slots` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | **SELECT**, open/not-full/future/published | anon policy #4 |
| 10 | `orders` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | **none** — RPC only, see §4 | never a table policy |
| 11 | `order_items` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | none | contains `unit_cost_snapshot_satang` |
| 12 | `order_item_options` | yes | `FOR ALL` via one join — see §3 | none | not in dictionary text at all; order data, stays closed |
| 13 | `payments` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | none | RL-1 evidence, merchant-only |
| 14 | `stock_ledger` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | none | stock data, RL-3 |
| 15 | `purchase_invoices` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | none | expense data, RL-3 |
| 16 | `purchase_line_items` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | none | expense data, RL-3 |
| 17 | `job_queue` | yes | **none** — see §2.2 | none | `store_id` nullable, platform-internal rows exist |
| 18 | `daily_financials` | yes | `FOR ALL` — `store_id in (select auth_store_ids())` | none | store aggregate, RL-3 |

Count check: 5 tables carry an `anon` SELECT policy (`stores`, `menu_items`,
`menu_option_groups`, `menu_options`, `pickup_slots`) implementing the
dictionary's **four categories** of exposed data (option groups + options
count as one category, two `CREATE POLICY` statements — the dictionary's own
pseudocode bullet groups them as `menu_option_groups`/`menu_options`
together). 16 of 18 tables carry a merchant `FOR ALL` policy; `merchants`
scopes differently (`auth_user_id`, no `store_id`); `job_queue` carries none
by design (§2.2).

### 2.1 `menu_categories` — anon visibility, decided against, with a replacement path

The dictionary's four `anon` categories do not include `menu_categories`.
Category names are not sensitive on their own (no cost, margin, or
store-aggregate content — just organizational labels like "Coffee",
"Bakery"), so a case exists for a 5th anon policy. **I am deciding against
adding one**, for a structural reason, not just literal adherence to "four":

- The dictionary's WBS 3.6 acceptance criteria and CI-facing test contract
  (§6 below) are written against "exactly four" `anon` categories. Adding a
  5th here means every future reviewer has to re-derive whether the count
  drifted by omission or by a reasoned addition — the kind of ambiguity RLS
  changes can't afford.
- **WBS 3.7 ("API surface separation and public serializer") is the correct
  owner of this problem, not 3.6.** The Customer Web menu page needs
  category names for grouping, but it does not need row-level `anon` access
  to the `menu_categories` table to get them — it needs a bundled read, the
  same pattern already used for order lookup (§4): a `security definer` RPC
  (or a view built by 3.7's public serializer) that joins `menu_categories`
  server-side and returns only `{id, name, sort_order}` alongside the menu
  items it groups. This keeps `menu_categories` closed at the RLS layer
  (deny-by-default, zero anon rows via direct `select`) while still serving
  the UI need through the narrow, allow-listed surface 3.7 is designed to
  own.
- Net effect: `menu_categories` belongs in the anon-zero-rows test set (§6),
  **not** in the anon-filtered-rows set. Flag this for whoever picks up 3.7:
  the public menu serializer needs a category-name path that does not go
  through a table-level anon grant.

### 2.2 `job_queue` — no `authenticated` or `anon` policy at all

`store_id` is nullable (`docs/db/schema.md`, `schema_design.md` §5) because
some jobs (platform-wide nightly sweeps) are not store-scoped. A merchant
`FOR ALL` policy scoped on `store_id in (select auth_store_ids())` would
silently exclude every `store_id is null` row from that merchant's own view
without excluding it from existing — which is correct for those rows (they
aren't the merchant's business) but does nothing to prevent a different
attack: `job_queue.payload`/`last_error` can carry internal job state
(OCR raw responses, worker retry detail) that hasn't been vetted as
customer- or even merchant-safe to expose directly.

**Decision: zero policies, for both `anon` and `authenticated`.** With RLS
enabled and no policy, both roles get zero rows — deny-by-default holds.
`service_role` (used only by the Render worker and Edge Function secrets,
per `CLAUDE.md`) bypasses RLS entirely via its role attribute in Supabase,
so the worker's actual job-processing queries are unaffected.

This means: **if a future WBS entry wants to surface job status to a
merchant** (e.g., "your bill photo is still processing" in the console), it
must **not** be done by adding an `authenticated` table policy here. It
should be a narrow `security definer` RPC — analogous to
`public_order_status` — that internally checks `store_id in (select
auth_store_ids())` (or `store_id is null` for platform jobs the merchant is
allowed to see, if any ever are) and returns only an allow-listed shape
(`job_type`, `status`, `created_at` — never `payload` or `last_error`
verbatim). Flagging this now so nobody "fixes" the missing merchant access
later by bolting on a blanket table policy.

---

## 3. `auth_store_ids()` helper — exact signature

```sql
create or replace function auth_store_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select s.id
  from stores s
  join merchants m on m.id = s.merchant_id
  where m.auth_user_id = auth.uid();
$$;
```

Matches the dictionary's pseudocode exactly; verified `merchants.auth_user_id`
and `stores.merchant_id` are the real column names (`packages/db/migrations/0002_merchants.sql`,
`0003_stores.sql`). `stable`, not `volatile` — it reads, doesn't write, and
Postgres can cache the result within one statement. `security definer` +
`set search_path = public` per the architect agent's rule for every
security-relevant function — without the explicit `search_path`, a
`security definer` function is vulnerable to a search-path hijack if a
malicious `public` schema object shadows `stores`/`merchants`.

### Merchant policy shape (repeated per direct-`store_id` table)

```sql
create policy merchant_rw_<table> on <table>
  for all to authenticated
  using      (store_id in (select auth_store_ids()))
  with check (store_id in (select auth_store_ids()));
```

Applies verbatim to: `stores` (using `id` in place of `store_id`),
`menu_categories`, `menu_items`, `menu_option_groups`, `ingredients`,
`bom_lines`, `pickup_slots`, `orders`, `order_items`, `payments`,
`stock_ledger`, `purchase_invoices`, `purchase_line_items`,
`daily_financials` — 14 tables, all with a direct `store_id` column
(`docs/db/schema_design.md` §5).

### One-join tables — `menu_options`, `order_item_options`

Neither carries its own `store_id`. Scope through the parent, per
`schema_design.md` §5:

```sql
create policy merchant_rw_menu_options on menu_options
  for all to authenticated
  using (
    option_group_id in (
      select id from menu_option_groups
      where store_id in (select auth_store_ids())
    )
  )
  with check (
    option_group_id in (
      select id from menu_option_groups
      where store_id in (select auth_store_ids())
    )
  );

create policy merchant_rw_order_item_options on order_item_options
  for all to authenticated
  using (
    order_item_id in (
      select id from order_items
      where store_id in (select auth_store_ids())
    )
  )
  with check (
    order_item_id in (
      select id from order_items
      where store_id in (select auth_store_ids())
    )
  );
```

### `merchants` itself

```sql
create policy merchant_rw_self on merchants
  for all to authenticated
  using      (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());
```

---

## 4. The exactly-four `anon` SELECT policies — exact predicates

Verified against real column names in `packages/db/migrations/0003_stores.sql`,
`0005_menu_items.sql`, `0006_menu_option_groups.sql`, `0007_menu_options.sql`,
`0010_pickup_slots.sql` — all match the dictionary's pseudocode; no column
renames needed.

```sql
-- 1. A published store is public by design: the customer has its link.
create policy anon_read_published_stores on stores
  for select to anon
  using (is_published = true);

-- 2. Menu items of a published store, excluding hidden ones. Column
--    narrowing (no price... wait, price IS public; cost/margin never on
--    this table anyway) happens in the public serializer (WBS 3.7); this
--    policy narrows ROWS only.
create policy anon_read_published_menu_items on menu_items
  for select to anon
  using (
    availability <> 'hidden'
    and store_id in (select id from stores where is_published = true)
  );

-- 3a. Option groups belonging to a visible menu item of a published store.
create policy anon_read_menu_option_groups on menu_option_groups
  for select to anon
  using (
    store_id in (select id from stores where is_published = true)
    and menu_item_id in (select id from menu_items where availability <> 'hidden')
  );

-- 3b. Options belonging to a visible option group (one join to reach
--     store/menu-item visibility, since menu_options has no direct store_id).
create policy anon_read_menu_options on menu_options
  for select to anon
  using (
    option_group_id in (
      select mog.id
      from menu_option_groups mog
      join menu_items mi on mi.id = mog.menu_item_id
      join stores s on s.id = mog.store_id
      where mi.availability <> 'hidden'
        and s.is_published = true
    )
  );

-- 4. Open, future, non-full slots of a published store. A full slot must be
--    ABSENT from the result set, not merely disabled — booked_count < capacity
--    is a row filter, not a "sold out" flag the client has to interpret.
create policy anon_read_open_pickup_slots on pickup_slots
  for select to anon
  using (
    is_open = true
    and booked_count < capacity
    and slot_start > now()
    and store_id in (select id from stores where is_published = true)
  );
```

**No anon policy on any other table — confirmed for all remaining 13**:
`merchants`, `menu_categories` (§2.1), `ingredients`, `bom_lines`, `orders`
(§5 — RPC only), `order_items`, `order_item_options`, `payments`,
`stock_ledger`, `purchase_invoices`, `purchase_line_items`, `job_queue`
(§2.2), `daily_financials`. Deny-by-default (RLS enabled, zero policy) means
`anon` gets zero rows from a direct `select` against any of these thirteen.

---

## 5. Customer order lookup — two RPCs, no table policy on `orders`

Never a table-level `anon` policy on `orders` or `order_items` — a narrow
`security definer` RPC returning only an allow-listed shape. Column names
verified against `packages/db/migrations/0011_orders.sql` and
`0012_order_items.sql`.

```sql
-- Order status by code alone (existing /track?code=... flow, dictionary's
-- original pseudocode).
create or replace function public_order_status(p_order_code text)
returns table (
  order_code text,
  status text,
  pickup_at timestamptz,
  item_name text,
  quantity integer
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
    oi.quantity
  from orders o
  join order_items oi on oi.order_id = o.id
  left join pickup_slots ps on ps.id = o.pickup_slot_id
  where o.order_code = p_order_code;
$$;

revoke all on function public_order_status(text) from public;
grant execute on function public_order_status(text) to anon;

-- Order lookup requiring BOTH phone and code (WBS 3.6 Claude Code Step 5,
-- for the /track screen's phone-based lookup) -- a phone number alone must
-- enumerate nothing, so both predicates are ANDed, never OR'd, and neither
-- is optional (both params non-null, no default).
create or replace function public_order_lookup(p_phone text, p_order_code text)
returns table (
  order_code text,
  status text,
  pickup_at timestamptz,
  item_name text,
  quantity integer
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
    oi.quantity
  from orders o
  join order_items oi on oi.order_id = o.id
  left join pickup_slots ps on ps.id = o.pickup_slot_id
  where o.order_code = p_order_code
    and o.customer_phone = p_phone;
$$;

revoke all on function public_order_lookup(text, text) from public;
grant execute on function public_order_lookup(text, text) to anon;
```

**Return signature check (both RPCs identical shape)**: `order_code text,
status text, pickup_at timestamptz, item_name text, quantity integer`. No
field name matches `/cost|margin|profit|fee|expense|stock/` — confirmed by
inspection; `qa_engineer` should assert this programmatically against
`information_schema.routines`/the actual returned row keys, not just trust
this doc (§6).

**Notes for `engineer`:**
- `public_order_lookup`'s phone comparison is a straight `=` here against
  `orders.customer_phone` as stored. If WBS 5.x normalizes phone numbers on
  order creation (e.g., strips formatting, forces E.164), this RPC's
  comparison must use the same normalization, applied to `p_phone` before
  comparing — otherwise a customer typing `081-234-5678` gets zero rows
  against a `+66812345678`-stored value even though it's their own order.
  Decide the normalization function once, reuse it on both write (order
  creation) and read (this RPC) paths. Flagging, not resolving — out of
  this design's scope (3.6 doesn't own phone formatting).
- Both RPCs return one row per order item, not one row per order — a
  multi-item order returns multiple rows sharing the same `order_code`/
  `status`/`pickup_at`. The `/track` UI groups client-side. This matches the
  dictionary's own pseudocode shape; not a deviation.
- Neither RPC exposes `orders.total_satang`/`subtotal_satang` — the
  dictionary's return signature genuinely omits even the paid amount, not
  just cost/margin. If product wants the customer to see what they paid on
  the tracking page, that's an explicit, reviewed addition to this
  signature (still safe — `total_satang` is what the *customer* paid, not a
  margin figure) — not something to add silently while implementing.

---

## 6. Migration file placement

**`packages/db/migrations/0021_rls.sql`** — next sequential number after
`0020_rl1_structural_proof.sql`. Single file, not split, for three reasons:

1. **Atomicity of a security boundary.** RLS coverage is a binary property —
   either every table is protected or the schema is exploitable. Splitting
   across files creates a window (between file N and file N+1 applying)
   where some tables are covered and others aren't, if a partial deploy ever
   happens. One file applies in one transaction (`supabase db push` wraps
   each migration file in a transaction) — no partial-RLS state is
   representable.
2. **Reviewability.** A reviewer checking RL-3 compliance wants one diff to
   read top to bottom: enable-everywhere, then every policy, then the two
   RPCs. Splitting into `0021_rls_enable.sql` / `0022_rls_merchant.sql` /
   `0023_rls_anon.sql` / `0024_rls_rpcs.sql` doesn't reduce risk — it adds
   four opportunities for the sequence to be reordered or partially applied
   in a bad rebase.
3. **Precedent.** `0020_rl1_structural_proof.sql` already established the
   pattern of one file per cross-cutting structural proof/rule, and the
   dictionary's own suggested path (`packages/db/migrations/<next>_rls.sql`)
   is singular.

Internal structure `engineer` should follow — numbered section comments
matching this doc's own sections, so a reviewer can jump straight from a
`/docs/security/rls.md` row to the matching SQL block:

```
-- SECTION 1: enable RLS on every table (§1)
-- SECTION 2: auth_store_ids() helper (§3)
-- SECTION 3: merchant policies, direct-store_id tables (§3)
-- SECTION 4: merchant policies, one-join tables + merchants itself (§3)
-- SECTION 5: the four anon SELECT policy groups (§4)
-- SECTION 6: public_order_status / public_order_lookup RPCs (§5)
```

Guard every `create policy` with a preceding `drop policy if exists` (the
pattern already used for triggers in `0008_ingredients.sql`/
`0012_order_items.sql`) so the file is re-runnable, matching migration
discipline. `alter table ... enable row level security` is already
idempotent in Postgres (no `IF NOT EXISTS` needed or available for it — it's
a no-op if already enabled).

This migration only adds security to existing rows; it rewrites nothing, so
the performance-fixture timing rule (migration discipline, `CLAUDE.md`) does
not apply — but confirm a backup ran within 24h before applying to
production regardless, since a policy typo that's too restrictive can lock
the merchant themselves out of their own console mid-service.

---

## 7. Adversarial test contract (spec for `qa_engineer`, not implemented here)

`packages/db/tests/rls.test.ts`, using a **real `anon`-key Supabase client**
against the local Docker stack (`supabase start`), not a mocked one — per
`docs/db/schema.md`'s own note that "RLS is not yet applied" was true only
until this migration lands, and the tests are what prove it actually did.

**1. Introspection — every table has `relrowsecurity = true`**
```sql
select relname from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'
  and relrowsecurity = false;
-- must return zero rows. If it returns any, CI fails — this is the test
-- that catches a table added later without its RLS line.
```
Assert row count is exactly 0. Additionally assert the *count of tables
checked* is >= 18 (not just that zero are missing RLS) — a query that
returns zero rows because it matched zero tables total is a false pass if
`information_schema` filtering is wrong. Cross-check against `select
count(*) from information_schema.tables where table_schema='public' and
table_type='BASE TABLE'` and assert that number is 18 (or whatever the
current true count is — pin it, don't let the test silently tolerate an
18-turned-17 regression from a botched migration).

**2. Anon-zero-rows — 13 tables, not the dictionary's original 9**

The dictionary's Step 6 names 11: `ingredients`, `bom_lines`,
`purchase_invoices`, `purchase_line_items`, `stock_ledger`,
`daily_financials`, `payments`, `job_queue`, `merchants`, `orders`,
`order_items`. This design adds **`order_item_options`** (never named in the
dictionary's WBS 3.6 text at all — order data, must stay closed) and
**`menu_categories`** (§2.1 — deliberately excluded from the anon allow-list)
for a total of **13**. For each: assert the anon client's `select * from
<table>` returns `length === 0`, **and** separately assert with the
`service_role` client on the same fixture that the table is not merely
empty (at least one row exists) — otherwise a zero-row result is
indistinguishable from "no test data," which is not what RLS coverage
proves.

**3. Anon-filtered-rows — the 5 tables with an anon policy**

- `stores`: anon sees only `is_published = true` rows; a service-role query
  on the same fixture confirms at least one unpublished store exists that
  anon does *not* see.
- `menu_items`: anon sees only `availability <> 'hidden'` rows belonging to
  a published store; assert a hidden item and an item on an unpublished
  store are both absent.
- `menu_option_groups` / `menu_options`: anon sees only groups/options
  under a visible menu item of a published store.
- `pickup_slots`: anon sees only `is_open and booked_count < capacity and
  slot_start > now()` rows of a published store. **Full-slot-absent test**:
  seed a slot with `booked_count = capacity`, assert it does not appear in
  the anon result set at all (not present-but-flagged-full — absent).

**4. Unpublished-store-invisible-by-slug**

Seed an unpublished store with a known `slug`. Query it directly by exact
slug match via the anon client (`select * from stores where slug =
'known-slug'`). Assert zero rows — a correct slug must not bypass
`is_published`.

**5. Cross-tenant isolation, per table, looped**

Two authenticated fixtures: merchant A (owns store A) and merchant B (owns
store B), each with at least one row in every merchant-owned table (16
tables — all of §2's list except `merchants` itself and `job_queue`, which
has no authenticated policy at all so this test doesn't apply to it; test
`merchants` separately per below). Loop: authenticate as merchant A, assert
`select * from <table>` returns rows only where `store_id` (or the joined
equivalent for `menu_options`/`order_item_options`) belongs to store A,
never store B. Repeat as merchant B. Assert counts match what service_role
sees for each merchant, so the test isn't passing by accident on an
already-empty result.

**6. `merchants` self-scoping**

Authenticated as merchant A, `select * from merchants` returns exactly the
row where `auth_user_id = A`'s uid, never merchant B's row.

**7. `job_queue` — no access via either role**

Authenticated as merchant A (who owns store-scoped jobs) and as anon, both
`select * from job_queue` return zero rows, even though service_role sees
rows for store A in the same fixture. This is the test that proves §2.2's
decision (no policy at all) actually holds, not just that RLS is "enabled"
in the abstract.

**8. RPC signature and behavior test**

- `select * from public_order_status('<real-code>')` via anon client:
  returns the expected row(s); assert the returned column set is exactly
  `{order_code, status, pickup_at, item_name, quantity}` — no more, no
  fewer — and assert none of those names, or any nested key if the driver
  returns objects, matches `/cost|margin|profit|fee|expense|stock/`.
- `select * from public_order_lookup(p_phone, p_order_code)`: correct
  phone + correct code returns the order; correct phone + **wrong** code
  returns zero rows; **wrong** phone + correct code returns zero rows —
  this last case is the one that proves phone alone can't enumerate orders
  by guessing codes, and code alone (via this RPC specifically, not
  `public_order_status`) can't be paired with a guessed phone either.
- Assert `public_order_status`/`public_order_lookup` are not callable by
  directly selecting the underlying `orders`/`order_items` tables as anon
  (covered by test 2, but worth a comment in the RPC test tying the two
  together, since the whole point of the RPC pattern is that the table
  stays closed while the function stays open).

---

## Summary for the report back

- All 18 real tables get RLS enabled (§1); every table gets an explicit
  policy decision, not just the dictionary's originally-named subset (§2
  table).
- `menu_categories`: no anon policy — deliberately narrower than "any
  non-sensitive data can be exposed"; the category-name-for-grouping need
  is deferred to WBS 3.7's public serializer/RPC, not solved by a 5th
  table-level anon grant here (§2.1).
- `job_queue`: no policy for `anon` or `authenticated` at all — nullable
  `store_id` plus potentially-sensitive `payload`/`last_error` content means
  even merchant access should go through a future narrow RPC, not a blanket
  table policy (§2.2).
- 5 tables carry the dictionary's "exactly four" anon SELECT policies
  (`stores`, `menu_items`, `menu_option_groups`, `menu_options`,
  `pickup_slots` — option groups/options counted as one dictionary
  category, two `CREATE POLICY` statements) (§4).
- Order access stays off `orders`/`order_items` entirely; two RPCs,
  `public_order_status(p_order_code text)` and `public_order_lookup(p_phone
  text, p_order_code text)`, both returning exactly `order_code text,
  status text, pickup_at timestamptz, item_name text, quantity integer` —
  no cost/margin/fee/expense/stock field in either (§5).
- Migration lands as a single file, `packages/db/migrations/0021_rls.sql`,
  reasoning in §6.
- Full adversarial test contract for `qa_engineer` in §7, including the two
  extensions beyond the dictionary's literal list (`order_item_options`,
  `menu_categories` in the zero-rows set) and the `job_queue`-specific
  no-access test.
