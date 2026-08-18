# Screen Inventory

Extracted from `/design/P5 Handoff.md` §1, plus GAP-1 (see
`/docs/design/gaps.md`). This is a reference copy — the source of record is
`/design/P5 Handoff.md`; if the two ever disagree, treat that as a bug in
this file and fix it here, never by editing `/design/`.

| Route | Screen | Surface | Auth | Primary features | Links to | States |
|---|---|---|---|---|---|---|
| `/s/{slug}` | เมนูร้าน | Customer | No | Store header, grouped menu, availability, sticky cart bar | options sheet, `/cart` | default, closed, slots-full, no-menu, loading |
| `/s/{slug}#item` | ตัวเลือกรายการ (sheet) | Customer | No | Temp/sweetness options, qty stepper, live price | `/cart` | default |
| `/cart` | ตะกร้า | Customer | No | Line edit, qty, remove, total | `/checkout`, menu | default, empty |
| `/checkout` | เลือกเวลารับ | Customer | No | Slot picker with remaining capacity, name (required), phone (optional), summary | `/pay` | default, slot-taken-while-typing, all-slots-full |
| `/pay` | ชำระเงิน | Customer | No | Large amount, QR, order code, 15-min countdown | `/o/{code}` | waiting, returned-from-bank (checking), expired, confirmed |
| `/o/{code}` | ติดตามออเดอร์ | Customer | No | 4-step progress, pickup time, items (no cost) | `/s/{slug}` | active, collected, cancelled, expired, not-found |
| `/track` | ค้นหาออเดอร์ | Customer | No | Phone + code lookup | `/o/{code}` | default, not-found |
| `/console/login` | เข้าสู่ระบบ | Console | — | Phone → 6-box OTP, 60s resend lock | `/console` | phone, otp, error |
| `/console` | หน้าหลัก | Console | Yes | AI brief, 4 metrics, next 3 slots, quick actions | orders, quick, capture | default, no-recipe, partial-recipe, no-orders, no-brief, loading |
| `/console/orders` | ออเดอร์ | Console | Yes | Grouped by slot, status buttons (56px), bulk slot action, unseen marker | detail | default, empty, new-orders-banner |
| `/console/orders/{id}` | รายละเอียดออเดอร์ | Console | Yes | Status advance, call customer, status log, cancel w/ reason | orders | default, cancelled/refunding |
| `/console/sales/quick` | ขายหน้าร้าน | Console | Yes | Tile grid (hot items 2×), running total, last 5 sales + 2-min undo | — | default, empty cart, undo-expired |
| `/console/settings/notifications` | การแจ้งเตือน | Console | Yes | Permission states, polling fallback, iPhone guidance | — | not-asked, granted, denied |
| `/console/settings/store` | ข้อมูลร้าน | Console | Yes | Name, address, hours, slug w/ live URL, published toggle, 3-step strip | link | default, unpublished |
| `/console/menu` | เมนู | Console | Yes | Rows w/ photo, price, availability toggle, reorder | item editor | default, empty |
| `/console/menu/{id}` | แก้ไขรายการ | Console | Yes | Name, price, save, photo, description, options, collapsed recipe | menu | new, edit, recipe-collapsed, recipe-suggested, recipe-editing |
| `/console/settings/payments` | การรับเงิน | Console | Yes | Merchant ID, test connection, custody disclosure | — | linked, pending-KYC, not-linked, tested |
| `/console/settings/link` | ลิงก์และ QR | Console | Yes | QR, URL, copy/PNG/A5/A6, print sheet preview | store | published, unpublished |
| `/console/settings/subscription` | แพ็กเกจ | Console | Yes | Current plan, 4-tier comparison, upgrade list, fee status | — | default |
| `/console/expenses/capture` | สแกนบิล | Console | Yes | Camera, gallery, permanent manual link, framing hint | review | idle, capturing, processing (elapsed) |
| `/console/expenses/{id}/review` | ตรวจบิล | Console | Yes | Image + fields side-by-side ≥768px, confidence styling, change summary | inventory | ocr-review, manual-entry |
| `/console/inventory` | คลังวัตถุดิบ | Console | Yes | Human-unit cost, stock, days of cover, negative stock | — | default, low-stock, negative, empty |
| `/console/transactions` | รายการเดินบัญชี **(GAP-1 — see gaps.md)** | Console | Yes | Daily/monthly ledger toggle, income/expense/net summary bar, 6 row types, links to source record | order detail, bill review | default, วันที่ไม่มีรายการ, กำลังโหลด, วันที่มีแต่เงินสด (variant) |
| `/console/reports/pnl` | กำไรขาดทุน | Console | Yes | Date stepper, 5 lines, absorbed fee, 7-day sparkline | — | default, partial-tracked, all-untracked |
| `/console/reports/profit-per-dish` | กำไรต่อเมนู | Console | Yes | Insight line, table sorted by total profit, untracked section, period selector | — | default, insight-hidden, all-untracked |
| `/console/reports/overview` | เปรียบเทียบ | Console | Yes | MoM metrics w/ delta, 12-month bars, fee breakdown | — | default, incomplete-month, zero-baseline |

## Reconciliation against prototype `TABS`/`SCREENS` maps

Verified by reading the `TABS`/`SCREENS` (or equivalent) constant in each
prototype's `.js` file and matching every key to a row above.

| Prototype file | Screen keys found | Reconciled |
|---|---|---|
| `owner-console.js` | login, dash, orders, order detail, quick, notifications | Y — all present above |
| `console-setup.js` | store, menu, menu item, payments, link, subscription | Y — all present above |
| `console-reports.js` | capture, review, inventory, **ledger**, pnl, dish, overview | Y — `ledger` was missing from `P5 Handoff.md`; this is GAP-1, now added above |
| `customer-web.js` | menu (`/s/{slug}`), item sheet, cart, checkout, pay, track order, track lookup | Y — all present above |

No other undocumented screen keys were found.
