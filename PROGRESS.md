# WBS Progress Tracker

Source of truth for WBS execution status. `BrewLedger_WBS_Dictionary.md`
stays an unedited, faithful copy of the dictionary — all status lives here.

**Status values:** `not started` / `in progress` / `blocked` / `needs review`
/ `done` / `pre-existing (adapt, do not scaffold)`.

**Update rule (writer/reviewer separation, mirrors `.claude/agents/WORKFLOW.md`):**
the implementing leg (`engineer`, or `architect` for Pattern A entries) may
only set Status to `needs review` and fill in `Implemented by` + `Commit
ref`. Only the reviewing leg (`qa_engineer` or `redline_reviewer`) may set
Status to `done` and fill in `Reviewed by`. Never self-certify.

| WBS | Title | Phase | Status | Pattern | Implemented by | Reviewed by | Commit/PR ref | Notes |
|---|---|---|---|---|---|---|---|---|
| 3.1 | Repository, Monorepo Layout and CI | 3 | pre-existing (adapt, do not scaffold) | — | — | — | `b051af7`, `2617638` | `apps/shop` + `apps/console` already scaffolded and live on Vercel (competition QR code entry), predates this WBS. The dictionary's Claude Code prompt assumes greenfield scaffolding — do not run it verbatim. Read `docs/ops/migration_notes.md` before dispatching any agent against this entry. |
| 3.4 | Vercel Project Provisioning and Environment Wiring | 3 | pre-existing (adapt, do not scaffold) | — | — | — | `2617638` | Live Vercel project already serves `apps/shop`'s coming-soon page. The dictionary's route tree (`app/s/[slug]`, `.../cart`, `.../checkout`, `.../pay/[code]`, `app/track`) and "Add New Project → Import" steps assume no existing deployment. Read `docs/ops/migration_notes.md`. |
| — | Coming-soon brand-green fix (`#234936` placeholder → real Ledger Green `#0b6b47`) | — | not started | C | — | — | — | Deferred by explicit user decision — touches the live `apps/shop`/`apps/console` pages, must be its own isolated, confirmed, previewed change, not bundled with other work. Real value source: `design/_ds/brewledger-design-system-07c182af-9b93-4f42-a3da-2adf1d189891/tokens/colors.css`. |

_Add a new row for every WBS entry the moment it's dispatched — don't wait
until it's done._
