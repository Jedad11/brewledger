# Brew Ledger

Financial infrastructure for Thai independent coffee SMEs — pre-order pickup
plus automatic unit costing, as a responsive web app.

Full scope, work breakdown, and acceptance criteria live in
[`BrewLedger_WBS_Dictionary.md`](./BrewLedger_WBS_Dictionary.md). Day-to-day
orientation — tech stack, monorepo layout, commands, red lines — lives in
[`CLAUDE.md`](./CLAUDE.md). This file is intentionally short: read those two
instead of this one.

## Getting started

```bash
pnpm install
pnpm dev                 # Owner Console  (apps/console)
pnpm dev:shop             # Customer Web   (apps/shop)
pnpm lint:boundary        # RL-3 import-boundary check
```

See `CLAUDE.md` for the full command list and the Supabase-based stack this
project now runs on.
