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

## Adherence lint follow-up (not a screen gap, recorded here for visibility)

`_ds/.../_adherence.oxlintrc.json` cannot be executed by the installed
`oxlint` today — see `/design/README.md`'s "Adherence lint" section for the
full finding. Tracked as a manual follow-up: port the config's `rules`
block into a real ESLint flat-config once `packages/ui` exists (WBS 2.2).
Owner: M2. Blocks: nothing currently; should be closed before relying on
`pnpm lint:adherence` for any CI gate.
