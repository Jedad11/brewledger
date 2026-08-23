# Brew Ledger

Financial infrastructure for Thai independent coffee SMEs — pre-order pickup
plus automatic unit costing, as a responsive web app.

Full scope, work breakdown, and acceptance criteria live in
[`BrewLedger_WBS_Dictionary.md`](./BrewLedger_WBS_Dictionary.md). **Read the
relevant entry before any non-trivial change**, especially anything touching
payments, the data model, or the Customer Web surface. The WBS is the
specification; this file is orientation.

## Tech stack

| Layer | Technology |
|---|---|
| Front end | Next.js 15 (App Router, TypeScript) × 2 surfaces on **Vercel** |
| Design system | `packages/ui` — tokens generated from `/design/brewledger-tokens.css` |
| Database | **Supabase PostgreSQL** with Row Level Security |
| Critical API | **Supabase Edge Functions** (Deno) — anything a human waits on |
| Async jobs | **Node worker on Render** — anything nobody waits on |
| Auth | Supabase Auth, phone OTP |
| Payments | **Direct merchant-owned PromptPay**, EMVCo QR generated locally. No gateway. |
| OCR | Typhoon OCR via the Float16 API — **deferred, see WBS 6.2/6.3.** Ingredient costing runs on manual entry only for now. |
| Notifications | Web Push (VAPID) with a mandatory polling fallback |

> **This stack replaced an earlier GCP plan** (Cloud Run + Cloud SQL + Prisma +
> licensed gateway + PaddleOCR + Firebase Auth). That plan is withdrawn: GCP
> requires a card pre-authorisation the team cannot clear, self-hosting a
> vision model needs GPU budget that does not exist, and gateway KYC excludes
> sole-proprietor merchants and takes 15–20 business days. See
> `docs/adr/001-infrastructure-choice.md` and `docs/adr/008-direct-promptpay.md`.
>
> **Anything in the repo still built on the old stack is being migrated.** See
> "Migration in progress" below before assuming a file is current.

## The critical-path rule

This is an architectural constraint, not a preference. Render's free tier spins
a service down after 15 minutes idle and the next request pays a 30–60 second
cold start.

- **A human is waiting** (menu, slot check, order creation, QR issue, payment
  confirmation, order status) → **Supabase Edge Function**. Never Render.
- **Nobody is waiting** (OCR extraction, cost recomputation, nightly
  aggregation, scheduled jobs) → **Render worker**. Never blocking a request.

Placing customer-blocking work on the worker is a defect even when it passes
its tests.

## Monorepo layout

```
apps/
  shop/                Customer Web — UNAUTHENTICATED, public. Vercel project 1
  console/             Owner Console — phone-OTP authenticated. Vercel project 2
packages/
  ui/                  Design system, ported from /design. Imported by BOTH surfaces
  db/                  SQL migrations, seeds, generated types
  costing/             Unit costing, BOM, margin — MERCHANT ONLY
  shared/              Types and pure helpers safe for both surfaces
supabase/
  functions/           Edge Functions — public-* and console-* scopes, disjoint
worker/                Node service on Render — async jobs only
design/                Delivered prototype and handoff spec — READ ONLY
docs/
  design/              state_matrix, interaction_spec, component_inventory, rules
  adr/                 Architecture decision records
```

## Commands

```bash
pnpm install
pnpm dev                 # Owner Console  (apps/console)
pnpm dev:shop            # Customer Web   (apps/shop)
pnpm dev:worker          # Async job worker (worker/) — generate_slots, expire_orders, etc.
pnpm build               # build all workspaces
pnpm lint                # lint each workspace
pnpm lint:boundary       # RL-3 import-boundary check
pnpm typecheck           # tsc --noEmit across workspaces

supabase start           # local Postgres + Auth + Storage — NOT Edge Functions, see below
pnpm functions:serve     # Edge Functions runtime — separate process, does not auto-start
pnpm db:push             # apply migrations to the linked project
pnpm db:reset            # drop, re-migrate, re-seed
pnpm db:types            # regenerate packages/db/src/types.ts from the schema
```

Running the full local stack needs **four** long-lived processes at once:
`supabase start` (once — daemonized), `pnpm functions:serve`, `pnpm dev:worker`,
and `pnpm dev` / `pnpm dev:shop`. Console and Customer Web read Supabase's URL
from each app's own `.env.local` (gitignored, not the committed `.env`) —
`apps/console/instrumentation.ts` and `apps/shop/instrumentation.ts` refuse to
start in dev if that value isn't `127.0.0.1`/`localhost`, specifically because
the two apps drifted onto different backends (one local, one remote) before
this guard existed. If `pnpm dev:worker` throws over a blank optional env var
(`FLOAT16_API_KEY`, `VAPID_PRIVATE_KEY`), comment the line out in `worker/.env`
rather than leaving it empty — `z.string().min(1).optional()` in
`packages/shared/src/config.ts` accepts "absent", not "blank".

**Missing `pnpm functions:serve` looks like a data/RLS bug but isn't.** If a
Customer Web page (e.g. `/s/[slug]`) throws "failed to load public store" (or
any `public-*`/`console-*` Edge Function 503s with `{"code":"BOOT_ERROR"}`),
check first whether `pnpm functions:serve` is actually running as its own
process — `supabase start` alone is not enough. `supabase start` ships its own
embedded edge runtime, but that runtime's bind-mount discovery has a bug: any
file reached only through a `deno.json` import-map alias (`@brewledger/db/types`,
`@brewledger/shared/features`) never gets mounted into its container, so every
function importing through one of those aliases fails to boot — which today
is effectively all of them. This is not fixable by editing source (switching
those imports to relative paths breaks the `tsc` build of `packages/shared`
instead — its `rootDir` doesn't extend into `packages/db`). The fix is
operational: start `pnpm functions:serve` as its own long-lived process: it
serves the same functions through a different mechanism that isn't affected.

## Red lines

These override convenience and schedule pressure everywhere in the repo. Full
detail in the WBS §"Red Lines"; per-column classification in
[`docs/data_dictionary.md`](./docs/data_dictionary.md).

**RL-1 — Money moves directly from the customer's bank to the merchant's own
PromptPay account.** No table may represent a platform balance, escrow, float,
wallet, ledger account, or payout. No bank account number, name, or branch is
persisted — only the merchant's PromptPay alias, which is a routing identifier
published in the national directory. Every generated QR payload names the
merchant as payee; a forbidden-payee test asserts this on every build.

**RL-2 — A merchant can create a menu, publish it, and take orders without ever
entering a recipe.** `bom_lines` carries no `NOT NULL`, no foreign key from
`menu_items`, and no trigger requiring a recipe row. **Unknown cost is `null`,
never `0`** — zero implies a 100% margin, which flatters the merchant and
misinforms their pricing. No screen may nag: the phrases `ยังไม่ได้ใส่`,
`ควรใส่`, `กรุณาใส่`, `ไม่ครบ`, `ยังขาด` are forbidden in `apps/console`.

**RL-3 — Customer Web never exposes cost, margin, profit, expense, stock, or
store-aggregate data.** Enforced in two layers, in this order:

1. **Row Level Security** — Supabase exposes Postgres to the browser through
   PostgREST using an `anon` key that ships in the public bundle. A table
   without RLS is readable by anyone with `curl`. RLS is the first line here,
   not defence in depth. Exactly four `anon` SELECT policies exist: published
   stores, their menu items, their option groups, their open future slots.
2. **Import boundary + allow-list serializers** — `eslint.config.mjs` blocks
   `apps/shop` from importing `apps/console` or `packages/costing`; public DTOs
   are built field by field, never by spreading a database row.

## Design is complete

The UI/UX was delivered as an interactive prototype with a full handoff spec.
Frontend entries **implement a specification**; they do not originate a design.

Precedence when sources disagree:

| Rank | Source |
|---|---|
| 1 | A red line |
| 2 | `docs/design/state_matrix.md` — exact Thai copy per state |
| 3 | `docs/design/interaction_spec.md` — realtime / optimistic / timeouts / tap targets |
| 4 | `docs/design/component_inventory.md` — prop contracts |
| 5 | The prototype in `/design/` |
| 6 | The WBS entry's own description |

Never paraphrase copy, never add a state, never define a one-off component,
never redesign a layout the prototype settles. **Never edit `/design/`** — it is
a delivered artefact. If the spec is wrong, correct `docs/design/` and say so.

## Money and typography rules that recur everywhere

- **Integer satang.** 1 THB = 100 satang. Every money column ends `_satang`.
  No float in the money path. The one legitimate decimal conversion is inside
  the PromptPay payload builder.
- **Cost is stored twice.** `ingredients.current_unit_cost_satang` moves with
  each confirmed bill; `order_items.unit_cost_snapshot_satang` is frozen at
  sale and protected by a trigger. Without this, last month's profit changes
  every time milk gets more expensive.
- **`MoneyValue` renders `—` for `null`.** Never `0`, `0.00`, `฿0`, `0%`, `100%`.
  Never format money inline with `toFixed`.
- **Tap targets.** Order status buttons 56px minimum, full width — the merchant
  taps them with a wet hand while holding a milk jug. Everything else 44px.
- **Thai typography.** Line-height ≥1.5 body, ≥1.35 headings. Test every screen
  with a 40-character Thai menu name and confirm no tone mark clips at 375px.

## Subagents

`.claude/agents/` defines four. Ownership does not overlap — see
[`.claude/agents/WORKFLOW.md`](./.claude/agents/WORKFLOW.md) for the call order.

| Agent | Owns | Never |
|---|---|---|
| `architect` | Schema, RLS, API boundaries, module structure | Implements, writes tests |
| `engineer` | All implementation — migrations, Edge Functions, worker, screens | Designs schema, writes tests |
| `qa_engineer` | Writes and runs tests | Production code |
| `redline_reviewer` | Read-only audit of RL-1/2/3, costing arithmetic, Thai copy | **Modifies any file** |

## Migration in progress — read before touching these

The repo was scaffolded against the withdrawn GCP stack. Numbering below is the
**current** WBS; the older `CLAUDE.md` used a different numbering that no longer
applies.

| Area | State | Action |
|---|---|---|
| `apps/console` | Next.js, keep | Rewire from Prisma to the Supabase client |
| `apps/api` (NestJS) | **To be removed** | Logic moves to `supabase/functions/` (critical path) and `worker/` (async). Do not add to it |
| `packages/db` | Prisma schema present | **Port the schema design to SQL migrations** — the model is sound, the format changes. RLS policies cannot be expressed in Prisma and must be raw SQL |
| `packages/shared` | Keep | Add the PromptPay payload builder here |
| `packages/ui`, `packages/costing` | **Not created** | WBS 2.2 and 6.x |
| `apps/shop` | **Not created** | The eslint boundary rule already covers it |
| `supabase/functions`, `worker/` | **Not created** | WBS 3.2, 3.3 |
| `/design`, `docs/design/` | **Not committed** | WBS 2.1 — commit the delivered package first; every frontend entry depends on it |

**WBS status under the current numbering:** 3.1 partially done (workspace and
boundary rule exist; layout needs the new packages). 3.5 has a data model that
needs porting. Everything else in Phase 3 is not started.

**Environment caveat:** no Postgres has been reachable in this environment, so
no migration has run against a live database. Do not assume seed data exists
anywhere until someone has actually run `supabase start && pnpm db:reset`.
