# Brew Ledger

Financial infrastructure for Thai independent coffee SMEs — pre-order pickup
plus automatic unit costing, as a responsive web app.

> **Status:** Team project, discontinued. Built with a friend as a proof of
> concept; development is no longer active. Kept public as a portfolio piece —
> see the WBS dictionary below for the full scope and technical decisions
> that were made.

Full scope, work breakdown, and acceptance criteria live in
[`BrewLedger_WBS_Dictionary.md`](./BrewLedger_WBS_Dictionary.md). Day-to-day
orientation — tech stack, monorepo layout, commands, red lines — lives in
[`CLAUDE.md`](./CLAUDE.md). This file is intentionally short: read those two
instead of this one.

## Tech Stack

- Next.js (React + TypeScript) — two separate surfaces (Owner Console + Customer Web) on Vercel
- Supabase (PostgreSQL + Row Level Security + Auth + Storage + Realtime + Edge Functions)
- Node.js async worker on Render
- Direct merchant-owned PromptPay (locally generated EMVCo QR — no payment gateway)
- Typhoon OCR (via Float16 API) for receipt/ingredient data entry
- Web Push API (VAPID) with polling fallback

## Getting started

```bash
pnpm install
pnpm dev                 # Owner Console  (apps/console)
pnpm dev:shop             # Customer Web   (apps/shop)
pnpm lint:boundary        # RL-3 import-boundary check
```

See `CLAUDE.md` for the full command list and stack details.

## My Role

I worked on this as a two-person team. My main contributions:

- **Unit costing engine** — ingredient master data, unit conversion, the
  cost-update engine, and the suggested BOM / recipe editor
- **Inventory** — the append-only stock ledger and negative-stock policy
- **Order flow** — merchant order status updates, cancellation and
  merchant-initiated refund tracking, manual cash sale entry, and purchase /
  bill entry
- Rate-limiting and abuse-prevention on the public order-lookup endpoint

See the commit history and `BrewLedger_WBS_Dictionary.md` for the full
breakdown of what was built.
