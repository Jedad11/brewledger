# API Surfaces — `public-*` and `console-*`

Implementation of the design in `docs/api/surfaces_design.md` (WBS 3.7).
Second line of defence for RL-3: `docs/security/rls.md` (WBS 3.6) filters
*rows* inside Postgres; this layer filters *columns* — which fields of an
already-visible row leave the serializer.

## Two disjoint scopes

| Scope | Directory | Auth | Imports allowed | Imports forbidden |
|---|---|---|---|---|
| `public-*` | `supabase/functions/public-*/` | None — anon key only | `_shared/public/`, `packages/shared` | `_shared/console/` |
| `console-*` | `supabase/functions/console-*/` | Phone-OTP JWT, `Authorization: Bearer <token>` | `_shared/console/`, `packages/shared` | `_shared/public/` |

Enforced by `supabase/functions/eslint.config.mjs` (`import/no-restricted-paths`
zones) — run with `pnpm lint:functions`. No `console-*` function is
scaffolded yet; only its shared auth guard (`_shared/console/auth.ts`) exists,
built ahead of the first console business-logic function that needs it.

## `public-*` endpoints

| Function | Method | Query params | Response | Backs |
|---|---|---|---|---|
| `public-store` | GET | `slug` | `PublicStore` | Store header (`/s/[slug]`) |
| `public-menu` | GET | `slug` | `{ categories, items, optionGroups, options }` | Menu page |
| `public-slots` | GET | `slug` | `PublicSlot[]` | Slot picker at checkout |
| `public-order-status` | GET | `code`, optional `phone` | `PublicOrderStatus[]` | `/track` |

All four use the anon-key client (`_shared/public/db.ts`'s `createPublicClient`),
except `public-menu`'s `menu_categories` read, which uses
`createServiceRoleClient()` — the one documented exception, because
`menu_categories` carries zero anon RLS policy (`docs/security/rls.md` §2.1,
deliberately deferred to this entry). That read is narrowed through
`toPublicMenuCategory` before it reaches the response, and the function body
additionally filters `menu_items.availability <> 'hidden'` itself on that
same request, since the service-role path does not get RLS's non-hidden
filter for free.

Every DTO is built field-by-field in `packages/shared/src/serializers/public.ts`,
then validated against a `.strict()` Zod schema in
`packages/shared/src/serializers/public.schema.ts` via `parseOrThrow` —
an accidentally-added field fails loudly at runtime (flat 500, no body
detail — the invalid value could itself be the leaked field) even if the
hand-written builder slipped past review.

`PublicPaymentIntent` / `public-checkout` are deliberately not built — no
PromptPay payload builder (WBS 5.5) or checkout Edge Function exists yet to
design against. See `docs/api/surfaces_design.md` §2's "deferred, not built"
reasoning.

## `console-*` auth model

`supabase/functions/_shared/console/auth.ts` exports `withConsoleAuth`, the
only sanctioned way to define a `console-*` handler:

```ts
import { withConsoleAuth } from "../_shared/console/auth.ts";

Deno.serve(withConsoleAuth(async (req, ctx) => {
  // ctx.merchantId, ctx.storeIds, ctx.supabase
}));
```

`verifyConsoleRequest` resolves the request's JWT to a `merchants` row and
the caller's `store_id`s via `auth_store_ids()` — the same RPC RLS itself
uses, so there is one source of truth for "which stores does this user own."
Any failure (missing header, invalid/expired JWT, no matching merchant) is a
401 with an empty body — no detail about which check failed.

## Anti-spread lint backstop

`eslint-rules/no-db-row-spread.cjs` flags `{...row}` / `Object.assign(x, row)`
/ `structuredClone(row)` when `row`'s type is either imported from
`packages/db/src/types.ts` or a local alias named `/Row$/`. Wired into both
the root `eslint.config.mjs` (`apps/shop/**/*.{ts,tsx}`, activates once that
workspace exists) and `supabase/functions/eslint.config.mjs`
(`public-*/**/*.ts`). This is a backstop, not a soundness proof — see
`docs/api/surfaces_design.md` §4 for the honestly-scoped limits (a plain
object literal with no nominal/import link to a Row type is not caught).

Proof fixture: `eslint-rules/__fixtures__/no-db-row-spread.violation.ts.disabled`.
CI plants it under `supabase/functions/public-store/`, runs
`pnpm lint:functions`, asserts the exact message
`"RL-3 violation: build public DTOs field by field. See WBS 3.7."` on both
the imported-type and local-alias cases, then removes it — mirrors
`scripts/test-import-boundary-regression.sh`'s plant/assert/remove shape.

## Local serving

`supabase/functions/deno.json` is a shared import map — `@brewledger/db/types`
maps to the real `packages/db/src/types.ts` file, `zod` maps to `npm:zod@3` —
needed because `packages/shared/src/serializers/{public,public.schema}.ts`
are written for Node/tsc resolution (package specifiers) and Deno cannot
resolve either bare specifier without a map. **This local CLI version
(2.115.0) does not auto-discover a root-level `supabase/functions/deno.json`**
— it must be passed explicitly via `--import-map`, confirmed empirically
against `supabase functions serve` (the flag's absence produces a
`BOOT_ERROR` / "Module not found", not a silent fallback). Use
`pnpm functions:serve` (wraps `supabase functions serve --import-map
supabase/functions/deno.json`), and pass the same flag to
`supabase functions deploy` when that's next relevant.

## Forbidden fields

`docs/design/forbidden_fields.json` lists substrings that must never appear
in a `public-*` response body (`cost_satang`, `margin`, `profit`,
`booked_count`, `merchant_id`, `payload`, …). `qa_engineer`'s CI step greps
every committed response snapshot against this list.
