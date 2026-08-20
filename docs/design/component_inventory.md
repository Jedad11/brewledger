# Component Inventory

Extracted from `/design/P5 Handoff.md` §4. Reference copy; source of record
is `/design/P5 Handoff.md`. Do not invent a component — if one is genuinely
missing, add it here first, in the same change that needs it.

| Component | Props |
|---|---|
| `MoneyValue` | `value: number \| null` (satang), `role: 'revenue'\|'cost'\|'profit'\|'plain'`, `decimals?: 0\|2`, `size?`. **null → `—`, never 0.** |
| `OrderStatusBadge` | `status: 'unpaid'\|'accepted'\|'making'\|'ready'\|'collected'\|'cancelled'\|'refunded'\|'expired'`. `ready` is the only filled badge. |
| `OrderCard` | `order`, `variant: 'inbox'\|'detail'`, `showNextAction: boolean`, `unseen: boolean`, `onAdvance`, `onCancel`, `onOpen` |
| `SlotPicker` | `slots: {time, remaining}[]`, `value`, `onChange`, `showRemainingBelow: number = 2`, `fullMessage` |
| `ConfidenceField` | `label`, `value`, `confidence: 'high'\|'low'`, `unit?`, `onChange`, `autoFocusIfLow: boolean` |
| `EmptyState` | `title`, `body`, `action?` — action omitted wherever the empty state is legitimately optional (inventory, recipes) |
| `UntrackedDisclosure` | `trackedCount`, `totalCount`, `untrackedRevenue?`, `variant: 'dashboard'\|'pnl'\|'dish'` — plain grey text on all three |
| `StatusButton` | `label`, `onPress`, `minHeight: 56`, `optimistic: true` |
| `OnboardingStrip` | `steps: [store, menu, payments]` — **never accepts a recipe step** |
| `RecipeBlock` | `itemName`, `recipe: Row[] \| null`, `suggestion: Row[] \| null`, `onUse`, `onChange` — collapsed by default, zero validation |
| `MetricCard` | `label`, `value: number \| null`, `role`, `note?: string` (plain grey) |
| `NavShell` | `surface: 'console'`, `active`, `badge?: number` — bottom bar <1280px, sidebar ≥1280px |
| `Toggle` | `label`, `description?`, `checked: boolean`, `onChange`, `disabled?` — ported `.oc-toggle`/`.oc-sw`. Not one of the original 12; added WBS 4.3 (store publish switch) the way Button/Input/Card were added in 2.2. |

No new component was needed to document GAP-1 (the transaction ledger). Its
screen composes existing patterns: a segmented control (already used
elsewhere in Console Reports for period selection), a summary bar of
`MoneyValue`-shaped figures, and a table of rows — none of which required a
new named component per the inventory above.

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
