# Known Issues

Honest record of deliberate current-state limitations — not a bug backlog.
Each entry states the design choice, its consequence, and (where one
exists) the planned upgrade path. Do not describe a documented design
choice as a "temporary workaround" — if it needs reframing as a real defect,
move it out of this file and into the issue tracker instead.

## Payment confirmation is manual (WBS 5.6)

BrewLedger's payment model (ADR-008, `docs/adr/008-direct-promptpay.md`) is
direct merchant-owned PromptPay: money moves straight from the customer's
bank to the merchant's own PromptPay account, with no payment gateway and no
platform float or escrow (RL-1). That is a deliberate, load-bearing design
choice — sole-proprietor merchants cannot clear a licensed gateway's KYC in
the pilot's timeframe — and it has a real cost that is stated plainly here
rather than minimised: **the system cannot observe that money arrived.**
BrewLedger is not in the path of the funds, so there is no transaction log
to read and no webhook to receive.

What the system does instead: the merchant sees the transfer land in their
own banking app (which pushes its own notification), opens
`/console/orders`, and taps `ได้รับเงินแล้ว` on the matching pending order.
That single tap is the entire "payment confirmation" event — there is no
independent verification behind it.

**Consequence:** an order sits in `รอยืนยันการชำระเงิน` — not in the working
queue, not notified to kitchen staff, no stock deducted — until the merchant
manually confirms it. A merchant who is slow to check their banking app
delays their own order visibly; an order left unconfirmed for 15 minutes
expires automatically and releases its slot (the WBS 5.6 expiry sweep).

**Planned mitigation (Phase 2, not built):** slip-verification API
integration — a third-party service that OCRs and verifies a PromptPay
transfer slip image against the expected amount/recipient, removing the
manual tap for the common case. Costed at roughly 0.14–0.20 THB per slip
verified, which is why it is a Phase 2 item rather than baseline: at pilot
volume the manual tap is materially cheaper, and the pilot needs to prove
the core pre-order/costing loop before adding a paid third-party dependency
to the payment path.

## Two dependency gaps accepted in WBS 5.6, to revisit when their owning entries land

WBS 5.6 (Merchant Payment Confirmation) depends on two pieces of
infrastructure that had not been built yet when 5.6 was implemented. Both
gaps were resolved with an explicitly-scoped, WBS-sanctioned fallback rather
than either blocking 5.6 or silently inventing the missing entry's design.
Both fallbacks are correct and tested as-is; neither should be read as
unfinished work on WBS 5.6 itself.

**WBS 5.7 (`transitionOrder` / `order_status_history`) does not exist yet.**
`console_confirm_payment` and `console_reject_payment`
(`packages/db/migrations/0031_payment_confirmation.sql`) write the order
status transition directly, guarded by a conditional `UPDATE ... WHERE
status = 'PENDING_PAYMENT'`, instead of routing through a `transitionOrder()`
helper. This is the WBS 5.6 prompt's own sanctioned fallback ("write the
history row inline and refactor when 5.7 lands") — WBS 5.6's Acceptance
criteria require the audit columns (`orders.payment_confirmed_by` /
`payment_confirmed_at`, already present since `0011_orders.sql`), not a
history table. No `order_status_history` row is written by either function.
**Revisit:** once WBS 5.7 lands `transitionOrder()` and its history table,
route both functions' status changes through it and backfill history for
orders confirmed/rejected before that point (or explicitly accept the gap
for pre-5.7 orders).

**WBS 6.8 (Automatic Stock Deduction) is seeded, not fully built.**
`console_confirm_payment` includes a minimal, correct stock deduction — one
`stock_ledger` row per `(order_item × bom_line)`, using
`bom_lines.qty_base_unit` as-is. This is intentionally narrow: no unit
conversion (none is needed today — `ingredients.base_unit` and
`bom_lines.qty_base_unit` are already the same base unit by construction),
no negative-stock warning surface, no low-stock alerting. An order item
whose menu item has zero `bom_lines` rows correctly produces zero ledger
rows and zero warnings (RL-2) — verified against a live database, not just
reasoned about. **Revisit:** WBS 6.8 (`packages/costing`, per its own WBS
dictionary pseudocode) owns extending this — real unit conversion once a
schema exists for it, the negative-stock warning ("น่าจะยังไม่ได้บันทึกบิลซื้อ"),
and low-stock alerting. Extend the existing INSERT in
`console_confirm_payment` (or move it into `packages/costing/src/stock.ts`
and have the Postgres function call out to it) rather than adding a second
call site — `WBS 5.12`'s cash-sale path will need the same deduction and
should reuse whichever of the two becomes canonical.

**`payment_confirmed_by` records the confirming merchant, not the
confirming session.** WBS 5.6's own Acceptance list requires "every
confirmation writes an audit row naming the confirming session," and its
pseudocode threads a `ctx.sessionId` into that column. The implementation
instead writes `p_merchant_id` (`packages/db/migrations/
0031_payment_confirmation.sql`, `console_confirm_payment`,
`supabase/functions/console-confirm-payment/index.ts`) — every confirmation
from the same merchant account writes the identical value, regardless of
which device or browser tab performed it. This is a deliberate design
tradeoff, not an oversight: doing it properly means extracting a Supabase
Auth `session_id` JWT claim in `verifyConsoleRequest` and adding it to
`ConsoleContext` (`supabase/functions/_shared/console/auth.ts`), which
every console-* Edge Function sits downstream of, and this repo's local
test-JWT-minting fixture (`supabase/functions/_tests/helpers/clients.ts`)
cannot even produce that claim today — there is no local SMS provider to
obtain a real GoTrue session from, so the fixture hand-mints a JWT with
only `sub`/`aud`/`role`/`iss`/`iat`/`exp`. Threading a real session
identifier through is disproportionate scope for WBS 5.6 alone. **Not a
red-line issue:** the money-safety guard is ownership (`auth_store_ids()`)
plus the idempotent `status = 'PENDING_PAYMENT'` WHERE clause, neither of
which depends on this column's granularity — it only affects the audit
trail's specificity. Acceptable for a sole-proprietor pilot, where "which
merchant confirmed" and "which session confirmed" coincide in practice.
**Revisit:** alongside WBS 4.1/4.2 auth plumbing, if and when multi-device
or multi-staff console sessions become real — thread `session_id` through
`ConsoleContext` and switch both `console_confirm_payment` and this
column's write path over at the same time.
