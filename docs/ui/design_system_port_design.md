# WBS 2.2 — Design System Port to `packages/ui`: Architecture

Status: design only. No component implementation in this document — that is
`engineer`'s work. This document is the contract `engineer` builds against and
`redline_reviewer` audits against.

Source-of-truth precedence (per WBS 2.2 and CLAUDE.md "Design is complete"):
1. `/docs/design/component_inventory.md` (prop contracts) — itself a reference
   copy; record of truth is `/design/P5 Handoff.md` §4
2. `/docs/design/state_matrix.md` (states + exact Thai copy) — reference copy
   of `/design/P5 Handoff.md` §2
3. `/design/brewledger-tokens.css` (project token layer)
4. `/design/_ds/.../tokens/*.css` (base design-system tokens)
5. `/design/*.html` + `/design/*.js` (prototype, rendered reference)

I read all of these directly (not just the WBS dictionary's abbreviated
excerpt) — see §1 for the full token enumeration and §6 for the diff against
the dictionary's partial list.

---

## 1. Token pipeline architecture

### 1.1 Source files, read in this order

```
design/_ds/.../tokens/colors.css       30 custom properties  (--green-ledger, --red, --surface-page, ...)
design/_ds/.../tokens/typography.css   14 custom properties  (--font-sans/serif/script, --text-1..10, --tracking-*, --lh-normal, --lh-compact)
design/_ds/.../tokens/spacing.css      13 custom properties  (--space-1..9, --gutter-*, --col-*) + font-size:62.5% on :root
design/_ds/.../tokens/effects.css      13 custom properties  (--radius-*, --shadow-*, --ease-*, --duration-*, --press-scale)
design/brewledger-tokens.css           24 custom properties  (project layer, listed in full in §1.2)
```

`brewledger-tokens.css` is explicitly "layered on top of" the base DS tokens
(its own comment, line 2–3) and also contains `@import url(fonts.googleapis...)`
plus non-token CSS (base element rules, `.money`, `.st`, `.btn`, `.field`,
`.input`, `.card`, `.cw-*`, `.oc-*` component-class rules). The token pipeline
extracts **only the `:root { --x: y; }` declarations** from all five files. The
component-class rules in `brewledger-tokens.css` are reference material for
component implementation (§2), not pipeline input — they don't round-trip
through Tailwind, they inform how each React component's own styles are
written.

### 1.2 Every token that must survive the pipeline, exhaustively

This supersedes the WBS dictionary's partial list (which names only 6 of
these). Grouped by source file:

**colors.css (30):** `--green-ledger --green-brew --green-cask --green-sage
--green-mist --gold --gold-light --gold-lightest --parchment --ceramic
--neutral-cool --white --black --text-black --text-black-soft --text-white
--text-white-soft --rewards-slate --red --red-tint --yellow --green-mist-tint
--input-border --hairline --surface-page --surface-card --surface-utility
--brand-heading --brand-cta --brand-band` plus 6 overlay tokens
(`--overlay-black-06/24/60`, `--overlay-white-10/60/90`).

**typography.css (14):** `--font-sans --font-serif --font-script
--tracking-normal --tracking-loose --tracking-looser --lh-normal --lh-compact
--text-1` through `--text-10` (10 scale steps).

**spacing.css (13):** `--space-1` through `--space-9` (9 steps), `--gutter-sm/md/lg`,
`--col-sm/md/lg/xl`. Plus the non-custom-property declaration `font-size:
62.5%` on `:root` — this is the rem-basis for every `rem` value in every other
file (`1.6rem` = 16px only because of this line). **The pipeline must either
preserve this as a documented constant in `tailwind-preset.ts` (e.g. a comment
plus a `remBase: 10` note) or convert every rem token to its absolute px
equivalent at generation time** — silently dropping it while keeping the rem
values verbatim would make every generated Tailwind size wrong by a factor of
1.6. Recommend converting to px at generation time so the preset is
self-contained and doesn't depend on a global root font-size apps/shop or
apps/console might not set identically.

**effects.css (13):** `--radius-card --radius-pill --radius-circle
--radius-input --shadow-card --shadow-nav --shadow-fab-base
--shadow-fab-ambient --shadow-fab-ambient-active --ease-standard --ease-spring
--duration-fast --duration-standard --duration-slow --press-scale`.

**brewledger-tokens.css, project layer (24):** `--font-thai --lh-thai-body
--lh-thai-head --c-revenue --c-profit --c-cost --c-warning --c-unknown
--c-negative --tap-min --tap-wet` plus the 8 status pairs × 2 (bg/fg) = 16:
`--st-unpaid-bg/fg --st-accepted-bg/fg --st-making-bg/fg --st-ready-bg/fg
--st-collected-bg/fg --st-cancelled-bg/fg --st-refunded-bg/fg
--st-expired-bg/fg`.

Total: **94 custom properties** across 5 files. The dictionary's acceptance
criteria calls out a subset (`--font-thai`, `--lh-thai-body: 1.5`,
`--lh-thai-head: 1.35`, `--tap-min: 44px`, `--tap-wet: 56px`, money roles, all
8 status bg/fg pairs) as the ones with an explicit exact-match test — those
20 values get an assertion in the token test (§1.4); the pipeline generates
all 94 regardless, since Tailwind consumers need spacing/radius/shadow too and
hand-omitting "less important" tokens is exactly the drift this WBS entry
exists to prevent.

Two values need special handling, not verbatim copy:
- `--font-thai` is `'Noto Sans Thai','Manrope',"Helvetica Neue",Helvetica,Arial,sans-serif`
  — the *only* font-family the pipeline should emit for both apps' body/heading
  CSS, per the dictionary's note that Manrope carries no Thai glyphs. The base
  `--font-sans` (`'Manrope',...`, no Thai fallback) must not leak into any
  component's default `font-family` — Tailwind preset's `fontFamily.sans`
  should resolve to `--font-thai`'s stack, not `--font-sans`'s.
- `--c-cost` is defined as `oklch(.52 .085 62)` directly, not as a `var()`
  reference to another token (unlike `--c-revenue`/`--c-profit`, which alias
  `--green-brew`/`--green-ledger`). The parser must handle both patterns:
  emit the resolved value for direct declarations and preserve/resolve the
  `var()` chain for aliases (Tailwind config needs the final color, not a
  `var()` string, if the preset feeds e.g. `theme.colors`).

### 1.3 Parser choice: real CSS AST, not regex

Recommend **`postcss` + `postcss-value-parser`** (both already implied by the
apps' `@tailwindcss/postcss` v4 dependency — no new heavy dependency class).
Reasons regex is wrong here, all present in the actual source files:

- Multiple declarations per line (`--tap-min:44px;--tap-wet:56px;`) — a
  naive `/--([\w-]+):\s*([^;]+);/` regex actually handles this fine, but:
- Values containing **commas inside function calls** that also appear as the
  top-level declaration separator context: `--font-thai:'Noto Sans
  Thai','Manrope',"Helvetica Neue",Helvetica,Arial,sans-serif;` and
  `--shadow-card:0 0 .5px rgba(0,0,0,.14),0 1px 1px rgba(0,0,0,.24);` — a
  regex splitting on `,` naively to build a font stack or shadow list will
  shear `rgba(0,0,0` mid-function.
- Comments embedded in values: `--lh-normal:1.5/* @kind other */;` and
  `--ease-standard:cubic-bezier(.25,.46,.45,.94)/* @kind other */;` in
  typography.css/effects.css — these must be stripped, and a regex that
  doesn't specifically account for `/* ... */` inside a declaration will
  either include the comment in the value or (if it stops at the first `;`
  it sees, and there's none inside the comment here, so this specific file is
  survivable by luck) — the point is CSS comment-stripping is a real grammar
  rule PostCSS already implements correctly and a hand rolled regex will get
  wrong on the next token someone adds.
- `@import url(...)` lines at the top of both `brewledger-tokens.css` and
  `typography.css` must be skipped, not matched as a declaration.
- Nested/duplicate `:root` blocks — `brewledger-tokens.css` has exactly one,
  but the pipeline reads 5 files and must merge 5 `:root` blocks into one
  token table; PostCSS gives a walkable AST (`root.walkRules(':root', rule =>
  rule.walkDecls('--*', ...))`) instead of re-deriving block scoping from
  scratch.

Design of `scripts/build-tokens.mjs`:

```
1. Read files in fixed order: colors.css, typography.css, spacing.css,
   effects.css, brewledger-tokens.css (later files may reference earlier
   ones via var(), never the reverse — enforce this order, don't sort).
2. Parse each with postcss.parse(source).
3. Walk :root rules, walk custom-property decls (rule.walkDecls(/^--/)).
4. Build a single ordered Map<name, {rawValue, sourceFile, sourceLine}>.
   Reject (throw, fail the build) on a duplicate --name across files unless
   the later file is intentionally overriding — brewledger-tokens.css does
   not currently redefine any base-DS token, so any collision is either a
   real conflict or the base-DS files renaming something; either way this
   should stop the build, not silently pick one.
5. Resolve var() chains textually (--c-revenue: var(--green-brew) -> look up
   --green-brew's rawValue) so tailwind-preset.ts can emit final CSS-legal
   values for keys that need it (e.g. shadow/color objects some Tailwind
   consumers expect as literal strings rather than var() passthroughs) while
   tokens.css itself keeps the var() chain intact (CSS custom properties are
   the whole point — apps override at runtime by reassigning --c-revenue,
   not by way of the Tailwind config).
6. Emit packages/ui/src/tokens.css: the merged, deduped custom-property list
   inside one :root block, in source order, each on its own line (matches
   the project's existing "one statement per line, no clever loop" bias from
   the RLS discipline — makes a future git diff of one changed token a
   one-line diff).
7. Emit packages/ui/tailwind-preset.ts: a typed `Config['theme']['extend']`
   object mapping token groups to Tailwind theme keys (fontFamily, fontSize,
   lineHeight, spacing, borderRadius, boxShadow, colors, transitionDuration,
   transitionTimingFunction) plus two BrewLedger-specific extensions that
   don't map to a stock Tailwind theme key: `tapTarget: {min: '44px', wet:
   '56px'}` and `orderStatus: {unpaid: {bg, fg}, ..., expired: {bg, fg}}` —
   consumed by component internals (OrderStatusBadge, StatusButton), not
   meant as general-purpose utility classes, so nesting them under
   non-standard preset keys rather than forcing them into `colors` (which
   would let anyone write `bg-unpaid-bg` as an arbitrary utility divorced
   from the badge component) is deliberate.
8. Every emitted value carries a `/* source: <file>:<line> */` trailing
   comment in tokens.css (not in the .ts preset, where it'd break JSON-like
   literals) — this is what makes "diff against source" a visual grep
   instead of a re-run of the whole pipeline when someone asks "did --c-cost
   change since v1".
```

Idempotency: the script is pure (file in, file out), re-runnable, and its
output is committed (generated files are not gitignored, matching the
project's stance in the WBS README instruction: "changing a token means
changing the source CSS and re-running the build, never editing the generated
output" — that only works as an enforceable rule if the generated output is
in git and a stale-output diff is visible in review).

### 1.4 Token pipeline test

`packages/ui/src/tokens.test.ts` (owned by `qa_engineer`, not built here, but
the pipeline's design must make this test possible):
- Assert the 20 dictionary-called-out values by exact string match:
  `--font-thai` full stack, `--lh-thai-body: 1.5`, `--lh-thai-head: 1.35`,
  `--tap-min: 44px`, `--tap-wet: 56px`, `--c-revenue/profit/cost/warning/
  unknown/negative`, and all 16 `--st-*-bg/fg` values.
- Assert token count: exactly 94 custom properties present in the generated
  `tokens.css` (a count assertion, not just presence, catches silent
  omission of a token nobody wrote a named test for).
- Assert zero duplicate `--name` declarations in the merged output.

---

## 2. Component architecture and prop contracts

I cross-referenced `/design/P5 Handoff.md` §4 directly (not just
`docs/design/component_inventory.md`, which is a verbatim reference copy of
it) and `/docs/design/state_matrix.md` for the states each component must
render. **Finding: the two inventory documents and the WBS dictionary's own
prompt-block list (lines 899–913) all describe the same 12 components with
no material divergence in props** — the dictionary prompt block is in fact
slightly more detailed on parameter names (e.g. `ConfidenceField`'s `unit?`,
`OrderCard`'s explicit handler names `onAdvance/onCancel/onOpen`) than the
inventory table's prose. Where I give a stricter TypeScript type below than
any of the three sources state literally, I flag it as an interpretation, not
a discovered requirement — `engineer` should treat those as the recommended
design, open to `redline_reviewer` sign-off, not as verbatim spec text.

For each component: prop contract, file path, and which red line it enforces
at the type level.

### `MoneyValue` — `packages/ui/src/components/MoneyValue.tsx`

```ts
export type MoneyRole = 'revenue' | 'cost' | 'profit' | 'plain';

export interface MoneyValueProps {
  /** Satang. Use `null` for "unknown" — never coerce to 0 or omit as undefined. */
  value: number | null;
  role: MoneyRole;
  decimals?: 0 | 2;
  size?: 'sm' | 'md' | 'lg'; // inventory says `size?` with no enum; component_inventory.md
                              // and P5 Handoff §4 both leave this untyped — engineer's call
                              // within the design-token type scale (text-1..text-10), 'sm'/'md'/'lg'
                              // is my recommendation, flag for redline_reviewer, not load-bearing.
}
```

**Type-level RL-2/RL-3 enforcement:** `value: number | null` — no third
variant. TypeScript's `strictNullChecks` (already on via `tsconfig.base.json`
→ `strict: true`) makes `value={someOptionalNumber}` a compile error unless
the caller has already resolved `undefined` to `null` explicitly. This is the
mechanism, not a lint rule: **there is no prop default of `0`, and no
`value?: number` optional signature that TypeScript would silently backfill
with `undefined` at a call site that a `??  0` elsewhere could then coerce.**
The component's internal render must literal-check `value === null` and
return `'—'` (the em dash used throughout `state_matrix.md`), never a
falsy-check (`!value`) which would also catch the legitimate value `0` satang
(a real, correctly-known zero — e.g. profit exactly breaking even) and wrongly
render it as unknown.

### `OrderStatusBadge` — `packages/ui/src/components/OrderStatusBadge.tsx`

```ts
export type OrderStatus =
  | 'unpaid' | 'accepted' | 'making' | 'ready'
  | 'collected' | 'cancelled' | 'refunded' | 'expired';

export interface OrderStatusBadgeProps {
  status: OrderStatus;
}
```

8-value union, exhaustively matched against the `tailwind-preset.ts`
`orderStatus` token map from §1.3 step 7 — a `satisfies Record<OrderStatus,
{bg: string; fg: string}>` on that map means adding a 9th status without
updating the badge's internal switch is a compile error, not a runtime
fallback to some default color. `ready` is the only filled badge (solid
background per `--st-ready-bg: var(--green-brew); --st-ready-fg: #fff`) — the
other seven use tint backgrounds; this is a rendering detail, not a type, but
document it so `engineer` doesn't invert which one is filled.

### `OrderCard` — `packages/ui/src/components/OrderCard.tsx`

```ts
export interface OrderCardProps {
  order: OrderSummary;         // see below — NOT the DB row type
  variant: 'inbox' | 'detail';
  showNextAction: boolean;
  unseen: boolean;
  onAdvance: (orderId: string) => void;
  onCancel: (orderId: string) => void;
  onOpen: (orderId: string) => void;
}

/** Field-by-field DTO, not a DB row spread — same discipline as WBS 3.7's
 * public serializer, applied here so apps/shop's usage of OrderCard never
 * pulls a cost/margin field in transitively via a wider `order` shape. */
export interface OrderSummary {
  id: string;
  code: string;
  status: OrderStatus;
  itemsSummary: string;   // pre-formatted, e.g. "2 รายการ"
  pickupTime: string;
  customerName?: string;  // console-only display; component itself carries no gate —
                           // see §4, the gate is which app is allowed to *pass* this prop
}
```

`OrderSummary` deliberately excludes `totalCostSatang`, `marginSatang`, or
any field matching `/cost|margin|profit/` — `packages/ui` has no visibility
into whether a given render happens in apps/shop or apps/console (it's a
shared component), so the type itself must not carry a field that would make
an accidental cost render possible if `apps/shop` ever assembled the wrong
`order` object. This is the component-level half of RL-3; the other half is
apps/shop's own data-fetching never having cost data to put in the object in
the first place (enforced by the Edge Function / serializer boundary, WBS 3.7,
not by this package).

### `SlotPicker` — `packages/ui/src/components/SlotPicker.tsx`

```ts
export interface Slot {
  time: string;      // "08:15"
  remaining: number;
}

export interface SlotPickerProps {
  slots: Slot[];
  value: string | null;   // selected time, or null before a choice is made
  onChange: (time: string) => void;
  showRemainingBelow?: number;  // default 2, per state_matrix "เหลือ N ที่" when ≤2
  fullMessage: string;          // caller-supplied Thai copy — state_matrix.md
                                 // gives "วันนี้เต็มทุกช่วงเวลาแล้ว" as the specific string;
                                 // the component takes it as a prop rather than
                                 // hardcoding, since apps/console's SlotPicker use
                                 // (if any, TBD — inventory doesn't show console
                                 // usage) might need different copy.
}
```

No `remaining: 0` slot should be omitted from `slots` — the empty-vs-full
distinction is `remaining === 0` rendering `fullMessage` inline for that slot,
not the slot disappearing from the list (state_matrix's "Slot taken while
typing" state explicitly re-renders the list with an updated count, implying
slots persist and change count live rather than vanish).

### `ConfidenceField` — `packages/ui/src/components/ConfidenceField.tsx`

```ts
export interface ConfidenceFieldProps {
  label: string;
  value: string;                    // controlled input string (numeric entry, but
                                     // kept as string to match a plain <input>'s
                                     // controlled-value convention; parsing to
                                     // satang/grams is caller's job, not this component's)
  confidence: 'high' | 'low';
  unit?: string;                    // e.g. "บาท/ลิตร"
  onChange: (value: string) => void;
  autoFocusIfLow: boolean;
}
```

State matrix: low confidence renders amber border + `!` icon + `ตัวเลขอาจ
อ่านไม่ชัด ตรวจอีกครั้ง` and is first in focus order — the component owns this
copy as a hardcoded string keyed off `confidence === 'low'` (not a caller-
supplied message) since state_matrix.md §"ตรวจบิล" gives one fixed string,
unlike `SlotPicker.fullMessage` which state_matrix shows varying by context.
`autoFocusIfLow` is the mechanism that makes "first in focus order" happen
without every call site re-implementing focus-management; the component
should call `.focus()` in an effect keyed on `confidence === 'low' &&
autoFocusIfLow`, not assume DOM order alone satisfies "first in focus order"
when multiple low-confidence fields exist on one screen (review screen can
have several fields; document order should still be tab order — this is a
CSS/DOM-order concern for `engineer`, not a prop-contract concern, flagging so
it isn't missed).

### `EmptyState` — `packages/ui/src/components/EmptyState.tsx`

```ts
export interface EmptyStateProps {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}
```

`action` is a single optional object, not two separate optional props
(`actionLabel?`, `onAction?`) — bundling them means a caller can't supply a
label with no handler or vice versa, which the loose two-prop form would
allow and which would be a silent no-op button. This is a defensive type
choice beyond what the inventory states literally; flag for `redline_reviewer`
as non-load-bearing.

### `UntrackedDisclosure` — `packages/ui/src/components/UntrackedDisclosure.tsx`

```ts
export interface UntrackedDisclosureProps {
  trackedCount: number;
  totalCount: number;
  untrackedRevenue?: number | null;  // satang; null (not just absent) means "don't render
                                       // this figure" while a genuine 0 must still render
                                       // as ฿0.00 via MoneyValue, not be treated as unknown
  variant: 'dashboard' | 'pnl' | 'dish';
}
```

Note the dictionary's inventory shows `untrackedRevenue?` (optional) with no
stated null-handling, but the whole package's MoneyValue discipline (§RL-2)
means if this figure is ever piped through `MoneyValue`, it must be typed
`number | null`, not `number | undefined`, for the same reason as §2's
`MoneyValue` entry — I've made it `number | null | undefined` (optional AND
nullable) here since "the whole prop is absent" (dashboard variant where the
figure doesn't apply) is semantically different from "present but the
underlying cost figure is unknown" (dish variant, some items untracked).
Renders as plain grey text on all three variants per the inventory note — no
color/role variation, this is deliberately not `MoneyValue` with a `role`
prop, it's flat text, matching RL-3's instruction that unknown-cost surfaces
must never look alarming.

### `StatusButton` — `packages/ui/src/components/StatusButton.tsx`

```ts
export interface StatusButtonProps {
  label: string;
  onPress: () => void;
  minHeight: 56;          // literal type — see below
  optimistic: true;       // literal type: this component only supports the
                           // optimistic-update pattern, callers cannot opt out
}
```

**Type-level enforcement (WBS acceptance: "StatusButton cannot be rendered
below 56px"):** `minHeight: 56` as a TypeScript numeric **literal type**, not
`number`. `<StatusButton minHeight={44} .../>` is a compile error — TS
rejects `44` against the literal `56`. This only works if the component
doesn't also accept an arbitrary `style` or `className` prop that could
override `min-height` via CSS — the component's contract should explicitly
NOT expose a general `style`/`className` escape hatch (or if it must for
layout composition, the escape hatch must not be allowed to set
`min-height`/`height`). Document this restriction in the component's JSDoc so
`engineer` doesn't add a permissive `...rest` spread onto the root element
that silently reopens the hole the literal type was meant to close.
`optimistic: true` is similarly a literal — every `StatusButton` press
optimistically updates before server confirmation (per
`docs/design/interaction_spec.md`'s optimistic-update convention for the
daily loop); a caller cannot construct a non-optimistic instance of this
specific component, they'd reach for a plain `Button` variant instead (not in
this inventory, may already exist as an unnamed pattern per `.btn` classes in
`brewledger-tokens.css`).

### `OnboardingStrip` — `packages/ui/src/components/OnboardingStrip.tsx`

```ts
export type OnboardingStepId = 'store' | 'menu' | 'payments';

export interface OnboardingStep {
  id: OnboardingStepId;
  done: boolean;
  // no `recipe` id exists in OnboardingStepId — expanding the union later
  // to include a recipe step is the actual RL-2 violation this type exists
  // to prevent; if a future PR adds 'recipe' to OnboardingStepId, every
  // exhaustive switch keyed on OnboardingStepId elsewhere in the codebase
  // becomes a compile error, which is the intended trip-wire.
}

/**
 * RL-2: a merchant can sell without ever entering a recipe. This strip must
 * never present "add a recipe" as an onboarding step alongside store/menu/
 * payments — doing so would frame the recipe as required setup, which is
 * itself a soft violation of "no screen may nag" even without a hard block.
 * The fixed 3-tuple (not `OnboardingStep[]`) makes a 4th step, of any kind,
 * a type error — not just a recipe step. If a legitimate 4th onboarding step
 * is ever needed, this type must change deliberately and get RL-2 sign-off,
 * not silently grow via a general array.
 */
export interface OnboardingStripProps {
  steps: readonly [
    OnboardingStep & { id: 'store' },
    OnboardingStep & { id: 'menu' },
    OnboardingStep & { id: 'payments' },
  ];
}
```

This is stricter than the inventory's literal text (`steps: [store, menu,
payments]`, which reads as descriptive shorthand, not TS syntax) — I've made
it an actual fixed 3-tuple with each position's `id` pinned by intersection
type, so `steps` can't even be reordered into `[payments, store, menu]`
without also being valid (order doesn't matter functionally, but pinning
each position's `id` means a caller can't accidentally pass two `'store'`
entries and no `'payments'` entry, which a bare `[OnboardingStep,
OnboardingStep, OnboardingStep]` tuple would allow). This is the component
whose RL-2 comment is explicitly required by the WBS acceptance criteria —
present in the interface doc comment above, cite it again in the `.tsx` file.

### `RecipeBlock` — `packages/ui/src/components/RecipeBlock.tsx`

```ts
export interface RecipeRow {
  ingredientId: string;
  ingredientName: string;
  quantity: number | null;   // null = not yet entered, never 0
  unit: string;
}

export interface RecipeBlockProps {
  itemName: string;
  recipe: RecipeRow[] | null;      // null = no recipe row exists at all (RL-2 baseline)
  suggestion: RecipeRow[] | null;  // a standard-recipe suggestion, or null if none exists
  onUse: (suggestion: RecipeRow[]) => void;
  onChange: (recipe: RecipeRow[]) => void;
}
```

**Deliberately absent from this interface: `required`, `error`,
`validationState`, `isValid`, any prop whose name matches
`/required|error|valid|missing|incomplete/`.** This is enforced by omission,
not by a forbidding type — there is no way to type-check "this interface will
never grow a validation prop" the way a literal type blocks `minHeight={44}`.
The enforcement here is structural + procedural: (a) this document and the
component's own JSDoc state the constraint explicitly so a future PR adding
`error?: string` is an obvious, callable-out diff; (b) `redline_reviewer`'s
audit checklist should include "does `RecipeBlockProps` have grown a
validation-shaped prop" as a standing check every time this file changes; (c)
the forbidden-phrase grep (already exists for `apps/console`'s Thai copy per
CLAUDE.md's RL-2 list: `ยังไม่ได้ใส่ / ควรใส่ / กรุณาใส่ / ไม่ครบ / ยังขาด`)
should also run over `packages/ui/src/components/RecipeBlock.tsx` specifically
— today that grep is scoped to `apps/console` only (per CLAUDE.md's own
wording, "forbidden in `apps/console`"), and since `RecipeBlock` physically
lives in `packages/ui`, the phrase could be introduced there and never get
caught by an apps/console-scoped grep. **Recommend widening that CI grep's
glob to include `packages/ui/src/**` — see §4.**

### `MetricCard` — `packages/ui/src/components/MetricCard.tsx`

```ts
export interface MetricCardProps {
  label: string;
  value: number | null;    // same null discipline as MoneyValue
  role: MoneyRole;          // reuse MoneyValue's role union — MetricCard wraps MoneyValue
  note?: string;             // plain grey, per inventory
}
```

Same `number | null` discipline as `MoneyValue` — in fact `MetricCard` should
compose `MoneyValue` internally rather than reimplement the null→"—" logic, so
there's exactly one place in the package that decides how an unknown figure
renders.

### `NavShell` — `packages/ui/src/components/NavShell.tsx`

```ts
export type ConsoleNavItem = 'home' | 'orders' | 'sell' | 'inventory' | 'more';
// exact 5-item set inferred from brewledger-tokens.css's
// .oc-nav{grid-template-columns:repeat(5,1fr)} and the screen inventory's
// five bottom-tab destinations — engineer should confirm the literal id
// strings against console-setup.js / owner-console.js at implementation
// time; the *count* (5) and the responsive breakpoint (below) are
// confirmed from the CSS, the id names are my inference and are NOT
// load-bearing, flag for verification.

export interface NavShellProps {
  surface: 'console';    // inventory pins this to the single literal 'console' —
                          // apps/shop does not use NavShell (its shell is `.cw-*`,
                          // a sticky header + cart bar, not a tab bar/sidebar —
                          // confirmed by brewledger-tokens.css's separate
                          // "Customer web shell" vs "Console shell" comment blocks).
                          // This is itself a small RL-3-adjacent signal: NavShell
                          // being console-only in its own type is one more place
                          // a reviewer can see apps/shop was never meant to grow
                          // console-shaped navigation.
  active: ConsoleNavItem;
  badge?: number;
}
```

Responsive breakpoint confirmed directly from `brewledger-tokens.css`:
`.oc-nav` (bottom bar) is the default, `.oc-side` (sidebar) activates at
`@media(min-width:1280px)` where `.oc-nav{display:none}` — this is a CSS
media-query concern inside the component, not a prop; `NavShell` should not
take a `layout: 'bottom'|'side'` prop that the caller decides, since the spec
is that this is purely a viewport breakpoint, not app state.

---

## 3. Package structure

```
packages/ui/
  package.json
  tsconfig.json
  README.md                      (source-of-truth precedence, RL-3 rule, "regenerate don't edit")
  scripts/build-tokens.mjs        (§1.3, run via `pnpm --filter @brewledger/ui build:tokens`)
  src/
    tokens.css                   (generated — do not hand-edit)
    tokens.generated.meta.json   (optional: machine-readable {name, sourceFile, sourceLine}
                                   for the fidelity checker in §5 to consume)
    components/
      MoneyValue.tsx
      OrderStatusBadge.tsx
      OrderCard.tsx
      SlotPicker.tsx
      ConfidenceField.tsx
      EmptyState.tsx
      UntrackedDisclosure.tsx
      StatusButton.tsx
      OnboardingStrip.tsx
      RecipeBlock.tsx
      MetricCard.tsx
      NavShell.tsx
    index.ts                     (barrel export — components + types, NOT tokens.css,
                                   which is imported by path, see §3.2)
    gallery.tsx                  (§4 of the WBS prompt — every component, every state,
                                   real Thai copy from state_matrix.md)
  tailwind-preset.ts              (generated — do not hand-edit)
```

### 3.1 `package.json`

```json
{
  "name": "@brewledger/ui",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./tokens.css": "./src/tokens.css",
    "./tailwind-preset": "./dist/tailwind-preset.js"
  },
  "scripts": {
    "build:tokens": "node scripts/build-tokens.mjs",
    "build": "pnpm build:tokens && tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "lint": "eslint",
    "test": "vitest run"
  },
  "peerDependencies": {
    "react": "^19",
    "react-dom": "^19"
  },
  "devDependencies": {
    "postcss": "^8",
    "postcss-value-parser": "^4",
    "typescript": "^5",
    "vitest": "^4",
    "@types/react": "^19",
    "@types/react-dom": "^19"
  }
}
```

**React as `peerDependencies`, not `dependencies`** — both `apps/shop` and
`apps/console` already declare `react@19.2.8`/`react-dom@19.2.8` directly
(confirmed by reading both apps' `package.json`, which are identical on this
point). A shared UI package bundling its own React copy risks two React
instances in one app's bundle (hooks-outside-render errors, context not
matching across instances) — the standard monorepo pattern, and the one
`packages/shared`'s existing structure doesn't need to answer (it has no React
dependency at all) but `packages/ui` does. `peerDependencies` lets pnpm's
workspace linking resolve to each app's own React.

**No Tailwind dependency at all in `packages/ui`.** The package emits a
*preset* (a plain TS object matching Tailwind's `Config['theme']['extend']`
shape) and a *tokens.css* file — it does not itself run Tailwind or import the
`tailwindcss` package. Both consuming apps already have `tailwindcss: ^4` and
`@tailwindcss/postcss: ^4` in their own `devDependencies` (confirmed by
reading both `apps/shop/package.json` and `apps/console/package.json` — both
identical here too). Tailwind v4's CSS-first config (`@theme` blocks / `@config`
directive in a real CSS file, replacing the v3 `tailwind.config.js` JS
export) changes exactly how the preset gets consumed — see §3.2.

### 3.2 Consumption by `apps/shop` / `apps/console`

Both apps currently have Tailwind v4 tooling installed (`@tailwindcss/postcss`
in `devDependencies`) but — per this task's instruction not to touch those
apps — I did not find (and am not creating) an existing `globals.css` /
`app/layout.tsx` wiring in either app; that wiring is `engineer`'s job in the
WBS entry that actually builds each app's shell (out of scope here). The
integration point this design specifies, for `engineer` to implement later:

- Each app's root CSS entry point (e.g. `app/globals.css`) does:
  ```css
  @import "tailwindcss";
  @import "@brewledger/ui/tokens.css";
  @config "../../packages/ui/tailwind-preset.ts"; /* or equivalent v4 mechanism —
    engineer should confirm exact v4 preset-import syntax against the installed
    @tailwindcss/postcss version at implementation time; v4's config story
    differs enough from v3 that I'm not asserting the exact directive name
    here as load-bearing, only the shape: import tokens.css for the custom
    properties, import the preset for Tailwind's generated utility classes. */
  ```
- `apps/shop` and `apps/console` each add `"@brewledger/ui": "workspace:*"`
  to `dependencies` (not `devDependencies` — components ship into both
  runtime bundles).
- Neither app hand-writes `--green-brew` or `56px` anywhere in its own CSS
  once this is wired — every token reference goes through `var(--token-name)`
  (from `tokens.css`) or a Tailwind utility class (from the preset). This is
  the practical mechanism that makes "all 8 order-status pairs match exactly"
  auditable: `grep -rn "#" apps/shop/src apps/console/src` for hardcoded hex
  values should return nothing once the port is live.

---

## 4. RL-3 boundary enforcement design

Three layers, matching the project's existing pattern (RLS + import
boundary + anti-spread lint, per CLAUDE.md's RL-3 section):

**1. Import boundary (extend `eslint.config.mjs`).** Add a zone entry so
`packages/ui` itself can never import `packages/costing` or any module
matching the existing `/costing|margin|profit|expense|stock|bom|recipe/`
pattern family used elsewhere in this repo's red-line language — except
`RecipeBlock.tsx` and `RecipeRow`, which are a **UI shape for recipe data**,
not an import of `packages/costing`'s actual costing engine; the ban is on
importing the costing *package*, not on having a component whose domain is
recipes. Concretely:
```js
{
  files: ["packages/ui/**/*.{ts,tsx}"],
  plugins: { import: importPlugin },
  settings: importResolverSettings,
  rules: {
    "import/no-restricted-paths": ["error", {
      zones: [
        { target: "./packages/ui", from: "./packages/costing",
          message: "packages/ui is imported by apps/shop (unauthenticated) — it may never import packages/costing. RL-3." },
        { target: "./packages/ui", from: "./packages/db",
          message: "packages/ui renders whatever data it's given as props — it must never reach into packages/db itself. RL-3." },
        { target: "./packages/ui", from: "./apps/console",
          message: "packages/ui is a shared leaf package — it may not depend on either app." },
      ],
    }],
  },
},
```

**2. Content-pattern lint rule, new file `eslint-rules/no-cost-formatting-logic.cjs`,**
modeled directly on `eslint-rules/no-db-row-spread.cjs`'s existing structure
(same `ESLintUtils.RuleCreator` scaffold, same "defence in depth, not a
soundness proof" honesty about scope). This rule is scoped to
`packages/ui/src/components/**/*.tsx` **excluding** `MoneyValue.tsx` and
`MetricCard.tsx` (which legitimately implement the one sanctioned exception —
null-handling for money display) and flags:
- Any arithmetic (`BinaryExpression` with `-`, `*`, `/`) where an operand's
  variable name matches `/cost|margin|profit/i` — a component computing
  `revenue - cost` locally would be reimplementing costing logic instead of
  receiving a pre-computed value as a prop, which is the actual violation
  shape RL-3 cares about (a formatting component should never *derive* a
  financial figure, only *render* one it was handed).
- Any prop or local identifier named `marginPercent`, `profitSatang`, etc.,
  outside the two exempted files — same rationale as the anti-spread rule's
  `Row$` suffix convention, a naming-convention check is not sound but is
  cheap and catches the common case.

This is genuinely a new rule to write (`engineer`'s task, not designed line
by line here), but the shape — same file structure as
`no-db-row-spread.cjs`, registered in `eslint-rules/index.cjs`, wired into
`eslint.config.mjs`'s `packages/ui` block — should follow the existing
pattern exactly so the codebase has one consistent way local rules are added.

**3. Widen the existing forbidden-Thai-phrase CI grep** (referenced in
CLAUDE.md's RL-2 section, currently scoped to `apps/console`) to also cover
`packages/ui/src/**` — see §2's `RecipeBlock` entry for why: the component
that must never nag physically lives in this package now, not in
`apps/console`, and a grep scoped only to the app that *uses* it won't catch a
violation introduced in the package that *defines* it.

**4. `redline_reviewer` standing checklist addition** (procedural, not
automatable): every future change to `RecipeBlockProps` gets checked for a
newly added validation-shaped prop, per §2's `RecipeBlock` note — this is the
one constraint in this whole design that has no type-level or lint-level
enforcement, because "no validation prop at all" can't be expressed as a
forbidden pattern without also forbidding legitimate non-validation optional
props. Flagging honestly rather than claiming false coverage.

---

## 5. Fidelity verification approach

Concrete, runnable design (implementation is `engineer`'s):

**Tool: Playwright**, already the natural choice since the prototype is
static HTML/JS (`design/*.html` + `design/*.js`, e.g. `Owner Console.html` +
`owner-console.js`) that can be opened directly via `file://` or a throwaway
static server, and the gallery (`packages/ui/src/gallery.tsx`) will render as
a Next.js/Vite dev page reachable over `http://localhost`.

```
scripts/verify-fidelity.mjs (or packages/ui/tests/fidelity.spec.ts under Playwright's test runner)

For each component × state pair (drawn from a manifest the gallery itself
exports, e.g. gallery.tsx also exports a FIDELITY_MANIFEST: Array<{
  component: string; state: string; galleryTestId: string;
  prototypeFile: string; prototypeSelector: string;
}> — so the manifest lives next to the gallery and can't silently drift from
what the gallery actually renders):

  1. Launch two Playwright pages: one navigated to the gallery entry
     (`page.getByTestId(galleryTestId)`), one navigated to the corresponding
     prototype HTML file's matching element (`prototypeSelector`, a plain
     CSS selector into e.g. Owner Console.html).
  2. For each element, call `page.evaluate(el => getComputedStyle(el))` and
     extract exactly: fontFamily, fontSize, lineHeight, color,
     backgroundColor, minHeight — the properties the WBS prompt names
     explicitly ("font-family, font-size, line-height, colour, and
     min-height"), plus backgroundColor since colour alone doesn't catch a
     status badge's fill vs the dictionary's "8 order-status treatments
     match... exactly" acceptance line, which is a bg/fg pair, not fg alone.
  3. Compare: exact string equality for fontFamily; numeric tolerance of 0
     for fontSize/lineHeight/minHeight (these come from the same token
     source, so a mismatch means the pipeline diverged, not a "close
     enough" rounding case — treat any difference as fail); color/
     backgroundColor compared as parsed RGB(A) tuples (getComputedStyle
     normalizes to rgb()/rgba(), so a token defined as oklch() in colors.css
     and a Tailwind-generated rgb() in the gallery should still match once
     both are computed-style-resolved by the browser — if they don't, that's
     the real bug the check exists to catch, e.g. an oklch->rgb conversion
     drifting).
  4. Emit one row per component×state×property: PASS or FAIL with both
     values. A single property mismatch fails that component's row —
     no partial credit, since the WBS language is "match... exactly."
  5. Exit non-zero if any row fails. This becomes a CI gate (or at minimum a
     `pnpm --filter @brewledger/ui verify:fidelity` script engineer runs
     before declaring a component done) — "report any divergence rather than
     silently accepting it" (WBS prompt step 6) is satisfied by the exit code
     plus the row-level report, not by a human eyeballing a screenshot diff.
```

Pass/fail definition: **zero FAIL rows across the full manifest.** A manifest
entry with no matching prototype selector (component genuinely has no
prototype equivalent, e.g. if `NavShell`'s sidebar variant only ever appears
at ≥1280px and the prototype was authored at a fixed narrower viewport) is
not silently skipped — it's a third state, `NO_REFERENCE`, that must be
explicitly listed and justified in the manifest comment, not just absent
(absence is indistinguishable from "forgot to write this row," which is
exactly the silent-divergence failure mode the WBS prompt is warning against).

Screenshot-diff (pixel comparison) is explicitly **not** the primary
mechanism — computed-style comparison is more precise for catching "the
right visual result via the wrong CSS" (e.g. a hardcoded `14px` that happens
to render identically to `var(--tap-min)` today but silently stops matching
the moment the token changes) and is what the WBS prompt's own wording
("diff the computed styles," not "diff the screenshots") asks for.

---

## 6. Sequencing recommendation

**Split into four verifiable chunks, in this order, not one pass.** Rationale:
this is a 12-component + pipeline + gallery + fidelity-check port with a real
risk of silent drift (the WBS entry's own stated concern), and each chunk
below produces an artifact the next chunk can be checked against — building
all 12 components before the token pipeline exists would mean hand-picking
values now and reconciling later, which is the exact hand-transcription
anti-pattern the WBS prompt forbids ("Hand-transcribing these values will
introduce drift. Parse them.").

1. **Token pipeline alone** (`scripts/build-tokens.mjs` → `tokens.css` +
   `tailwind-preset.ts`), verified by the token test in §1.4, before any
   component exists. This is a self-contained, independently testable unit —
   ship it, get it reviewed, then build on it.
2. **Money/status primitives**: `MoneyValue`, `OrderStatusBadge`,
   `MetricCard` (composes `MoneyValue`), `UntrackedDisclosure`. These four
   are where RL-2/RL-3's null-handling and the 8-status exact-match live —
   group them because they share the null/role vocabulary and because
   getting these four exactly right unblocks every other component that
   displays a figure (`OrderCard`, `RecipeBlock` all reference money
   indirectly).
3. **Interaction components**: `StatusButton`, `ConfidenceField`,
   `SlotPicker`, `EmptyState`. Grouped because each has one nontrivial
   interaction-state concern (56px lock, autofocus-on-low-confidence,
   remaining-count threshold, optional action) worth its own focused review
   pass rather than being buried in a 12-component batch review.
4. **Composite/layout components**: `OrderCard`, `RecipeBlock`,
   `OnboardingStrip`, `NavShell`. These depend on chunk 2's primitives
   (`OrderCard` likely renders `OrderStatusBadge` internally) and carry the
   two hardest-to-verify constraints (`OnboardingStrip`'s fixed tuple,
   `RecipeBlock`'s "no validation surface at all") — doing these last means
   the reviewer isn't checking a brand-new component vocabulary and a novel
   red-line constraint in the same pass.

Gallery + fidelity check (§5) should be built incrementally alongside each
chunk (add each component's gallery entry and manifest row as it's built),
not deferred to the end — deferring it to the end means 12 components get
"declared done" before the one artifact that actually catches drift has ever
run against any of them.

### Ambiguities flagged for `engineer` (not resolved here, resolve during build)

- **`MoneyValue.size?`** — no enum given anywhere in the three source
  documents (WBS dictionary, component_inventory.md, P5 Handoff.md §4). I
  proposed `'sm'|'md'|'lg'` in §2 as a reasonable default; confirm against
  `design/*.js` prototype usage (grep for a `.money` class with a size
  modifier) before finalizing, since the prototype's actual CSS
  (`.money{font-variant-numeric:tabular-nums;font-weight:700}` in
  `brewledger-tokens.css`) shows no size-variant class today — it's possible
  `size` maps to the surrounding `--text-N` scale contextually rather than a
  fixed 3-step enum.
- **`NavShell`'s `ConsoleNavItem` id strings** — inferred from the 5-column
  grid CSS, not confirmed against actual route names. Check
  `design/owner-console.js` / `design/console-setup.js` for the real nav item
  identifiers before finalizing the union — using the wrong id strings here
  is low-risk (easy rename) but should not ship as guessed values in a type
  other code will key on.
- **Whether `apps/shop` uses any component from this inventory at all,
  and which.** The component list reads console-heavy (`OnboardingStrip`,
  `RecipeBlock`, `MetricCard`, `NavShell` are all console-only by their own
  prop contracts — `NavShell.surface: 'console'` literally excludes shop).
  `MoneyValue`/`OrderStatusBadge`/`OrderCard`/`SlotPicker` plausibly render on
  the customer side (`/o/{code}` order tracking, `/checkout` slot picking)
  but I did not find an explicit shop-side usage list in any of the three
  source documents. This matters for RL-3 because it determines which
  component variants get exercised by `apps/shop`'s bundle at all — worth
  `engineer` confirming against `docs/design/screen_inventory.md`
  (unread in this pass — out of scope for this design task but a fast check)
  before assuming any given component is console-only in practice, not just
  by its type signature.
- **Base-DS `.btn`/`.input`/`.card`/`.field` element classes in
  `brewledger-tokens.css`** are real component-shaped CSS (buttons, form
  fields, cards) that exist in the prototype but have **no named entry in
  the 12-component inventory** — e.g. there's no `Button` or `TextField` or
  `Card` component listed, yet `.btn--primary`, `.input.is-error`, `.card`
  all exist as prototype classes. Per `component_inventory.md`'s own header
  ("do not invent a component — if one is genuinely missing, add it here
  first"), this is worth a question back to whoever owns
  `docs/design/component_inventory.md`/WBS 2.1 rather than `engineer`
  silently inventing a `Button` component mid-port: is a generic `Button`
  intentionally out of scope for this WBS entry (because every documented
  component like `StatusButton` already covers its call sites), or is it a
  genuine gap like GAP-1 was for the transaction ledger screen.
