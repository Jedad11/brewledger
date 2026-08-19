# Row Level Security — Policy Reference

Implements `docs/db/rls_design.md` (architect, WBS 3.6 design leg) as
`packages/db/migrations/0021_rls.sql` (mirrored into
`supabase/migrations/0021_rls.sql`). This is the **primary enforcement point
of RL-3**: Customer Web never exposes cost, margin, profit, expense, stock,
or store-aggregate data.

## Why RLS is the first line, not the last

Supabase exposes Postgres directly to the browser through PostgREST, using an
`anon` API key that ships inside the Customer Web JavaScript bundle — anyone
who opens dev tools has it. A table with RLS disabled and no other access
control is a table anyone can read with `curl` and that key, no application
code involved at all. RL-3's other layers — the import boundary that blocks
`apps/shop` from reaching `apps/console`/`packages/costing`, and the
allow-list serializers that build public DTOs field by field — matter, but
they only govern what BrewLedger's *own* frontend code chooses to request.
Neither stops a direct request against `https://<project>.supabase.co/rest/v1/<table>`
with the anon key and no application code in between at all.

RLS is therefore evaluated first, inside Postgres itself, before a single row
leaves the database — deny-by-default, then a minimal, explicit allow-list.
Every table in `public` has RLS enabled (18 of 18); most carry zero `anon`
policies, so `anon` gets zero rows from a direct `select` even before the
application layer runs. Only five tables carry an `anon` `SELECT` policy, and
each predicate below is the entire boundary for that table's public
visibility — there is no second gate downstream that a bug elsewhere could
silently fall back on.

## Policy table

| Table | Role | Operation | Predicate | Justification |
|---|---|---|---|---|
| `merchants` | `authenticated` | ALL | `auth_user_id = auth.uid()` | Root of merchant scoping; no `store_id` column to key off of. |
| `stores` | `authenticated` | ALL | `merchant_id in (select auth_merchant_id())` | Merchant manages only stores they own. `stores` is exempt from the `auth_store_ids()` pattern used below — that helper queries `stores` itself, so gating `stores`'s own policy through it is self-referential and makes `INSERT` unsatisfiable (`0026_stores_insert_bootstrap_fix.sql`). `auth_merchant_id()` reads only `merchants`, avoiding the cycle. |
| `stores` | `anon` | SELECT | `is_published = true` | A published store is public by design — the customer has the link. Anon policy #1. |
| `menu_categories` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Merchant-owned. |
| `menu_categories` | `anon` | — none — | — | Deliberately excluded (design §2.1). Category names are needed for menu grouping, but that need belongs to WBS 3.7's public serializer/RPC, not a table-level anon grant. Stays in the anon-zero-rows set. |
| `menu_items` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Merchant-owned. |
| `menu_items` | `anon` | SELECT | `availability <> 'hidden' and store_id in (select id from stores where is_published = true)` | Public menu content of a published store, excluding hidden items. Anon policy #2. |
| `menu_option_groups` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Merchant-owned. |
| `menu_option_groups` | `anon` | SELECT | `store_id in (published stores) and menu_item_id in (visible menu_items)` | Option groups of a visible item on a published store. Anon policy #3a. |
| `menu_options` | `authenticated` | ALL | `option_group_id in (select id from menu_option_groups where store_id in (select auth_store_ids()))` | One-join table, no direct `store_id`. |
| `menu_options` | `anon` | SELECT | `option_group_id in (visible option groups of a published store, joined through menu_option_groups → menu_items → stores)` | Options of a visible group. Anon policy #3b. |
| `ingredients` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Cost data — merchant-only, RL-3. |
| `ingredients` | `anon` | — none — | — | Cost data must never reach Customer Web. |
| `bom_lines` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Recipe data — merchant-only, RL-3. |
| `bom_lines` | `anon` | — none — | — | Recipe/cost composition, never public. |
| `pickup_slots` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Merchant-owned. |
| `pickup_slots` | `anon` | SELECT | `is_open = true and booked_count < capacity and slot_start > now() and store_id in (published stores)` | Open, future, non-full slots only. A full slot is absent from the result, not present-but-flagged. Anon policy #4. |
| `orders` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Merchant-owned. |
| `orders` | `anon` | — none, table-level — | — | Customer access is through `public_order_status`/`public_order_lookup` RPCs only (below), never a direct table policy — a table policy can't enforce "code alone isn't enough" the way a two-parameter RPC can. |
| `order_items` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Carries `unit_cost_snapshot_satang` — merchant-only, RL-3. |
| `order_items` | `anon` | — none — | — | Same reasoning as `orders`. |
| `order_item_options` | `authenticated` | ALL | `order_item_id in (select id from order_items where store_id in (select auth_store_ids()))` | One-join table, no direct `store_id`. Not named anywhere in the WBS 3.6 dictionary text — order data, stays closed regardless. |
| `order_item_options` | `anon` | — none — | — | Order data. |
| `payments` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | RL-1 evidence — merchant-only. |
| `payments` | `anon` | — none — | — | Never public. |
| `stock_ledger` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Stock data, RL-3. |
| `stock_ledger` | `anon` | — none — | — | Never public. |
| `purchase_invoices` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Expense data, RL-3. |
| `purchase_invoices` | `anon` | — none — | — | Never public. |
| `purchase_line_items` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Expense data, RL-3. |
| `purchase_line_items` | `anon` | — none — | — | Never public. |
| `job_queue` | `authenticated` | — none — | — | `store_id` nullable (platform-wide jobs exist); `payload`/`last_error` may carry unvetted internal detail (OCR raw responses, worker retry state). No blanket merchant policy — a future merchant-facing job-status view must go through a narrow `security definer` RPC returning an allow-listed shape, not a table grant (design §2.2). |
| `job_queue` | `anon` | — none — | — | Never public. |
| `daily_financials` | `authenticated` | ALL | `store_id in (select auth_store_ids())` | Store-aggregate data, RL-3. |
| `daily_financials` | `anon` | — none — | — | Never public. |

### RPCs (bypass the table policy on `orders`/`order_items` entirely)

| Function | Args | Returns | Access | Justification |
|---|---|---|---|---|
| `public_order_status` | `p_order_code text` | `order_code, status, pickup_at, item_name, quantity` (one row per order item) | `anon` execute | Existing `/track?code=...` flow. No cost/margin/fee/expense/stock/`total_satang` field in the return shape — checked by name against `/cost\|margin\|profit\|fee\|expense\|stock/`. |
| `public_order_lookup` | `p_phone text, p_order_code text` (both required, no default) | same shape as above | `anon` execute | Phone-based `/track` lookup. Both predicates are ANDed — phone alone must not enumerate orders, and code alone through this function must not succeed without the matching phone either. |

Both functions are `security definer`, `stable`, `set search_path = public`,
and have `execute` revoked from `public` then explicitly granted to `anon`
only.

### `auth_store_ids()` helper

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

Every merchant policy on a direct-`store_id` table reduces to
`store_id in (select auth_store_ids())`. `menu_options` and
`order_item_options` have no `store_id` column of their own and instead scope
through one join to their parent (`menu_option_groups`, `order_items`
respectively) before applying the same `auth_store_ids()` check.

## Rule for new tables

**Any new table added to `public` requires an explicit RLS decision — enable
RLS and add whatever policies apply (which may be "none," stated deliberately,
as with `job_queue` and `menu_categories`'s anon access) — in the same PR that
creates the table.** A table that ships without this row being added here and
a corresponding `alter table ... enable row level security` in the same
migration is a table anyone with the `anon` key can read, and is a blocking
review finding, not a follow-up.
