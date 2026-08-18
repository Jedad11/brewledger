# /design — read-only delivered artefact

This directory is the delivered design package for BrewLedger. **Nothing in
it is edited by implementation work.** If a spec looks wrong, the fix goes in
`/docs/design/`, not here — see "If the spec disagrees with itself" below.

## What's in here

| File | Covers |
|---|---|
| `P0 Foundation.html` | Tokens, semantic colour, Thai type, money rules, nav shells, component states |
| `Customer Web.html` | Customer ordering web (7 screens) |
| `Owner Console.html` | Console core loop (login, dashboard, orders, detail, quick sale, notifications) |
| `Console Setup.html` | Store profile, menu, item editor + recipe, payments, link/QR, notifications, plan |
| `Console Reports.html` | Bill capture, bill review, inventory, transaction ledger, P&L, profit-per-dish, period comparison |
| `brewledger-tokens.css` | Shared stylesheet — layers on the tokens below |
| `_ds/brewledger-design-system-…/` | Underlying design-system tokens, styles, bundle, manifest, adherence lint config |
| `P5 Handoff.md` | **The canonical specification.** Screen inventory, state matrix (exact Thai copy), interaction spec, component inventory, and the four non-negotiable rules |

`console-reports.js`, `console-setup.js`, `customer-web.js`, `owner-console.js`
are the vanilla-JS implementations behind the four `.html` prototypes above —
read them when a state or a data shape isn't fully spelled out in
`P5 Handoff.md`.

## The state switcher

**Every prototype has a hidden state switcher: press `D`.** It toggles the
`S.dev.*` flags each script keeps (empty, loading, no-recipe, all-untracked,
zero-baseline, and so on) so every state in the state matrix can be reached
without live data. Open the relevant `.html` file directly in a browser, press
`D`, and pick the state you need to verify. This is the fastest way to check
an implementation against a state that's hard to trigger with real data (e.g.
`zero-baseline` in the monthly comparison, or `all-untracked` on the P&L).

## Precedence — `P5 Handoff.md` outranks the screen

`P5 Handoff.md` is extracted verbatim into `/docs/design/` (screen inventory,
state matrix, interaction spec, component inventory, rules) so implementation
entries can cite it precisely without opening this directory. **When the
document and a screen you're looking at disagree, the document wins** — a
prototype can drift from its own spec (see GAP-1 below, where an entire
screen existed in code with no matching document section), and copy typed
directly off a rendered screen is not a substitute for the state matrix's
exact strings.

If `/docs/design/` itself is found to be wrong or incomplete against what's
actually implemented in one of these `.js` files, the fix is to correct
`/docs/design/` and say so in the change — never to edit the file in here.

## Known gap: GAP-1, the transaction ledger

`console-reports.js` implements a complete transaction ledger screen
(`รายการเดินบัญชี`, screen key `ledger`, reachable from `Console Reports.html`)
that had no corresponding entry in `P5 Handoff.md`'s screen inventory or
state matrix. It has since been added to `/docs/design/screen_inventory.md`
and `/docs/design/state_matrix.md` by reading the implementation directly.
See `/docs/design/gaps.md` for the full record.

## Adherence lint (`_adherence.oxlintrc.json`)

`_ds/brewledger-design-system-…/_adherence.oxlintrc.json` is the delivered
design-system adherence ruleset (forbids raw hex colours and raw `px` values,
restricts component prop usage, restricts imports to `index.js`). It carries
a `x-omelette` metadata block used by the tool that generated it — not by
`oxlint` — so it cannot be fed to `oxlint` unmodified.

**Investigated and wired as real tooling, with a documented blocker:**

- `oxlint` (`^1.78.0`) was added as a root devDependency.
- `scripts/lint-adherence.mjs` derives a sanitized copy of this config at run
  time (strips only the `x-omelette` field oxlint's parser rejects — every
  rule and override is passed through unchanged) and runs `oxlint -c
  <derived-config> apps/console apps/shop packages/ui`. It is exposed as
  `pnpm lint:adherence`. This keeps the delivered file as the single source
  of truth; nothing under `/design/` is copied by hand.
- **However**, oxlint 1.78 does not implement the rule IDs this config
  depends on for every one of its custom checks — `no-restricted-syntax`,
  `no-restricted-imports`, and `react/forbid-elements` are all absent from
  `npx oxlint --rules`. Running `pnpm lint:adherence` today fails with
  `Rule 'no-restricted-syntax' not found in plugin 'eslint'`, i.e. the
  adherence config is written for full ESLint's rule surface, not oxlint's
  (despite its filename). This is **not** an RL-3 conflict — it is a plain
  tool-capability gap, discovered by running it, not assumed.
- `pnpm lint:adherence` is **not** wired into the aggregate `pnpm lint`
  chain, because it cannot currently pass — wiring a lint step that always
  fails would either be ignored or block CI for a reason unrelated to the
  code being checked.
- **Manual follow-up (recorded here, not actioned in this entry — actioning
  it means touching `apps/console`'s and `apps/shop`'s own ESLint configs,
  which this entry is explicitly scoped away from):** once `packages/ui`
  exists (WBS 2.2), port the adherence config's `rules` block into a real
  ESLint flat-config file — `no-restricted-syntax`, `no-restricted-imports`,
  and `react/forbid-elements` are all genuine ESLint/`eslint-plugin-react`
  rules and the existing root `eslint.config.mjs` already runs ESLint 9 +
  `typescript-eslint`, so this is additive, not a second linter. Re-attempt
  `pnpm lint:adherence` against future oxlint releases first, in case rule
  support lands — check `npx oxlint --rules` before doing the ESLint port.

If the RL-3 import boundary in root `eslint.config.mjs` (WBS 3.1) is ever
found to conflict with a ported adherence rule, RL-3 wins — no conflict was
found in this pass, since the adherence rules govern component/token usage
and raw literals, and RL-3 governs which workspace may import which. They
check disjoint things.
