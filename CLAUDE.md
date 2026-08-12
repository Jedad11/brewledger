# Brew Ledger

Financial infrastructure for Thai independent coffee SMEs. Full scope, work
breakdown, and acceptance criteria live in
[`BrewLedger_WBS_Dictionary.md`](./BrewLedger_WBS_Dictionary.md) — read it
before any non-trivial change, especially anything touching payments, the
data model, or the Customer Web surface.

**Tech stack:** Next.js (React + TypeScript) × 2 surfaces, NestJS on Cloud
Run, PostgreSQL (Cloud SQL) via Prisma, a licensed PromptPay gateway,
PaddleOCR, Web Push (VAPID) with polling fallback, Firebase Auth (Phone OTP),
Google Cloud Storage.

## Monorepo layout

```
apps/
  console/    Owner Console — authenticated, merchant-scoped (Next.js)
  api/        Backend API (NestJS)
  shop/       Customer Web — unauthenticated, public — NOT YET SCAFFOLDED
packages/
  db/         Prisma schema, generated client, migrations, seed script
  shared/     Code safe for both front-end surfaces — never anything from
              packages/db
```

## Commands

```bash
pnpm dev              # Owner Console dev server (apps/console)
pnpm dev:api          # NestJS API dev server (apps/api)
pnpm build            # build all workspaces
pnpm lint             # lint each workspace with its own config
pnpm lint:boundary    # RL-3 import-boundary check (apps/shop -> db/console)
pnpm typecheck        # tsc --noEmit across all workspaces
pnpm db:migrate       # prisma migrate dev (packages/db)
pnpm db:seed          # seed the demo store
pnpm db:reset         # drop + recreate dev DB from migrations
```

## Red lines

These override convenience and schedule pressure everywhere in the repo.
Full detail in `BrewLedger_WBS_Dictionary.md` §"Red Lines" and per-column
detail in [`docs/data_dictionary.md`](./docs/data_dictionary.md).

- **RL-1** — Customer money settles directly into the *merchant's own*
  gateway account. Never a Brew Ledger-held balance, float, or pooled
  settlement table. `packages/db/prisma/schema.prisma` has no such table by
  design — keep it that way.
- **RL-2** — A merchant can create a menu, publish it, and take orders
  without ever entering a BOM/recipe. `MenuItem.bomLines` must stay optional;
  never add a required field that blocks selling without costing data.
- **RL-3** — Customer Web must never expose cost, margin, expense, stock, or
  store-aggregate data. Enforced structurally by `eslint.config.mjs` at the
  repo root (blocks `apps/shop` from importing `packages/db` or
  `apps/console`) — verified working via `pnpm lint:boundary`. Every schema
  column is classified `PUBLIC_SAFE` / `MERCHANT_ONLY` in
  `docs/data_dictionary.md`; keep that file in sync when the schema changes.

## Current state — what's built vs. not

Covers WBS **3.1** (monorepo + CI), **3.3** (full data model), **3.4**
(migrations + seed). Explicitly **not** built yet:

- **3.2** — GCP provisioning (Cloud Run, Cloud SQL, Secret Manager). Needs
  real cloud credentials.
- **3.5 / 3.6** — the `/api/public` vs `/api/console` module split with
  allow-list DTOs, and the tenant-scoping Prisma extension. `apps/api` today
  is a single unguarded module tree with just a health check
  (`GET /api/health`).
- **3.7** — signed-URL object storage for bill images.
- `apps/shop` itself (Customer Web front-end).

**Environment caveat:** this was built without a reachable local
Postgres/Docker, so `prisma migrate dev` and `pnpm db:seed` have not been run
against a live database — don't assume seeded demo data already exists
anywhere until someone has actually run them.

See [`README.md`](./README.md) for full setup steps.
