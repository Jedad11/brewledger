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

## Screenshots

> Captured against the real Next.js apps running with a local mock standing in
> for Supabase (Postgres/PostgREST/GoTrue/Edge Functions), since no local
> Supabase instance could be started on the machine used to take these
> (Postgres itself failed to start in that Docker environment). The UI, copy,
> and business logic shown are all the genuine app code — only the data layer
> underneath is a stand-in.

### Owner Console (`apps/console`)

Phone-OTP login, the daily dashboard, the ingredient inventory (negative-stock
policy), the menu/BOM recipe editor, the live orders inbox, and a manual cash
sale.

| | |
|---|---|
| **Login — phone** | ![Login phone](./screenshots/01-login-phone.png) |
| **Login — OTP** | ![Login OTP](./screenshots/02-login-otp.png) |
| **Dashboard** | ![Dashboard](./screenshots/03-dashboard.png) |
| **Inventory** | ![Inventory](./screenshots/04-inventory.png) |
| **Menu list** | ![Menu list](./screenshots/05-menu.png) |
| **Menu item editor** | ![Menu item editor](./screenshots/06-menu-item-editor.png) |
| **Recipe / BOM editor** | ![Recipe editor](./screenshots/07-menu-item-recipe.png) |
| **Orders inbox** | ![Orders inbox](./screenshots/08-orders.png) |
| **Quick cash sale** | ![Quick cash sale](./screenshots/09-sales-quick.png) |

### Customer Web (`apps/shop`)

The unauthenticated ordering flow: browse the menu, pick item options, review
the cart, choose a pickup slot, pay by PromptPay QR, and track the order
through to pickup — plus the phone+code order lookup screen (the
rate-limited public endpoint below).

| | |
|---|---|
| **Store menu** | ![Store menu](./screenshots/10-shop-store.png) |
| **Item options** | ![Item options](./screenshots/11-shop-item-options.png) |
| **Cart bar** | ![Cart bar](./screenshots/12-shop-cart-bar.png) |
| **Cart** | ![Cart](./screenshots/13-shop-cart.png) |
| **Pickup slot + details** | ![Checkout slot picker](./screenshots/14-shop-checkout-slot.png) |
| **PromptPay QR payment** | ![Pay QR](./screenshots/15-shop-pay-qr.png) |
| **Order tracking — preparing** | ![Order tracking](./screenshots/16-shop-track-order.png) |
| **Order tracking — collected** | ![Order collected](./screenshots/17-shop-order-collected.png) |
| **Find my order (phone + code)** | ![Track lookup](./screenshots/18-shop-track-lookup.png) |
