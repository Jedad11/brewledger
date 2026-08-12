# Brew Ledger

Financial infrastructure for Thai independent coffee SMEs. See
[`BrewLedger_WBS_Dictionary.md`](./BrewLedger_WBS_Dictionary.md) for the full
project scope, red lines (RL-1/RL-2/RL-3), and work breakdown.

**Tech stack:** Next.js (React + TypeScript) × 2 surfaces, NestJS on Cloud
Run, PostgreSQL (Cloud SQL) via Prisma, a licensed PromptPay gateway,
PaddleOCR, Web Push (VAPID) with polling fallback, Firebase Auth (Phone OTP),
Google Cloud Storage.

## Layout

```
apps/
  console/    Owner Console — authenticated, merchant-scoped (Next.js)
  api/        Backend API (NestJS)
  shop/       Customer Web — unauthenticated, public (not yet scaffolded)
packages/
  db/         Prisma schema, generated client, migrations, seed script
  shared/     Code safe for both front-end surfaces (money formatting,
              order status, order code alphabet) — never anything from
              packages/db
```

`apps/shop` doesn't exist yet — Customer Web is a separate, not-yet-started
front-end task. `eslint.config.mjs` at the repo root already declares the
import-boundary rule for it (RL-3: Customer Web must never import
`packages/db` or `apps/console`); it activates the moment that workspace is
added.

## Getting started

```bash
pnpm install

# 1. Database — requires a reachable Postgres instance (local install,
#    Docker, or Cloud SQL via the proxy). Not included in this environment.
cp .env.example packages/db/.env    # edit DATABASE_URL if needed
pnpm db:migrate                     # applies packages/db/prisma/migrations
pnpm db:seed                        # demo store: 8 menu items (4 with a
                                     # recipe, 4 without), 6 ingredients,
                                     # a week of pick-up slots, 30 orders

# 2. Backend API
cp apps/api/.env.example apps/api/.env
pnpm dev:api                        # http://localhost:3001/api/health

# 3. Owner Console
pnpm dev                            # http://localhost:3000
```

## Database

- **Migrations only** — never hand-edit the schema in a running database.
  `packages/db/prisma/schema.prisma` is the single source of truth; run
  `pnpm db:migrate` to create/apply a migration.
- `pnpm db:reset` drops and recreates the dev database from migrations, then
  you re-run `pnpm db:seed`.
- `/docs/data_dictionary.md` classifies every column `PUBLIC_SAFE` or
  `MERCHANT_ONLY` — the input to the public API allow-list serializers
  (WBS 3.5, not yet built).

## Import boundary (RL-3)

`pnpm lint:boundary` runs the root `eslint.config.mjs`, which fails the build
if any file under `apps/shop/**` imports `apps/console/**` or
`packages/db/**`. This is the primary structural enforcement of RL-3 — a
bundle that cannot import the database or the merchant UI cannot leak
merchant-only data (cost, margin, stock, expenses).

## What's here vs. what's next

This setup covers WBS **3.1** (monorepo layout + CI), **3.3** (full data
model), and **3.4** (migrations + seed). It intentionally does **not** yet
cover:

- **3.2** — GCP provisioning (Cloud Run, Cloud SQL, Secret Manager). Needs
  real cloud credentials.
- **3.5 / 3.6** — the `/api/public` vs `/api/console` module split with
  allow-list DTOs, and the tenant-scoping Prisma extension. `apps/api` today
  is a single unguarded module tree with just a health check.
- **3.7** — signed-URL object storage for bill images.
- `apps/shop` itself.
