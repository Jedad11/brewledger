# @brewledger/ui

Design system port (WBS 2.2). Imported by **both** `apps/shop`
(unauthenticated Customer Web) and `apps/console` (merchant Owner Console).
That dual import is the reason this package carries its own red-line
discipline — see "RL-3" below before touching anything in `src/`.

## Source-of-truth precedence

When a token value, a prop contract, a state, or a piece of Thai copy is
ambiguous or looks wrong, resolve it in this order — never guess, never
paraphrase:

1. `/docs/design/component_inventory.md` — prop contracts
2. `/docs/design/state_matrix.md` — every state and its exact Thai copy
3. `/design/brewledger-tokens.css` — project token layer
4. `/design/_ds/.../tokens/*.css` — base design-system tokens
5. `/design/*.html` + `/design/*.js` — the prototype, rendered reference

`docs/ui/design_system_port_design.md` is the architect's design document
for this port — read it for the reasoning behind every non-obvious choice
below (the token pipeline's parser choice, each component's prop contract,
the three flagged ambiguities and how they were resolved).

**Never edit anything under `/design/`.** It is a delivered, read-only
artefact.

## Tokens: generate, never hand-edit

```
packages/ui/src/tokens.css          GENERATED — do not hand-edit
packages/ui/tailwind-preset.ts      GENERATED — do not hand-edit
packages/ui/src/tokens.generated.meta.json   GENERATED — {name, rawValue, sourceFile, sourceLine}
```

Both are produced by `scripts/build-tokens.mjs`, which parses (with
`postcss`, a real CSS AST — never regex) every `:root { --x: y; }`
declaration across:

```
design/_ds/.../tokens/colors.css
design/_ds/.../tokens/typography.css
design/_ds/.../tokens/spacing.css
design/_ds/.../tokens/effects.css
design/brewledger-tokens.css
```

**To change a token: edit the source CSS file in `/design`, then run:**

```bash
pnpm --filter @brewledger/ui build:tokens
```

Never hand-edit `tokens.css` or `tailwind-preset.ts` directly — the next
`build:tokens` run will silently overwrite a hand edit, and a stale/hand-
edited generated file is exactly the drift this pipeline exists to prevent.
`tokens.css` keeps `var()` chains intact (e.g. `--c-revenue: var(--green-brew)`)
so apps can override at runtime by reassigning a custom property;
`tailwind-preset.ts` resolves those chains to literal values, since some
Tailwind theme keys need a literal string rather than a `var()` passthrough.

The pipeline currently emits **112** custom properties (not 94 — see
`docs/ui/design_system_port_design.md` §1.2's own note that its per-file
headline counts undercount their own exhaustive enumerations; 112 is what
the delivered source files actually contain, verified by parsing them, not
by re-summing the design doc's prose).

## Consumption by `apps/shop` / `apps/console`

Each app's root CSS entry point imports both the tokens and the ported
component-class rules, then Tailwind:

```css
@import "tailwindcss";
@import "@brewledger/ui/tokens.css";
@import "@brewledger/ui/components.css";
@config "../../packages/ui/tailwind-preset.ts"; /* confirm the exact v4 directive
  against the installed @tailwindcss/postcss version at wiring time */
```

`packages/ui/src/components.css` is a **literal port** of the non-token
component-class rules in `/design/brewledger-tokens.css` and the relevant
`<style>` blocks in `/design/*.html` (`.money`, `.st`, `.btn`, `.input`,
`.card`, `.oc-*`, `.cw-*`, ...) — every component in this package renders
using those exact class names, not a re-derived styling system, so a
fidelity check against the prototype is a direct comparison, not an
approximation.

Neither app should hand-write a hex value or a raw px tap-target size once
this is wired — every value should trace back to a `var(--token)` or a
class from `components.css`. `grep -rn "#" apps/*/src` returning nothing is
the practical audit for this.

## Components

All 12 components from the `P5 Handoff.md` §4 / `component_inventory.md`
inventory, plus `Button`/`Input`/`Card` (added per project decision — the
prototype's `.btn`/`.input`/`.card` base classes had no named component in
the 12-item inventory):

`MoneyValue` · `OrderStatusBadge` · `OrderCard` · `SlotPicker` ·
`ConfidenceField` · `EmptyState` · `UntrackedDisclosure` · `StatusButton` ·
`OnboardingStrip` · `RecipeBlock` · `MetricCard` · `NavShell` · `Button` ·
`Input` · `Card`

Each file in `src/components/*.tsx` documents its own prop contract inline
(JSDoc), including which red line it enforces at the type level. Read
`docs/ui/design_system_port_design.md` §2 for the reasoning; do not
re-derive a prop contract from the rendered gallery — the contract is the
spec, the gallery is a rendering of it.

## RL-3 — no cost, margin, or profit formatting logic

**`packages/ui` must never gain cost, margin, or profit *formatting logic*
beyond `MoneyValue`'s `null → "—"` handling.** This package is imported by
`apps/shop`, which is unauthenticated and public — any cost-shaped
arithmetic living here ships into that public bundle regardless of whether
`apps/shop`'s own data-fetching ever actually populates the inputs.

Three enforcement layers:

1. **Import boundary** (`eslint.config.mjs`) — `packages/ui` may not import
   `packages/costing`, `packages/db`, or either app.
2. **Content-pattern lint** (`eslint-rules/no-cost-formatting-logic.cjs`,
   wired as `local/no-cost-formatting-logic`) — flags arithmetic on a
   cost/margin/profit-named operand, and cost-shaped local/prop identifiers,
   inside `packages/ui/src/components/**/*.tsx`. `MoneyValue.tsx` and
   `MetricCard.tsx` are the two files exempted — they're the sanctioned
   home of the one allowed exception. This is defence in depth, not a
   soundness proof (see the rule file's own header comment for its honest
   scope), matching this repo's existing `no-db-row-spread` rule's stance.
3. **Forbidden-nag-phrase scan** (`pnpm scan:forbidden-copy`) — widened
   (WBS 2.2) from its original `apps/console`-only scope to also cover
   `packages/ui/src/**`, because `RecipeBlock` — the component that must
   never nag a merchant about a missing recipe (RL-2) — physically lives in
   this package now, not in `apps/console`.

**`RecipeBlockProps` has no `required`/`error`/`validationState` field, on
purpose**, and never should. That specific omission has no type-level or
lint-level enforcement (there's no way to type-check "this interface will
never grow a prop") — it's a standing item on `redline_reviewer`'s checklist
every time that file changes.

## Gallery and fidelity check

`src/gallery.tsx` renders every component in every documented state, using
the exact Thai copy from `/docs/design/state_matrix.md` (never paraphrased).
It also exports `FIDELITY_MANIFEST` — the list of (component, state) pairs
this package claims to have verified against the prototype, each pointing
at the gallery's own rendered element and the corresponding prototype file
+ selector (+ the interaction steps needed to reach that state in the
prototype's own stateful vanilla-JS app, e.g. pressing `D` for its hidden
dev switcher).

```bash
pnpm --filter @brewledger/ui verify:fidelity
```

runs `scripts/verify-fidelity.mjs`: a Playwright-driven **computed-style**
diff (font-family, font-size, line-height, color, background-color,
min-height) between each gallery entry and its prototype counterpart — not
a screenshot/pixel diff, which can't distinguish "the right visual result
via the wrong CSS" from an actual token match. Zero tolerance: any property
mismatch fails that row. A manifest entry with genuinely no prototype
equivalent is marked `NO_REFERENCE` with a written reason, not silently
omitted — the manifest is meant to make a gap visible, not paper over one.

## Verification run at the time of this port

- Token pipeline: 112 custom properties emitted, zero duplicates, the 20
  dictionary-called-out exact values (`--font-thai`, `--lh-thai-body: 1.5`,
  `--lh-thai-head: 1.35`, `--tap-min: 44px`, `--tap-wet: 56px`, the 6 money
  roles, all 16 `--st-*-bg/fg` values) verified byte-for-byte against
  `tokens.generated.meta.json`.
- `pnpm --filter @brewledger/ui typecheck` — clean.
- `pnpm lint:boundary` — clean (import boundary + content-pattern rule both
  exercised against a throwaway fixture and confirmed to fire, then removed).
- `pnpm scan:forbidden-copy` — clean.
- `pnpm --filter @brewledger/ui verify:fidelity` — 18 PASS, 0 FAIL,
  3 NO_REFERENCE (each with a written reason in `FIDELITY_MANIFEST`).
  Re-verified after two redline_reviewer-driven fixes to `ConfidenceField`'s
  low-confidence styling (see PROGRESS.md, WBS 2.2) — that state moved from
  a misdiagnosed `NO_REFERENCE` to two real `MATCH` entries (input background
  and hint text) against `design/Console Reports.html`'s `.oc-billrow.is-low`
  / `.oc-lowtag`.
