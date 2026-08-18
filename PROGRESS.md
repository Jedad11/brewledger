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

| 2.1 | Design Asset Intake and Gap Verification | 2 | done | C | engineer | orchestrating session | `f005257`, `4c878e4` | `/design/` structure verified intact (not re-copied); added `/design/README.md` only. Extracted `P5 Handoff.md` §1–5 into `/docs/design/{screen_inventory,state_matrix,interaction_spec,component_inventory,rules}.md`. `coverage.md` maps F01–F29: 24 Y, 5 Partial (F05 no payment-confirm control in prototype, F12 no feature-gating demo, F25 no stock-movement view) — see `gaps.md` for owner+decision per item. `gaps.md` seeded with GAP-1 (transaction ledger, undocumented but complete — added to screen_inventory.md/state_matrix.md by reading `console-reports.js`) plus GAP-2/3/4 for the three Partial coverage items. Adherence lint: `oxlint` added as a real root devDependency; `scripts/lint-adherence.mjs` derives a sanitized copy of the delivered `_adherence.oxlintrc.json` (strips only the `x-omelette` field oxlint's parser rejects) and runs it via `pnpm lint:adherence` — but oxlint 1.78 does not implement `no-restricted-syntax`/`no-restricted-imports`/`react/forbid-elements`, so the config cannot actually execute yet; not wired into the aggregate `pnpm lint` chain for that reason. Full finding and manual follow-up (port to a real ESLint flat-config once `packages/ui` exists) documented in `/design/README.md`. No RL-3 conflict found. Did not touch `apps/shop` or `apps/console` per dispatch guardrail. **Review:** F05's code-trace verified against `owner-console.js` directly (`NEXT` map confirmed to only cover `accepted→making→ready→collected`, no `unpaid` key, no seed order in `unpaid` status) — the Partial call was accurate, not a stretch. State switcher (`D` key) verified working via Playwright screenshot on `Owner Console.html`. `git diff --stat` confirmed zero changes under `apps/shop/`/`apps/console/` across both commits. |

| 3.2 | Supabase Project Provisioning and Environments | 3 | needs review | B (engineer → qa_engineer → redline_reviewer, escalated from B given RL-3 key-handling stakes) | engineer | — | `a476a10` | Manual half done by user (org + `brewledger-dev`/`brewledger-prod` created, `brewledger-dev` linked locally, confirmed via `supabase projects list`). This row covers the Claude Code half: `supabase/config.toml` (scaffolded via `supabase init`, edited for phone-OTP-only auth), `.env.example` contracts (shop/console/worker), `packages/shared/src/supabase/{client,admin}.ts`, RL-3 lint extension (banned repo-wide from `apps/console` too, pending a real client/server split there), `docs/security/keys.md`, `db:push`/`db:diff`/`db:types`/`db:reset` scripts. `supabase db push` verified against the linked dev project (zero migrations, up to date). One divergence: the admin.ts browser guard uses `(globalThis as { window?: unknown }).window` instead of a bare `window` reference — `tsconfig.base.json` has no DOM lib (this package is isomorphic), so a bare `window` fails `tsc --noEmit`; behavior is identical. |

_Add a new row for every WBS entry the moment it's dispatched — don't wait
until it's done._
