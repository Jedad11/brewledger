# Component Inventory

Extracted from `/design/P5 Handoff.md` §4. Reference copy; source of record
is `/design/P5 Handoff.md`. Do not invent a component — if one is genuinely
missing, add it here first, in the same change that needs it.

| Component | Props |
|---|---|
| `MoneyValue` | `value: number \| null` (satang), `role: 'revenue'\|'cost'\|'profit'\|'plain'`, `decimals?: 0\|2`, `size?`. **null → `—`, never 0.** |
| `OrderStatusBadge` | `status: 'unpaid'\|'accepted'\|'making'\|'ready'\|'collected'\|'cancelled'\|'refunded'\|'expired'`. `ready` is the only filled badge. |
| `OrderCard` | `order: OrderSummary` (adds optional `items?: {name, optionsLabel?, quantity}[]` as of WBS 5.8, for the inbox's full line-item display — omit to fall back to `itemsSummary` only), `variant: 'inbox'\|'detail'`, `showNextAction: boolean`, `unseen: boolean`, `onAdvance?`, `onCancel?`, `onOpen?` — all three handlers optional as of WBS 5.8: an omitted handler omits its button rather than rendering a tap target with no working action (WBS 5.9/5.11 own the advance/cancel/detail flows and are expected to supply these once built) |
| `SlotPicker` | `slots: {time, remaining}[]`, `value`, `onChange`, `showRemainingBelow: number = 2`, `fullMessage` |
| `ConfidenceField` | `label`, `value`, `confidence: 'high'\|'low'`, `unit?`, `onChange`, `autoFocusIfLow: boolean` |
| `EmptyState` | `title`, `body`, `action?` — action omitted wherever the empty state is legitimately optional (inventory, recipes) |
| `UntrackedDisclosure` | `trackedCount`, `totalCount`, `untrackedRevenue?`, `variant: 'dashboard'\|'pnl'\|'dish'` — plain grey text on all three |
| `StatusButton` | `label`, `onPress`, `minHeight: 56`, `optimistic: true` |
| `OnboardingStrip` | `steps: [store, menu, payments]` — **never accepts a recipe step** |
| `RecipeBlock` | `itemName`, `recipe: Row[] \| null`, `suggestion: Row[] \| null`, `ingredientOptions: {id,name,baseUnit}[]`, `onUse`, `onChange`, `onDismiss`, `onCreateIngredient`, `onOpenChange?` — collapsed by default, zero validation. `ingredientOptions`/`onCreateIngredient`/`onDismiss` added WBS 6.7 for the per-row ingredient picker (inline create, same pattern as WBS 6.4/6.5's purchase-review screen), the permanent per-item suggestion dismissal, and letting the caller render its own cost-preview line beside this component (`onOpenChange`) without RecipeBlock itself ever computing a cost figure (RL-3, `no-cost-formatting-logic.cjs`) |
| `MetricCard` | `label`, `value: number \| null`, `role`, `note?: string` (plain grey) |
| `NavShell` | `surface: 'console'`, `active`, `badge?: number` — bottom bar <1280px, sidebar ≥1280px |
| `Toggle` | `label`, `description?`, `checked: boolean`, `onChange`, `disabled?` — ported `.oc-toggle`/`.oc-sw`. Not one of the original 12; added WBS 4.3 (store publish switch) the way Button/Input/Card were added in 2.2. |
| `Sparkline` | `values: (number \| null)[]` (chronological). Ported from `design/console-reports.js`'s `spark()`. Not one of the original 12; added WBS 7.5 for the P&L's 7-day net-profit trend strip. `null` points are skipped when drawing the line (never coerced to 0 — same RL-2 null discipline as `MoneyValue`); renders nothing with fewer than 2 defined points. |
| `QuickSaleTile` | `id`, `name`, `priceSatang`, `quantityInCart: number` (badge, hidden at 0), `hot: boolean` (128px double-width variant), `onTap`, `onLongPress` — ported `.oc-tile`/`.oc-tile.is-hot`/`.oc-tilebadge` from `design/Owner Console.html`. Not one of the original 12; added WBS 5.12 (quick cash sale) — no tile-grid component existed before this entry, so one was added here per the "add it here first" rule rather than defined ad hoc in `apps/console`. Presentational plus press detection only (500ms pointer-hold or native `contextmenu` fires `onLongPress`; a plain click fires `onTap`); the caller composes the `.oc-tiles` grid and owns all cart state. |

No new component was needed to document GAP-1 (the transaction ledger). Its
screen composes existing patterns: a segmented control (already used
elsewhere in Console Reports for period selection), a summary bar of
`MoneyValue`-shaped figures, and a table of rows — none of which required a
new named component per the inventory above.

No new component was needed for WBS 5.10 (customer order tracking) either.
`/o/{code}`'s 4-step progress indicator and order-code display reuse the
prototype's own `.cw-code`/`.cw-steps`/`.cw-stepitem`/`.cw-dot` classes,
ported into `packages/ui/src/components.css` in this same change (they
weren't ported earlier — WBS 5.5's pay-screen block only pulled the classes
`/pay` itself needed). `/track`'s two-field form reuses `Input` and `Button`
unchanged.

No new component was needed for WBS 5.1 (public store page and menu browse)
either. It composes `MoneyValue` and `EmptyState` from this inventory, plus
the prototype's own `.cw-*` page-shell/store-header/menu-list classes
(`design/Customer Web.html`'s page-scoped `<style>` block, not the shared
token file 2.2 read from) — completed in `packages/ui/src/components.css` in
the same change, same literal-port discipline as the rest of that file. The
store open/closed pill reuses the existing `st st--<status>` badge markup
directly (see `OrderStatusBadge`) rather than going through that component,
since its status enum (`unpaid`/`accepted`/...) has no open/closed pair —
only the CSS classes are shared, not the component.
