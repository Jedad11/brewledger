# Migration Notes — Reconciling the New WBS with What's Already Live

`BrewLedger_WBS_Dictionary.md` is kept as an unedited, faithful copy of the
source dictionary. Anywhere its instructions conflict with what's already
built and deployed, the reconciliation lives here instead — read this file
before dispatching any agent against the entries below.

## WBS 3.1 — Repository, Monorepo Layout and CI: DO NOT SCAFFOLD

`apps/shop` and `apps/console` already exist, are committed, and are
deployed. The dictionary's Claude Code prompt for 3.1 is written as
"Scaffold the Brew Ledger monorepo... apps/shop Next.js 15 App Router" — as
if neither app exists yet. It does not.

If dispatched against 3.1: re-scope the work to only what's actually
missing — `packages/ui`, `packages/costing`, `supabase/functions`,
`worker/`, `docs/adr/*`, GitHub Actions CI workflow files. Treat
`apps/shop` and `apps/console` as **audit-only** for this entry (confirm
they satisfy 3.1's acceptance criteria as they stand) — never as scaffold
targets. Do not run the dictionary's prompt language verbatim.

## WBS 3.4 — Vercel Project Provisioning: DO NOT REPROVISION

A live Vercel project already serves `apps/shop`'s coming-soon page, linked
to an active QR code submitted for a competition. The dictionary's 3.4
Claude Code prompt defines a full route tree for `apps/shop`
(`app/s/[slug]/page.tsx`, `.../cart`, `.../checkout`, `.../pay/[code]/page.tsx`,
`app/track/page.tsx`) and its manual steps assume creating brand-new Vercel
projects via "Add New Project → Import." Running either verbatim risks
clobbering the live page or creating a conflicting second project.

If dispatched against 3.4: build the real route tree as **additions** to
the existing live project via the normal PR + preview-deploy workflow —
never via "Add New Project → Import." Explicitly forbidden: changing the
production domain/alias, relinking the Vercel project, or deploying
directly to production without a preview first.

## General rule for any entry touching `apps/shop`, `apps/console`, or Vercel

`apps/shop` is **live in production**, linked to an active competition QR
code. Before any change lands on `main` (which auto-deploys), get it working
on a preview deploy first, and hold for explicit user confirmation before
pushing to `main` — same norm already established for every commit in this
repo so far.

## Deferred: coming-soon brand-green mismatch

The live coming-soon page uses a placeholder green (`#234936`), guessed
before the real design system was found. The real value is Ledger Green
`#0b6b47` (see `design/_ds/brewledger-design-system-07c182af-9b93-4f42-a3da-2adf1d189891/tokens/colors.css`).
Fixing this was explicitly deferred by the user — track it as its own
isolated, confirmed, previewed change (see `PROGRESS.md`), never bundled
into other WBS work.
