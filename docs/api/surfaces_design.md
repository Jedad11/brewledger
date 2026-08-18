# API Surface Separation and Public Serializer — Design

WBS 3.7 design leg (architect). Implements the second line of defence for
RL-3 — `docs/db/rls_design.md` / `docs/security/rls.md` (WBS 3.6) is the
first line, enforced inside Postgres before a row leaves the database. This
document designs the layer above it: two disjoint Edge Function scopes, and
allow-list serializers that build every Customer Web response field by hand
so that a future RLS policy change, a `service_role` call, or a stray join
can bring merchant-only data into memory without it ever reaching the wire.

This document does not implement anything. `engineer` implements it against
this design; `qa_engineer` writes the tests specified in §7; `redline_reviewer`
audits both independently.

---

## 0. What already exists that this design builds on

- **18-table schema** — `docs/db/schema.md`, as-built in `packages/db/migrations/`.
- **RLS** — `docs/security/rls.md`. Exactly 5 anon-visible tables/policy groups
  (`stores` published, `menu_items` non-hidden, `menu_option_groups`,
  `menu_options`, `pickup_slots` open/non-full/future) plus two `security
  definer` RPCs, `public_order_status(p_order_code text)` and
  `public_order_lookup(p_phone text, p_order_code text)`, both returning
  `{order_code, status, pickup_at, item_name, quantity}` — already
  implemented in `packages/db/migrations/0021_rls.sql`.
- **Generated row types** — `packages/db/src/types.ts`, `Database["public"]["Tables"][table]["Row"]`.

RLS filters *rows* — which `stores`/`menu_items`/etc. records anon can see at
all. This design filters *columns* — which fields of an already-visible row
are allowed to leave the serializer. The two layers overlap in purpose but
not in mechanism, which is exactly the point of defence in depth: a bug in
one does not automatically defeat the other.

---

## 1. Directory structure

```
supabase/functions/
  _shared/
    public/            imported ONLY by public-* functions
      db.ts              anon-key Supabase client factory
      response.ts        JSON response helper (status, headers, CORS)
    console/             imported ONLY by console-* functions
      auth.ts             the guard designed in §5 — REQUIRED, not optional
      db.ts               authenticated-context Supabase client factory
      response.ts
  public-store/
    index.ts             GET  /public-store?slug=...        -> PublicStore
  public-menu/
    index.ts             GET  /public-menu?slug=...          -> { categories, items, optionGroups, options }
  public-slots/
    index.ts             GET  /public-slots?slug=...          -> PublicSlot[]
  public-order-status/
    index.ts             GET  /public-order-status?code=...&phone=...
                          -> PublicOrderStatus[]  (wraps public_order_status / public_order_lookup)
  _tests/
    public_snapshots.test.ts
```

No `console-*` function directory is scaffolded yet. Reasoning in §6b.

### The no-cross-import rule

`public-*` functions may import from `_shared/public/` and from
`packages/shared` (isomorphic, both-surfaces-safe). They may **never** import
from `_shared/console/`. `console-*` functions are the mirror: `_shared/console/`
and `packages/shared`, never `_shared/public/`.

Enforced by an `import/no-restricted-paths` zone in a new
`supabase/functions/eslint.config.mjs` (Deno functions are still plain
TypeScript for lint purposes — `deno lint` runs separately in CI for Deno-
specific concerns, this ESLint pass is the RL-3 boundary check only):

```js
{
  files: ["supabase/functions/public-*/**/*.ts"],
  rules: {
    "import/no-restricted-paths": ["error", {
      zones: [{
        target: "./supabase/functions/public-*",
        from: "./supabase/functions/_shared/console",
        message: "public-* may never import _shared/console/ — RL-3, WBS 3.7.",
      }],
    }],
  },
},
{
  files: ["supabase/functions/console-*/**/*.ts"],
  rules: {
    "import/no-restricted-paths": ["error", {
      zones: [{
        target: "./supabase/functions/console-*",
        from: "./supabase/functions/_shared/public",
        message: "console-* may never import _shared/public/ — keep the scopes disjoint, WBS 3.7.",
      }],
    }],
  },
},
```

This is a new config file, not an edit to the existing root
`eslint.config.mjs` — that file's own header comment scopes it to the
`apps/shop`/`apps/console` cross-app boundary; Edge Functions are a third,
separate root and get their own config so the two concerns don't tangle.

### Why only four `public-*` functions, not more

The dictionary's example prompt does not enumerate concrete function names.
Mapping the 4 anon-visible RLS groups plus the 2 RPCs to endpoints yields
exactly four functions — one per customer-facing read the anon key is
allowed to perform today:

| Function | Backs | Anon RLS policy / RPC used |
|---|---|---|
| `public-store` | store header (`/s/[slug]`) | `anon_read_published_stores` |
| `public-menu` | menu page (categories, items, option groups, options) | `anon_read_published_menu_items`, `anon_read_menu_option_groups`, `anon_read_menu_options` (+ `menu_categories`, which has no anon RLS policy at all — see below) |
| `public-slots` | slot picker at checkout | `anon_read_open_pickup_slots` |
| `public-order-status` | `/track` | `public_order_status` / `public_order_lookup` RPCs |

**`menu_categories` has zero anon RLS policies** (`docs/security/rls.md` §2.1,
deliberately deferred to this WBS entry). `public-menu` is where that
deferral resolves: the function runs as `service_role` (not the anon key)
for the `menu_categories` read specifically — a plain category name/sort_order
list, no cost/margin data on that table at all — then serializes it through
`toPublicMenuCategory` (§2) same as every other field. This is safe *only*
because the function-level allow-list serializer is the boundary here, not a
table policy; `menu_categories` stays RLS-closed to `anon` at the database
layer exactly as designed, and the Edge Function is the one place with
`service_role` credentials that reads it, then narrows before responding.
Flag this explicitly in the function's file header comment.

**No `public-checkout` / `public-pay` / `public-order-create` function is
scaffolded.** Order creation, slot booking with concurrency control, and
PromptPay QR issuance are WBS 5.x (order lifecycle, not yet designed by this
agent — see WBS 5.7 in the coverage table) and WBS 5.5 (PromptPay payload
builder, not yet built). Scaffolding an empty `public-checkout/index.ts` now
would either (a) sit as a stub nobody has designed the request/response
contract for, inviting an engineer to guess at it later under time pressure,
or (b) get built ad hoc without going through this same architect-first
Pattern A discipline the rest of the schema/RLS work went through. Deferred
entirely, not stubbed. This is also why `PublicPaymentIntent` is deferred
in §2 rather than shape-declared now — same reasoning, stated once here.

---

## 2. DTO builders — `packages/shared/src/serializers/public.ts`

File header (verbatim, matches the dictionary's required wording):

```ts
// RL-3. Every field emitted to Customer Web is listed here by hand. If you
// are about to add a spread operator to this file, stop and read WBS 3.7.
```

Row types come from `packages/db/src/types.ts`'s generated `Database["public"]["Tables"][...]["Row"]`
shapes — imported as type-only (`import type`) so no runtime dependency on
`packages/db` leaks into a function whose deploy target is Deno.

### PublicStore

```ts
import type { Database } from "@brewledger/db/types";
type StoreRow = Database["public"]["Tables"]["stores"]["Row"];

export interface PublicStore {
  id: string;
  slug: string;
  name: string;
  pickupAddress: string | null;
  timezone: string;
  opensAt: string | null;
  closesAt: string | null;
  promptpayId: string | null;   // RL-1 evidence field, public by design — this
                                 // is the merchant's OWN payment routing alias,
                                 // not a secret. Never any other promptpay_*
                                 // column (verified_at is merchant-only).
}

export function toPublicStore(row: StoreRow): PublicStore {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    pickupAddress: row.pickup_address,
    timezone: row.timezone,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    promptpayId: row.promptpay_id,
  };
}
```

`merchant_id`, `promptpay_type`, `promptpay_verified_at`, `is_published`,
`created_at` are deliberately absent — internal/merchant-only, no customer
use for any of them.

### PublicMenuCategory (new — not in the dictionary's original list, added per §1's `menu_categories` resolution)

```ts
type MenuCategoryRow = Database["public"]["Tables"]["menu_categories"]["Row"];

export interface PublicMenuCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export function toPublicMenuCategory(row: MenuCategoryRow): PublicMenuCategory {
  return { id: row.id, name: row.name, sortOrder: row.sort_order };
}
```

`store_id` and `created_at` omitted — the response is already scoped to one
store by the request; no reason to echo the FK back.

### PublicMenuItem (per the dictionary's own example — reproduced with real column names)

```ts
type MenuItemRow = Database["public"]["Tables"]["menu_items"]["Row"];

export interface PublicMenuItem {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceSatang: number;
  availability: "available" | "out_of_stock" | "hidden";
  sortOrder: number;
}

export function toPublicMenuItem(row: MenuItemRow): PublicMenuItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_path ? publicImageUrl(row.image_path) : null,
    priceSatang: row.price_satang,
    availability: row.availability as PublicMenuItem["availability"],
    sortOrder: row.sort_order,
  };
}
```

`store_id`, `created_at` omitted. Note: RLS already excludes `hidden` rows
from what `public-menu` even receives when reading through the anon path;
when `public-menu` reads via `service_role` for the `menu_categories` join
(§1), the function itself must additionally filter `availability <> 'hidden'`
before calling this serializer — the serializer narrows columns, not rows,
so row-filtering discipline still belongs to the function body. Call this
out in the function's own code comment, not just here.

### PublicOptionGroup / PublicOption

```ts
type OptionGroupRow = Database["public"]["Tables"]["menu_option_groups"]["Row"];
type OptionRow = Database["public"]["Tables"]["menu_options"]["Row"];

export interface PublicOptionGroup {
  id: string;
  menuItemId: string;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
}

export function toPublicOptionGroup(row: OptionGroupRow): PublicOptionGroup {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    name: row.name,
    isRequired: row.is_required,
    minSelect: row.min_select,
    maxSelect: row.max_select,
    sortOrder: row.sort_order,
  };
}

export interface PublicOption {
  id: string;
  optionGroupId: string;
  name: string;
  priceDeltaSatang: number;
  sortOrder: number;
}

export function toPublicOption(row: OptionRow): PublicOption {
  return {
    id: row.id,
    optionGroupId: row.option_group_id,
    name: row.name,
    priceDeltaSatang: row.price_delta_satang,
    sortOrder: row.sort_order,
  };
}
```

### PublicSlot

```ts
type SlotRow = Database["public"]["Tables"]["pickup_slots"]["Row"];

export interface PublicSlot {
  id: string;
  slotStart: string;
  slotEnd: string;
  remaining: number;    // capacity - booked_count, computed, never raw capacity/booked_count
}

export function toPublicSlot(row: SlotRow): PublicSlot {
  return {
    id: row.id,
    slotStart: row.slot_start,
    slotEnd: row.slot_end,
    remaining: row.capacity - row.booked_count,
  };
}
```

**Deliberate design choice**: `capacity` and `booked_count` are never emitted
raw, only their difference. Exposing raw `booked_count` lets a competitor
infer the store's real order volume per slot — not a red-line violation
(it's not cost/margin/profit/expense/stock), but it's store-aggregate-shaped
information with no customer-facing use, so it's narrowed here on the same
minimal-disclosure principle the DTOs are built on generally. `is_open` is
also omitted — RLS already guarantees every row `public-slots` receives has
`is_open = true`, so echoing a field that can only ever be one value back to
the client is dead weight, not information.

### PublicOrderStatus

Wraps the two RPCs directly — they already return an allow-listed shape at
the database layer (`docs/security/rls.md` §"RPCs"), so this is a pass-through
type declaration plus a Zod-validated boundary (§3), not a field-by-field
rebuild:

```ts
export interface PublicOrderStatus {
  orderCode: string;
  status: string;
  pickupAt: string | null;
  itemName: string;
  quantity: number;
}

// The RPC's own column list IS the allow-list; this function only renames
// snake_case RPC output to camelCase for the client, field by field, same
// discipline as every other builder in this file.
export function toPublicOrderStatus(row: {
  order_code: string;
  status: string;
  pickup_at: string | null;
  item_name: string;
  quantity: number;
}): PublicOrderStatus {
  return {
    orderCode: row.order_code,
    status: row.status,
    pickupAt: row.pickup_at,
    itemName: row.item_name,
    quantity: row.quantity,
  };
}
```

### PublicPaymentIntent — deferred, not built

**Decision: defer entirely, do not forward-declare a shape.** Reasons:

1. No `payments`-adjacent Edge Function logic exists at all yet — `public-checkout`
   doesn't exist (§1), and nothing computes a `qr_payload` today.
2. The PromptPay payload builder (`packages/shared`, WBS 5.5) hasn't been
   designed. A DTO shape guessed ahead of that design is more likely to be
   wrong — and to need editing the moment 5.5 actually happens — than to save
   real work now. `docs/db/schema_design.md`'s established pattern for a
   genuinely undecided item (`daily_financials.other_expense_satang`, its §7)
   is to **name the gap and stop**, not to speculatively fill it in; this
   follows the same discipline.
3. Unlike `menu_categories` (§1), which had a concrete, already-designed table
   and RLS policy set to resolve against, `PublicPaymentIntent` has no backing
   table decision made yet — `payments.qr_payload`/`payments.expires_at` exist
   in the schema, but what a *customer-facing* intent object should expose
   (does it include the raw EMVCo string, a rendered QR image URL, both, an
   amount confirmation, an idempotency token?) is a WBS 5.5 design question,
   not a serializer-mechanics question this entry owns.

When WBS 5.5 is dispatched, its architect leg designs `PublicPaymentIntent`
alongside the payload builder, in this same file, following the exact
pattern established by the six DTOs above. Do not add a stub type or an empty
builder function here in the meantime — an unused, undesigned export is more
likely to be copied into real use half-finished than to be helpful as a
placeholder.

---

## 3. Zod schemas — `packages/shared/src/serializers/public.schema.ts`

One `.strict()` schema per DTO, mirroring the interfaces in §2 field for
field (not derived by `z.infer` in the builder direction — the schema is
authored independently so a mismatch between the TS type and the runtime
schema is a compile/test-time signal, not silently unified away):

```ts
import { z } from "zod";

export const publicStoreSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  pickupAddress: z.string().nullable(),
  timezone: z.string(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  promptpayId: z.string().nullable(),
}).strict();

export const publicMenuCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sortOrder: z.number().int(),
}).strict();

export const publicMenuItemSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  priceSatang: z.number().int().nonnegative(),
  availability: z.enum(["available", "out_of_stock", "hidden"]),
  sortOrder: z.number().int(),
}).strict();

export const publicOptionGroupSchema = z.object({
  id: z.string().uuid(),
  menuItemId: z.string().uuid(),
  name: z.string(),
  isRequired: z.boolean(),
  minSelect: z.number().int().nonnegative(),
  maxSelect: z.number().int().nonnegative(),
  sortOrder: z.number().int(),
}).strict();

export const publicOptionSchema = z.object({
  id: z.string().uuid(),
  optionGroupId: z.string().uuid(),
  name: z.string(),
  priceDeltaSatang: z.number().int(),
  sortOrder: z.number().int(),
}).strict();

export const publicSlotSchema = z.object({
  id: z.string().uuid(),
  slotStart: z.string(),
  slotEnd: z.string(),
  remaining: z.number().int().nonnegative(),
}).strict();

export const publicOrderStatusSchema = z.object({
  orderCode: z.string(),
  status: z.string(),
  pickupAt: z.string().nullable(),
  itemName: z.string(),
  quantity: z.number().int().positive(),
}).strict();
```

### `parseOrThrow` helper

```ts
export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Deliberately do not include result.error.issues' values in the thrown
    // message going to the client-facing response — the invalid VALUE could
    // itself be the leaked field this whole schema exists to catch. Server
    // logs (Edge Function console.error) get the full issue detail; the
    // HTTP response gets a flat 500 with no body detail, same posture as the
    // console-* auth guard's failure mode in §5.
    console.error("public DTO shape violation", result.error.issues);
    throw new Error("internal serialization error");
  }
  return result.data;
}
```

Every `public-*` function calls `parseOrThrow(publicXSchema, dto)` on the
object `toPublicX()` just produced, immediately before `Response.json(...)`.
This is what makes an accidentally-added field fail loudly at runtime even
if the hand-written builder in §2 slipped past review — `.strict()` rejects
any key not named in the schema.

---

## 4. Anti-spread ESLint rule — honest scope

**The dictionary's literal ask — ban `SpreadElement` "on any identifier
whose type resolves to a DB row type," generically, anywhere in `apps/shop`
and `public-*` — is not fully expressible as an off-the-shelf ESLint rule
configuration.** `typescript-eslint`'s type-checked rules (already a
dependency per WBS 3.2/3.6) give AST-level access to the TypeScript type
checker, but there is no built-in rule that takes "ban spread when the
operand's *resolved* type structurally matches a generated `Database[...]["Row"]`
shape" as a config option — that requires a **custom rule**, because the
check ("does this type include a `store_id`/etc. field set matching a known
Row shape") is arbitrary logic against the type checker, not a selector
pattern.

**What is genuinely buildable, and what this design specifies instead of
overclaiming:**

A **custom local ESLint rule**, `eslint-rules/no-db-row-spread.cjs` (checked
in at repo root, referenced by both `eslint.config.mjs` and the new
`supabase/functions/eslint.config.mjs` from §1), built with
`@typescript-eslint/utils`'s `ESLintUtils.RuleCreator` and the type-checked
parser services (`context.sourceCode.getTypeChecker()` /
`services.getTypeAtLocation(node)`). Its actual, honestly-scoped check:

- **Flags**: `SpreadElement` inside an object expression, `Object.assign(...)`,
  and `structuredClone(...)` whenever the spread/first-argument's *type name*
  or *declared type* is one of:
  1. A type imported from `packages/db/src/types.ts` (i.e. `Database["public"]["Tables"][string]["Row"]`
     or a type alias directly assigned from it — matched by resolving the
     symbol's declaration file path, not by structural inference), or
  2. A local type alias whose name matches `/Row$/` (the generated-types
     naming convention every row type in this codebase already follows —
     see `packages/db/src/types.ts`'s `Row`/`Insert`/`Update` shape), giving
     a second, narrower net for a hand-declared row-shaped type that wasn't
     imported directly.
- **Does not attempt**: proving type-level assignability against every
  possible structural shape (a plain object literal that merely *happens* to
  have the same fields as a Row type, with no nominal or import link to it,
  will not be caught). Catching that fully would require running a real
  structural-subtype check against every table's Row shape on every spread in
  the codebase — expensive, and still incomplete against deliberately
  obfuscated cases (e.g. spreading through an intermediate untyped variable).
  This is a defence-in-depth backstop, not a soundness proof; the primary
  guarantee remains the hand-written builders in §2 plus code review, exactly
  as the dictionary's own framing describes it ("stops the application from
  emitting it if ... a service-role call, or a join ever brings it into
  memory" — a backstop, not the only barrier).

Rule config surface (what `engineer` wires into both ESLint configs):

```js
{
  files: ["apps/shop/**/*.{ts,tsx}", "supabase/functions/public-*/**/*.ts"],
  plugins: { local: localRulesPlugin },   // exports no-db-row-spread
  rules: {
    "local/no-db-row-spread": "error",
  },
}
```

Error message (verbatim, per the dictionary): `"RL-3 violation: build public
DTOs field by field. See WBS 3.7."`

**Proof fixture**: `eslint-rules/__fixtures__/no-db-row-spread.violation.ts.disabled`
— a deliberate `{ ...storeRow }` against an imported `StoreRow` type, plus a
second case using the `/Row$/`-suffix path with a locally declared type, so
both detection paths in the rule are exercised. Matches the pattern WBS 3.1
used for the import-boundary rule's own proof fixture
(`scripts/test-import-boundary-regression.sh`) — `qa_engineer` wires a CI
step that copies the `.disabled` fixture to a real `.ts` file, runs lint,
asserts it fails with the expected message, then removes it, mirroring that
script's plant/assert/remove structure rather than inventing a new pattern.

---

## 5. `console-*` auth guard — `_shared/console/auth.ts`

Deny-by-default, non-optional by construction: a `console-*` function is
required to obtain its request context by calling the guard, and the
handler-factory signature makes writing a handler that skips the call a type
error, not just a lint warning.

```ts
// supabase/functions/_shared/console/auth.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface ConsoleContext {
  merchantId: string;
  storeIds: string[];
  supabase: SupabaseClient;   // authenticated-role client, RLS applies as this user
}

/**
 * Verifies the request's Supabase JWT (Authorization: Bearer <token>),
 * resolves auth.uid() to a merchants row, and returns the merchant's id
 * plus every store_id they own (via the same auth_store_ids() the RLS
 * layer uses — one source of truth for "which stores does this user own",
 * not a second hand-rolled query that could drift from the RLS definition).
 *
 * Returns `null` on ANY failure (missing header, invalid/expired JWT, no
 * matching merchants row) -- the caller (withConsoleAuth below) is
 * responsible for turning that into a 401 with no body detail. This
 * function itself never throws and never leaks WHY verification failed.
 */
export async function verifyConsoleRequest(req: Request): Promise<ConsoleContext | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,     // NEVER service_role here — this
    { global: { headers: { Authorization: authHeader } } },
    // client authenticates AS the caller; RLS on every subsequent query
    // enforces store scoping independently of this function's own logic.
  );

  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) return null;

  const { data: storeIds, error: storeErr } = await supabase.rpc("auth_store_ids");
  if (storeErr) return null;

  const { data: merchant, error: merchantErr } = await supabase
    .from("merchants")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .single();
  if (merchantErr || !merchant) return null;

  return {
    merchantId: merchant.id,
    storeIds: (storeIds ?? []).map((row: { auth_store_ids: string }) => row.auth_store_ids),
    supabase,
  };
}

/**
 * Handler-factory: the ONLY sanctioned way to define a console-* Edge
 * Function handler. `handler` cannot be written without accepting a
 * ConsoleContext parameter -- there is no code path to a console-* response
 * body that does not pass through verifyConsoleRequest first. A function
 * file that calls Deno.serve(rawHandler) directly instead of going through
 * this factory is the review-blocking violation to look for; there is no
 * lint rule for it (a runtime code-shape check has diminishing returns
 * versus review), so it is called out explicitly here as a manual review
 * item for redline_reviewer.
 */
export function withConsoleAuth(
  handler: (req: Request, ctx: ConsoleContext) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const ctx = await verifyConsoleRequest(req);
    if (!ctx) {
      return new Response(null, { status: 401 });   // no body -- no detail leaked
    }
    return handler(req, ctx);
  };
}
```

Every `console-*` `index.ts` is required to be shaped:

```ts
import { withConsoleAuth } from "../_shared/console/auth.ts";

Deno.serve(withConsoleAuth(async (req, ctx) => {
  // ctx.merchantId, ctx.storeIds, ctx.supabase all available here.
  // ...
}));
```

`search_path = public` note: this guard calls `auth_store_ids()` via
`supabase.rpc(...)`, the same RPC RLS already defines with
`set search_path = public` (`docs/security/rls.md`) — no new
`security definer` function is introduced by this design, so there is no new
`search_path` surface to pin. If a future `console-*` function needs its own
`security definer` RPC, that RPC's design must set `search_path = public`
per the existing RLS design rule, verified at that RPC's own review.

No `console-*` function is scaffolded under `supabase/functions/` yet (§6b)
— this file is infrastructure `engineer` builds now so the guard exists
before the first real console business-logic function needs it, not a
function itself.

---

## 6. `apps/api` disposition

### 6a. What's there today

Confirmed directly (`Glob apps/api/src/**`): `app.module.ts`,
`health/health.controller.ts`, `health/health.module.ts`, `main.ts`,
`prisma/{prisma.module.ts,prisma.service.ts}`. A NestJS app whose only real
endpoint is a health check wired to a Prisma client that no longer has a
schema to generate against (`packages/db` moved to raw SQL migrations in WBS
3.5). `MIGRATION_PLAN.md` step 4 already calls this correctly: "ตอนนี้
`apps/api` มีแค่ health check ... ถอดตอนนี้ถูกจังหวะที่สุด" (it's just a
health check, this is the cheapest possible time to remove it).

### 6b. Decision: delete, no replacement function

Nothing in `apps/api` survives the split as a `console-*` or `public-*`
function:

- The health check has no equivalent need in the target architecture.
  Vercel (both `apps/shop` and `apps/console`) and Supabase Edge Functions
  are both managed platforms with their own built-in liveness/deploy-health
  signals (Vercel's deployment status API, Supabase's function invocation
  logs and dashboard) — neither needs an application-defined `/health`
  endpoint the way a self-hosted, always-running NestJS server on a VM or
  container needs one to be probed by an external load balancer or
  orchestrator. `worker/` (the Render service) is the one component in this
  architecture that similarly runs continuously and could in principle want
  a liveness probe, but that is Render's own health-check config against
  the worker's actual job-processing behavior (WBS 3.3 territory, not this
  entry), not a port of `apps/api`'s NestJS health controller.
- `PrismaService`/`PrismaModule` have no target — Prisma is fully retired
  per `MIGRATION_PLAN.md`'s "ทำไม Prisma ไปต่อไม่ได้" section (RLS can't be
  expressed in Prisma schema, Prisma bypasses RLS entirely by connecting as
  a single role, and Edge Functions run on Deno where Prisma's client story
  is poor). Nothing about the Prisma-backed health check is worth carrying
  forward even as a rewrite.

**This is deliberately a small, low-cost part of this WBS entry** — matching
the dispatch's own framing. There is no module-mapping exercise to do beyond
confirming (as above) that nothing maps to anything.

### 6c. Deletion plan (for `engineer`)

1. `git rm -r apps/api`.
2. Remove any `apps/api` workspace reference from the root `pnpm-workspace.yaml`
   / root `package.json` workspaces list, if present.
3. Remove the `apps/api` mention from `eslint.config.mjs`'s header comment
   (currently: `// apps/api (NestJS) is being removed — see MIGRATION_PLAN.md step 4.`)
   — once deleted, update that comment to a past-tense note or remove it,
   so a future reader isn't left looking for a removal that already happened.
4. Grep the repo for any remaining `apps/api` reference (docs, CI config,
   `.env.example` cross-references) and update or remove — `MIGRATION_PLAN.md`'s
   own "เช็คว่าย้ายสำเร็จ" section's `grep -rn "prisma\|@prisma"` check is the
   right verification command to rerun after deletion; it should return zero
   hits outside `apps/api`'s own now-deleted tree (and outside `MIGRATION_PLAN.md`
   itself, which documents the migration and is expected to still mention
   Prisma historically).
5. No new Edge Function or worker file is added to replace it (per §6b).

---

## 7. Test contract for `qa_engineer` (spec only)

| Test | Target | Asserts |
|---|---|---|
| Response snapshot, one per public endpoint | `supabase/functions/_tests/public_snapshots.test.ts` | Exact response body of `public-store`, `public-menu`, `public-slots`, `public-order-status` against a committed fixture (seeded `demo-cafe` data from `packages/db/seed.sql`). A field added to a DTO without updating the snapshot fails CI — this is what makes "adding a field requires editing the serializer AND the snapshot" true in practice, not just in the dictionary's stated intent. |
| Forbidden-field CI scan | new CI step, greps every committed snapshot file | No snapshot contains any substring from `/docs/design/forbidden_fields.json` (§7a below — the file does not exist yet; this entry creates it). |
| Zod strict-mode extra-key test | one per schema in `public.schema.ts` | Constructing a valid DTO object, adding one extra key (e.g. `costSatang: 100`), asserting `.strict().safeParse(...)` fails — proves the schema would actually catch a real leak attempt, not just validate the happy path. |
| Auth guard 401 test | any `console-*` function once one exists, or a synthetic test handler built with `withConsoleAuth` in the interim | Request with no `Authorization` header → 401, empty body. Request with a malformed/expired JWT → 401, empty body. Confirms no stack trace, error message, or `WWW-Authenticate` detail leaks in either case. |
| Lint rule proof-of-concept | `eslint-rules/__fixtures__/no-db-row-spread.violation.ts.disabled` | CI step copies the fixture to a real `.ts` path, runs `pnpm lint`, asserts failure with the exact `"RL-3 violation: build public DTOs field by field. See WBS 3.7."` message on both the direct-import-type case and the `/Row$/`-suffix case (§4), then removes the copy. Mirrors `scripts/test-import-boundary-regression.sh`'s plant/assert/remove shape. |
| Cross-import boundary test | `supabase/functions/eslint.config.mjs` zones (§1) | A synthetic `public-*` file importing from `_shared/console/` fails lint; a synthetic `console-*` file importing from `_shared/public/` fails lint. Same plant/assert/remove pattern. |

### 7a. `/docs/design/forbidden_fields.json` — does not exist yet, ownership decision

Confirmed via `Glob docs/design/forbidden_fields.json` — no match, the file
referenced by the dictionary's Step 5 does not exist. **Decision: `engineer`
creates it as part of implementing this WBS entry** (not `qa_engineer`, even
though a test consumes it) — it is a design-time allow/deny artifact
co-located with the serializer it protects, same category as
`docs/data_dictionary.md`'s per-column classification
(`MIGRATION_PLAN.md`'s "ใช้ต่อได้ เป็น input ของ allow-list serializer"),
not a test fixture `qa_engineer` would own. `qa_engineer`'s job is writing
the CI step that *consumes* it (§7 above), not authoring its contents.

Seed content this design specifies (`engineer` may extend, never narrow,
without a documented reason):

```json
{
  "forbidden_substrings": [
    "cost_satang", "current_unit_cost_satang", "unit_cost_snapshot_satang",
    "total_cost_snapshot_satang",
    "margin", "profit",
    "expense", "other_expense_satang",
    "stock", "booked_count", "capacity",
    "cogs", "total_cogs_satang",
    "merchant_id", "auth_user_id",
    "payment_confirmed_by",
    "promptpay_verified_at",
    "ocr_status", "review_status",
    "payload", "last_error"
  ]
}
```

Note `capacity`/`booked_count` are listed even though `public-slots`'s own
DTO (§2, `PublicSlot`) already never emits them raw — the CI scan is a
second, independent check against the *actual committed response bytes*,
not a re-check of the serializer's source code; it should fail loudly if a
future edit to `toPublicSlot` ever reintroduces either field, which is
exactly the "can never happen by accident" property the dictionary's
acceptance criteria ask for.

---

## 8. Summary — files this design produces (for `engineer` to create)

| Path | Content |
|---|---|
| `supabase/functions/_shared/public/db.ts`, `response.ts` | anon-key client factory, JSON response helper |
| `supabase/functions/_shared/console/auth.ts` | §5, verbatim |
| `supabase/functions/_shared/console/db.ts`, `response.ts` | authenticated-client factory, JSON response helper |
| `supabase/functions/public-store/index.ts` | §1/§2 `PublicStore` |
| `supabase/functions/public-menu/index.ts` | §1/§2 `PublicMenuCategory`, `PublicMenuItem`, `PublicOptionGroup`, `PublicOption` |
| `supabase/functions/public-slots/index.ts` | §1/§2 `PublicSlot` |
| `supabase/functions/public-order-status/index.ts` | §1/§2 `PublicOrderStatus`, wraps both RPCs |
| `supabase/functions/eslint.config.mjs` | §1 no-cross-import zones |
| `packages/shared/src/serializers/public.ts` | §2, all six DTO builders |
| `packages/shared/src/serializers/public.schema.ts` | §3, six `.strict()` schemas + `parseOrThrow` |
| `eslint-rules/no-db-row-spread.cjs` | §4 |
| `eslint-rules/__fixtures__/no-db-row-spread.violation.ts.disabled` | §4 proof fixture |
| `docs/design/forbidden_fields.json` | §7a |
| `supabase/functions/_tests/public_snapshots.test.ts` | §7 (qa_engineer writes this, listed here for completeness of the file map) |

Not produced by this entry: `PublicPaymentIntent` (§2, deferred to WBS 5.5),
any `console-*` function beyond the shared auth guard (§6b/§1 — no console
business logic is designed yet for this guard to protect), `apps/api`'s
replacement (§6b — there is none).
