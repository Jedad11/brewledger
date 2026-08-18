# Design Coverage — F01–F29 vs. Prototype

Cross-references the Requirement Index in `BrewLedger_WBS_Dictionary.md`
(repo root, "🧩 Requirement Index (MVP feature IDs)") against
`/docs/design/screen_inventory.md`. Every feature is either mapped to a
prototype screen or marked Partial/N with a reason — none are silently
dropped.

**Covered? legend:** `Y` — a screen (or set of screens) fully represents the
feature's user-facing surface. `Partial` — some screens exist but a
materially expected UI element is missing or the feature is entirely a
backend mechanism the prototype cannot demonstrate. `N` — no covering screen.

| Feature ID | Feature | Prototype screen | Prototype file | Covered? |
|---|---|---|---|---|
| F01 | Reach store via link or QR — no install, no signup | `/s/{slug}`; merchant-side `/console/settings/link` (issues the link/QR) | `Customer Web.html`; `Console Setup.html` | Y |
| F02 | Menu listing with option groups (hot/cold, sweetness) | `/s/{slug}`, `/s/{slug}#item` | `Customer Web.html` | Y |
| F03 | Pick-up time-slot selection, system-opened slots only | `/checkout` | `Customer Web.html` | Y |
| F04 | PromptPay QR generated locally, payable to the merchant's own alias | `/pay` | `Customer Web.html` | Y |
| F05 | Merchant confirms payment → order enters queue (idempotent) | `/console/orders`, `/console/orders/{id}` | `Owner Console.html` | Partial — `OrderStatusBadge` has an `unpaid` state and the order log shows a `ชำระเงินแล้ว` entry, but no seed order is ever shown in `unpaid` status and no interactive "confirm payment" control exists anywhere in `owner-console.js` (`NEXT` only maps `accepted→making→ready→collected`). The explicit confirm tap this feature depends on is not represented in the delivered prototype. |
| F06 | Real-time / polled order status display | `/o/{code}` | `Customer Web.html` | Y |
| F07 | Status lookup by phone number or order code, no login | `/track` | `Customer Web.html` | Y |
| F08 | Merchant login and identity verification via phone OTP | `/console/login` | `Owner Console.html` | Y |
| F09 | Store name, pick-up address, open/close hours | `/console/settings/store` | `Console Setup.html` | Y |
| F10 | Menu and price creation with no forced BOM | `/console/menu`, `/console/menu/{id}` (recipe-collapsed state) | `Console Setup.html` | Y |
| F11 | Merchant PromptPay setup with self-verification | `/console/settings/payments` | `Console Setup.html` | Y |
| F12 | Subscription tier management and feature gating | `/console/settings/subscription` | `Console Setup.html` | Partial — tier comparison and selection are shown (`PLANS`, `data-plan`), but no screen or state demonstrates a feature actually being gated/locked by tier; that half of the feature has no prototype counterpart. |
| F13 | AI Brief — what to buy / prep before opening | `/console` (`no-brief` state hides it rather than showing a hollow success message) | `Owner Console.html` | Y |
| F14 | Dashboard: today's sales, net profit, expenses, order count | `/console` | `Owner Console.html` | Y |
| F15 | Cost Drift Alert with affected-menu impact | `/console/expenses/{id}/review`, "before confirm" state (`นมสด: ต้นทุนเปลี่ยนจาก 42 เป็น 45 บาท/ลิตร กระทบ 6 เมนู`) | `Console Reports.html` | Y — represented inline in the bill-confirm summary rather than as a separate standalone alert screen; content matches the feature (changed cost + affected-menu count). |
| F16 | Low stock alert based on real usage rate | `/console/inventory`, low-stock state | `Console Reports.html` | Y |
| F17 | New paid order notification (Web Push + polling fallback) | `/console/orders` new-orders banner; notification permission states | `Owner Console.html` | Y |
| F18 | Per-slot order quota and automatic close when full | `/checkout`, `SlotPicker` with `remaining`, all-slots-full state | `Customer Web.html` | Y |
| F19 | Order status update propagating to the customer | `/console/orders/{id}` (`StatusButton`) → `/o/{code}` | `Owner Console.html`; `Customer Web.html` | Y |
| F20 | Cancel / reject order with automatic refund | `/console/orders/{id}` cancel + reason picker; `/o/{code}` cancelled state | `Owner Console.html`; `Customer Web.html` | Y |
| F21 | Manual cash sale entry | `/console/sales/quick` | `Owner Console.html` | Y |
| F22 | Bill photo capture or upload in-browser | `/console/expenses/capture` | `Console Reports.html` | Y |
| F23 | OCR extraction of item / qty / price with confirm-or-edit step | `/console/expenses/{id}/review` | `Console Reports.html` | Y |
| F24 | Automatic ingredient unit-cost update and per-cup profit recompute | Bill review confirm summary; `/console/menu/{id}` live `ต้นทุนต่อแก้ว`; `/console/inventory` unit cost; `/console/reports/profit-per-dish` | `Console Reports.html`; `Console Setup.html` | Y — the automation itself is backend, but every user-facing surface of its result (changed cost, live cost-per-cup, updated per-dish profit) has a screen. |
| F25 | Automatic stock deduction by recipe with unit conversion | `/console/inventory` (resulting stock levels, days-of-cover, negative-stock state) | `Console Reports.html` | Partial — the *result* of deduction is shown as static stock levels, but no screen exhibits the deduction event itself (no per-movement view, e.g. "−40 g used by order SJ-4821"). The GAP-1 ledger (see `gaps.md`) covers cash movements, not stock movements — a stock ledger view is not in this design package. |
| F26 | Suggested standard BOM the merchant edits rather than authors | `/console/menu/{id}`, recipe-suggested state | `Console Setup.html` | Y |
| F27 | Daily P&L | `/console/reports/pnl` | `Console Reports.html` | Y |
| F28 | Profit per Dish, ranked by profit | `/console/reports/profit-per-dish` | `Console Reports.html` | Y |
| F29 | Monthly / yearly comparison with gateway fee breakdown | `/console/reports/overview` | `Console Reports.html` | Y |

## Summary

- **Y:** 24 / 29
- **Partial:** 5 / 29 — F05 (no payment-confirm control in the prototype), F12 (no feature-gating demonstration), F25 (no stock-movement view)
- **N:** 0 / 29

None of the Partial items block implementation — WBS entries 5.6 (payment
confirmation), 4.8 (tier gating), and 6.8 (stock deduction) define the
missing behavior at the API/logic level; an engineer implementing those
entries should treat the *absence* of a matching screen as intentional
(state it plainly, per the "no state matrix entry → note the gap rather
than inventing one" rule) rather than inferring a UI from the feature
description. All three are recorded as decisions in `/docs/design/gaps.md`.
