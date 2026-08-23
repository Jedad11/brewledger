# Design Gaps

Screens or feature surfaces specified (by the WBS/Requirement Index) but not
fully delivered in `/design/`, or delivered but undocumented. Each item
carries an owner (M1/M2, per the WBS Team Roster) and a decision — nothing
here is left open-ended.

---

## GAP-1 — Transaction ledger (รายการเดินบัญชี) — undocumented, not missing

**Status:** Exists and is complete in the delivered package. It was simply
absent from `P5 Handoff.md`'s screen inventory and state matrix.

- **Implementation:** `console-reports.js`, screen key `ledger`.
- **Registration:** `TABS` includes `['ledger','รายการเดินบัญชี']`.
- **Reachable from:** `Console Reports.html`.
- **Route:** `/console/transactions`.
- **Surface / auth:** Console, authenticated.
- **Views:** รายวัน (default) and รายเดือน, toggled by a segmented control.
- **Daily columns:** เวลา / รายการ / ประเภท / จำนวนเงิน.
- **Summary bar:** รับเข้า / จ่ายออก / คงเหลือสุทธิ, net figure rendered largest.
- **Monthly columns:** วันที่ / จำนวนรายการ / รับเข้า / จ่ายออก / คงเหลือ, plus a month total row.
- **Row types (6):** ขายออนไลน์ / ขายหน้าร้าน / ซื้อวัตถุดิบ / ค่าธรรมเนียม / ค่าธรรมเนียม (BrewLedger ออกให้) / คืนเงิน.
- **Source linking:** rows carry `data-src="order"` or `data-src="bill"` to open the source record.
- **States (3 + 1 variant):** default, วันที่ไม่มีรายการ, กำลังโหลด, plus a วันที่มีแต่เงินสด variant.
- **Empty copy:** `วันนี้ยังไม่มีรายการ` / `รายการจะขึ้นที่นี่เมื่อมีการขายหรือบันทึกบิลซื้อ`.
- **Absorbed-fee rule:** the ค่าธรรมเนียม (BrewLedger ออกให้) row type renders as its own muted row and is **excluded** from จ่ายออก. Verified in `console-reports.js`: `dayOut = r => r.filter(x => x.amt < 0 && x.k !== 'feeabs').reduce(...)`. Note copy: `ค่าธรรมเนียมที่ BrewLedger ออกให้ แสดงไว้ให้เห็นโครงสร้างต้นทุนจริง แต่ไม่ได้นับรวมในยอดจ่ายออก`.

**Decision:** Documented, not rebuilt. Added to `/docs/design/screen_inventory.md`
and `/docs/design/state_matrix.md` by reading the implementation directly —
no new design work was needed since the screen already exists and is
complete.

**Owner:** M2.

**Blocks:** Nothing. Must be closed (i.e., this documentation must exist)
before Phase 7 report entries start, since `/console/reports/pnl` and
`/console/reports/overview` share row-classification logic (`TXTYPE`,
absorbed-fee exclusion) with this screen — an implementer building those
without this file would be guessing at the same rule twice.

---

## GAP-2 — No merchant "confirm payment" control in the Owner Console prototype

**Status:** Partial coverage of F05 (see `coverage.md`). `OrderStatusBadge`
declares an `unpaid` status and the order activity log shows a
`ชำระเงินแล้ว` entry, but every seed order in `owner-console.js` is already
`accepted`, and `NEXT` (the optimistic-advance map) only covers
`accepted → making → ready → collected`. No button, sheet, or state in the
delivered prototype represents the merchant tapping to confirm a payment
they've seen land in their own banking app.

**Decision:** Not a blocking gap for WBS 5.6 (Payment Confirmation Edge
Function) — that entry defines the idempotent confirm action at the API
layer regardless of UI. But the **screen** needs a small addition an
implementer should not invent unprompted: an `unpaid` order card variant
with a confirm control (≥56px tap target, per the interaction spec's wet-hand
rule) that becomes `accepted` on tap. Until `/docs/design/` gets an explicit
addition for this, an implementing engineer should follow `OrderCard`'s
existing `onAdvance` pattern and the `StatusButton` component contract
(`minHeight: 56`, `optimistic: true`) rather than adding a new component, and
should flag the addition in their WBS report rather than silently
inventing copy.

**Owner:** M2 (UI), M1 (API — the idempotency guard itself).

**Blocks:** WBS 5.6 and any Owner Console order-inbox screen work (5.9)
that touches the `unpaid` state.

---

## GAP-3 — No feature-gating demonstration for subscription tiers

**Status:** Partial coverage of F12. `/console/settings/subscription`
(`Console Setup.html`, `plan` screen) shows the four-tier comparison and plan
selection, but no screen or state shows a feature actually being
locked/unlocked by tier (e.g. a disabled report, a paywalled action).

**Decision:** Deferred, not a blocker. Tier gating is a cross-cutting
concern (it would touch nearly every Console screen) rather than a single
missing screen, and the WBS's own feature list treats gating as backend
logic (WBS 4.8) layered onto existing screens. No new screen is required;
when 4.8 is implemented, each gated action should reference its own
existing screen's state rather than a new "locked" screen.

**Owner:** M2.

**Blocks:** Nothing currently scheduled. Revisit if a future WBS entry adds
tier-specific screens.

**2026-08-23 note:** `/console/settings/subscription` was rebuilt (see
GAP-10) to the prototype's own 4-card plan grid, including its
`เลือกแพ็กเกจนี้` select control per card — so "plan selection" from this
gap's original description now has a UI. It is not yet wired to a real
tier-change action (no Edge Function/Server Action exists for it), so this
gap's core finding — no screen demonstrates a feature actually being
locked/unlocked by tier — still stands.

---

## GAP-4 — No stock-movement (ledger) view for inventory deductions

**Status:** Partial coverage of F25. `/console/inventory` (`Console
Reports.html`) shows current stock levels, days-of-cover, and the negative-stock
state, all as static snapshots. No screen shows the append-only stock
movement log the WBS glossary describes ("Stock Ledger... so any number on a
report can be traced to the movement that caused it") the way GAP-1's
transaction ledger does for money.

**Decision:** Out of MVP design scope. The WBS screen list for Phase 6
(6.1, 6.4, 6.5, 6.7) covers capture, review, ingredients, and the recipe
editor — a movement-level drill-down was never specified, and the current
`/console/inventory` screen satisfies F25's acceptance (correct resulting
stock numbers), just not a full audit trail UI. Do not build a stock-ledger
screen speculatively; if a future WBS entry needs one, it should follow the
transaction ledger's pattern (GAP-1) for consistency (day/month toggle,
per-movement rows linking to source).

**Owner:** M1 (ledger data model already exists per the glossary's Stock
Ledger entry) / M2 (would own the screen if one is ever specified).

**Blocks:** Nothing.

---

## GAP-5 — Store profile screen (`ข้อมูลร้าน`) — undocumented in the state matrix, not missing

**Status:** Exists and is complete in the delivered package (`screen_inventory.md`
already lists it). It was simply absent from `P5 Handoff.md`'s state matrix —
the same category of gap as GAP-1, just for a single screen's copy rather
than a whole undocumented screen.

- **Implementation:** `console-setup.js`, screen key `store` (`scStore`).
- **Route:** `/console/settings/store`.
- **Surface / auth:** Console, authenticated.
- **Fields:** ชื่อร้าน, ที่อยู่สำหรับรับสินค้า, เวลาเปิด/เวลาปิด, ลิงก์ร้าน
  (auto-suggested, editable, never blank).
- **Publish toggle:** uses the prototype's `.oc-toggle`/`.oc-sw` switch —
  present in `Console Setup.html`'s own `<style>` block but never ported into
  `packages/ui/src/components.css` by WBS 2.2 (that port covered the 12-item
  inventory plus Button/Input/Card; this screen, and its switch control,
  wasn't touched by any entry until WBS 4.3). Ported now as `Toggle`, the
  same way Button/Input/Card were added — see `component_inventory.md`.
- **Onboarding strip:** exactly 3 steps (`OnboardingStrip`, already built in
  WBS 2.2 with the correct fixed 3-tuple type), never a recipe step.

**Decision:** Documented, not rebuilt. Added to `/docs/design/state_matrix.md`
by reading `console-setup.js` directly, and `Toggle` added to
`packages/ui`/`component_inventory.md`, in the same change (WBS 4.3) that
needed both.

**Owner:** M2.

**Blocks:** Nothing. Closed by this same change.

---

## GAP-6 — Payments screen (`การรับเงิน`) — state matrix corrected, not just documented

**Status:** The delivered prototype's `payments` screen (`console-setup.js`'s
`scPayments()`) and the state matrix section transcribed from it both
described a licensed-payment-gateway flow: a gateway merchant code field, a
"pending KYC" state, a "tested" state showing a bank account name and
branch (`เงินจะเข้าบัญชีชื่อ ส. สมใจ พาณิชย์ ธนาคารกสิกรไทย ลงท้าย 4821`), and
copy claiming the bank account number "stays with the payment provider."

This is a real conflict, not just an undocumented screen (unlike GAP-1/GAP-5):
WBS 4.5's own revision note withdrew the gateway integration from the MVP
before this screen was built (2C2P requires a ≥1-year-old commercial
registration that excludes sole-proprietor pilot stores; gateway KYC takes
15–20 business days, which doesn't fit the delivery window — see
`docs/adr/008-direct-promptpay.md`), and the prototype's own "tested" state
displays a bank account name and branch, which RL-1 forbids storing or
showing at all ("No bank account number, name, or branch is persisted").
Per `CLAUDE.md`'s precedence table, a red line outranks the state matrix,
so the state matrix is corrected in the same change rather than the
red-line violation being carried forward as "documented, working as
designed."

**Decision:** `docs/design/state_matrix.md`'s "การรับเงิน" section is
rewritten (WBS 4.5) to describe the direct-PromptPay flow the WBS 4.5
prompt itself specifies: a type selector (msisdn / nid / taxid), per-type
validation, a live self-scanned QR preview as the verification step in
place of a gateway "tested" state, and the fixed Thai explainer paragraph.
The gateway-era copy (KYC status chip, bank account name/branch line) is
removed outright, not preserved as a dead alternate state — it describes a
control that no longer exists in this architecture. The underlying layout
(card, header, form-then-note structure) is still reused per the WBS 4.5
prompt's own instruction to "reuse the delivered layout — only the fields
and copy change."

**Owner:** M1 (screen + copy), redline_reviewer (confirms no bank-detail
column or copy resurfaces).

**Blocks:** Nothing further. Closed by this same change (WBS 4.5).

---

## GAP-7 — Auto-unpublish on PromptPay edit has no visible signal in the console

**Status:** Real gap, introduced (as a side effect) by the WBS 4.5 redline
fix that added `guard_promptpay_before_publish` (`packages/db/migrations/
0027_promptpay_publish_guard.sql`). That trigger correctly forces
`is_published` back to `false` at the database layer whenever a row would
otherwise stand published with `promptpay_verified_at is null` — closing the
CRITICAL/HIGH findings that a merchant editing a live store's PromptPay
identifier (`savePromptPaySettings`) left it published with no verified
payee, and that a direct PostgREST call could bypass the Server Action's own
check entirely. But `savePromptPaySettings`'s result type
(`SavePromptPayResult` — `{ ok, promptpayId, promptpayType,
promptpayVerifiedAt }`) does not report `is_published` at all, so neither
the Server Action's caller nor `PaymentsSettingsForm` can tell a store just
went offline as a side effect of an ordinary identifier edit. A merchant who
fixes a typo in their PromptPay number, without re-verifying in the same
submission, gets silently auto-unpublished with zero visible signal
anywhere in the product — they keep seeing "บันทึกแล้ว" and have no reason
to suspect they've stopped taking orders.

**Decision:** Not built now. This needs its own WBS-shaped follow-up with
real `docs/design/state_matrix.md` copy before any engineer touches the UI,
per the design precedence rules (`CLAUDE.md`: state matrix outranks the
prototype and the WBS entry's own description; copy is never invented
in-line by an implementer). A follow-up entry should:

- Have `savePromptPaySettings` select `is_published` in its `RETURNING`
  clause (`supabase-js`'s `.update(...).select(...)` returns the row's
  final post-trigger state for free — no extra query needed) and add it to
  `SavePromptPayResult` so the action can report whether the store was just
  auto-unpublished by this write.
- Add a `state_matrix.md` entry for a visible banner/toast in
  `/console/settings/payments` (and possibly the store profile / dashboard
  screens, if a merchant needs to notice this outside the payments screen)
  with exact Thai copy for "your store just went offline because the
  PromptPay identifier changed and hasn't been re-verified yet" — distinct
  from the existing `SAVE_SUCCESS` ("บันทึกแล้ว") copy, since silently
  reusing a generic success message is exactly the failure mode being
  closed.
- Consider whether the same signal belongs on `/console/settings/store`'s
  publish toggle (GAP-5) for the case where the store was already
  unpublished for this reason before the merchant navigates there.

**Owner:** M1 (state_matrix copy), M2 (UI once copy exists).

**Blocks:** Nothing currently scheduled — the trigger itself is safe and
complete without this; this gap is about merchant-visible feedback, not
correctness or a red line.

---

## GAP-8 — Customer order tracking (`/o/{code}`, `/track`) — undocumented in the state matrix, not missing

**Status:** Exists and is complete in the delivered package. `screen_inventory.md`
already listed both routes and named five/two states respectively (active,
collected, cancelled, expired, not-found / default, not-found), but only
three of the seven had ever been extracted into `state_matrix.md` — the same
category of gap as GAP-1 and GAP-5, just spanning two screens instead of one.

- **Implementation:** `design/customer-web.js`, `scOrder()` (lines 114-121)
  and `scFind()` (lines 123-128).
- **Newly extracted:** the in-progress 4-step progress default state, the
  collected thank-you card, and the entire `/track` lookup screen (intro
  line, two required fields, inline not-found error, submit label).
- **Two states added with no prototype equivalent at all** (the demo's
  `S.dev.track` switcher only ever models an order already past payment):
  pending-payment and refunded. See `state_matrix.md`'s own entries for the
  reasoning on each.

**Decision:** Documented, not rebuilt. Added to `docs/design/state_matrix.md`
by reading `design/customer-web.js` directly, in the same change (WBS 5.10)
that needed it.

**Owner:** M2.

**Blocks:** Nothing. Closed by this same change.

---

## GAP-9 — Customer-facing cancellation reason and refund timing unavailable until WBS 5.11

**Status:** Real, scheduled gap. `state_matrix.md`'s original "Cancelled"
entry for `/o/{code}` (transcribed from the prototype) names a specific
cancellation reason (`เหตุผลจากร้าน: วัตถุดิบหมด`) and a refund-timeframe
line (`เงินจะคืนเข้าบัญชีเดิมภายใน 3–5 วันทำการ`). Neither is buildable today:
`orders` carries no cancellation-reason column at all, and while
`orders.refund_status` exists (`packages/db/migrations/0011_orders.sql`,
written by `transition_order` — WBS 5.7), `public_order_status`/
`public_order_lookup` (`packages/db/migrations/0021_rls.sql`) do not return
it. Both are WBS 5.11's job (Order Cancellation and Merchant-Initiated
Refund), not started this session.

**Decision:** WBS 5.10 (customer order tracking) ships the `/o/{code}`
Cancelled state title-only (`ร้านยกเลิกออเดอร์นี้`), deliberately never
guessing at a reason or a refund claim that isn't backed by real data — the
same posture `CLAUDE.md` takes on cost (`null`, never a guessed `0`). This is
a genuine, if narrow, product regression versus the prototype's fuller copy
until WBS 5.11 lands, and is flagged here rather than silently shipped as
"working as designed."

**Follow-up required, owned by `architect` (not to be done unprompted by the
`engineer` leg of a future entry):** WBS 5.11 needs to (a) add the
cancellation-reason column its own Claude Code Prompt already describes, and
(b) decide whether/how `public_order_status`/`public_order_lookup` should
widen to expose it plus `refund_status` — a change to an existing
security-definer RPC's public contract, which is schema design, not screen
work. Once that lands, `state_matrix.md`'s Cancelled entry needs its own
follow-up edit restoring the reason/refund-timeframe lines, gated correctly
on `refund_status` (never claiming a refund is coming for an order that
never took payment).

**Owner:** M1 (architect — RPC contract), M2 (state_matrix copy + screen once
the data exists).

**Blocks:** Nothing currently scheduled beyond WBS 5.11 itself.

---

## GAP-10 — Subscription screen (`แผนการใช้งาน`) — state matrix corrected, not just documented

**Status:** Same category of miss as GAP-1 and GAP-5 (a complete prototype
screen absent from `P5 Handoff.md`'s extraction into `state_matrix.md`), but
this one shipped as a wrong build first, not just missing documentation.
`state_matrix.md`'s original "แผนการใช้งาน" section stated flatly that this
screen "does not exist in the delivered prototype at all" and authored a
feature-comparison-matrix-table layout from scratch. That claim was wrong:
`design/console-setup.js` has a complete `scPlan()` function (line 117,
registered in `SCREENS`/`SETUP`) implementing this screen as a 4-card
pricing grid (`PLANS`, `.oc-plans`). WBS 4.7 was implemented against the
incorrect state-matrix copy before this was caught.

**Decision:** Per explicit product-owner override (2026-08-23), rebuilt to
the prototype's card design. The internal `merchants.subscription_tier`
enum (`free`/`starter`/`growth`/`scale`) was deliberately left unchanged —
this is a display-layer-only change — and mapped by position onto the
prototype's 4 `PLANS` cards. `state_matrix.md`'s "แผนการใช้งาน" section is
rewritten to describe the card layout actually implemented, including the
tier-name display mapping table, rather than the withdrawn feature-matrix
description. RL-1's fee-disclosure sentence and RL-2's "sale never gated"
statement — both real product requirements the original (wrong) state-matrix
section correctly captured, and which the prototype's own simpler mockup
does not contain — are preserved on the rebuilt screen rather than lost in
the swap to the prototype's copy.

**Owner:** M2 (screen + copy).

**Blocks:** Nothing further. Closed by this same change (WBS 4.7 rebuild).

---

## Adherence lint follow-up (not a screen gap, recorded here for visibility)

`_ds/.../_adherence.oxlintrc.json` cannot be executed by the installed
`oxlint` today — see `/design/README.md`'s "Adherence lint" section for the
full finding. Tracked as a manual follow-up: port the config's `rules`
block into a real ESLint flat-config once `packages/ui` exists (WBS 2.2).
Owner: M2. Blocks: nothing currently; should be closed before relying on
`pnpm lint:adherence` for any CI gate.
