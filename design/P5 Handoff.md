# BrewLedger — Handoff Package

Prototypes in this project:

| File | Covers |
|---|---|
| `P0 Foundation.html` | Tokens, semantic colour, Thai type, money rules, nav shells, component states |
| `Customer Web.html` | Customer ordering web (7 screens) |
| `Owner Console.html` | Console core loop (login, dashboard, orders, detail, quick sale, notifications) |
| `Console Setup.html` | Store profile, menu, item editor + recipe, payments, link/QR, notifications, plan |
| `Console Reports.html` | Bill capture, bill review, inventory, P&L, profit-per-dish, period comparison |

Every prototype has a hidden state switcher: press **D**.

Shared stylesheet: `brewledger-tokens.css` (layers on the Brewledger design system tokens at `_ds/brewledger-design-system-07c182af-9b93-4f42-a3da-2adf1d189891/`).

---

## 1. Screen Inventory

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
| `/console/reports/pnl` | กำไรขาดทุน | Console | Yes | Date stepper, 5 lines, absorbed fee, 7-day sparkline | — | default, partial-tracked, all-untracked |
| `/console/reports/profit-per-dish` | กำไรต่อเมนู | Console | Yes | Insight line, table sorted by total profit, untracked section, period selector | — | default, insight-hidden, all-untracked |
| `/console/reports/overview` | เปรียบเทียบ | Console | Yes | MoM metrics w/ delta, 12-month bars, fee breakdown | — | default, incomplete-month, zero-baseline |

---

## 2. State Matrix

Five states per data-backed screen, with the exact Thai copy.

### เมนูร้าน `/s/{slug}`
- **Default** — store card + grouped items.
- **Loading** — skeleton rows, no text.
- **Empty** — `ร้านนี้ยังไม่ได้เพิ่มเมนู` / `ลองกลับมาใหม่อีกครั้ง หรือสอบถามที่เคาน์เตอร์ได้เลย`
- **Error** — `ตอนนี้เปิดหน้านี้ไม่ได้ ลองใหม่อีกครั้ง`
- **Closed** — `ตอนนี้ร้านปิดอยู่` / `ดูเมนูได้ตามปกติ สั่งได้อีกครั้ง พรุ่งนี้ 07:00`; items disabled, cart bar reads `สั่งได้อีกครั้ง พรุ่งนี้ 07:00`.
- **Slots full** — `ช่วงเวลารับวันนี้เต็มแล้ว` / `สั่งล่วงหน้าสำหรับ พรุ่งนี้ 07:00 ได้ที่หน้าถัดไป`

### เลือกเวลารับ `/checkout`
- **Default** — slots grouped by hour; `เหลือ N ที่` when ≤2 remain.
- **Slot taken while typing** — `ช่วงเวลา 08:15 เพิ่งเต็มพอดี` / `รายการเวลาด้านล่างอัปเดตให้แล้ว เลือกเวลาใหม่ได้เลย`
- **All full** — `วันนี้เต็มทุกช่วงเวลาแล้ว`
- **Validation** — name required; CTA disabled until a slot is chosen.

### ชำระเงิน `/pay`
- **Waiting** — `ระบบกำลังรอการชำระเงิน · หมดเวลาใน MM:SS`
- **Returned from bank app** — `กำลังตรวจสอบการชำระเงิน` / `ถ้าโอนแล้ว ไม่ต้องปิดหน้านี้ ระบบจะอัปเดตให้เองภายในไม่กี่วินาที`
- **Expired** — `QR หมดเวลาแล้ว` / `ยังไม่มีการตัดเงิน ขอรหัสใหม่แล้วชำระได้ตามปกติ` + `ขอ QR ใหม่`

### ติดตามออเดอร์ `/o/{code}`
- **Cancelled** — `ร้านยกเลิกออเดอร์นี้` / `เหตุผลจากร้าน: วัตถุดิบหมด` / `เงินจะคืนเข้าบัญชีเดิมภายใน 3–5 วันทำการ`
- **Expired** — `หมดเวลาชำระเงิน` / `ออเดอร์นี้ถูกยกเลิกเพราะไม่ได้ชำระเงินภายในเวลาที่กำหนด ยังไม่มีการตัดเงิน`
- **Not found** — `ไม่พบออเดอร์นี้` / `ตรวจสอบรหัสอีกครั้ง หรือค้นหาด้วยเบอร์โทรที่ใช้สั่ง` (never reveals whether the code format was valid)

### หน้าหลัก `/console` — **the state most pilot shops are in**
- **No cost data** — revenue + order count render normally; กำไรสุทธิวันนี้ renders `—` with plain grey text beneath: `ยังไม่ได้บันทึกต้นทุน จึงยังคำนวณกำไรไม่ได้`. Not amber, no icon, no button.
- **Partial** — profit computed from tracked items + `คำนวณจาก 8 จาก 12 รายการที่มีข้อมูลต้นทุน`
- **Empty** — no orders → order card shows 0/0/0; brief hidden if nothing to say (never `ทุกอย่างเรียบร้อย`).
- **Loading** — four skeleton metric cards.

### ออเดอร์ `/console/orders`
- **Empty** — `ยังไม่มีออเดอร์วันนี้` / `ลูกค้าสั่งผ่านลิงก์ร้านของคุณได้เลย` + `ดูลิงก์ร้าน`
- **New orders** — persistent banner `มีออเดอร์ใหม่ N รายการ` + `รับทราบ`; each unseen card keeps a 6px left border until opened.

### แก้ไขรายการ `/console/menu/{id}`
- **Recipe collapsed** — header `สูตร (ใส่ทีหลังได้)`. Saving without opening succeeds instantly: no warning, dialog, banner, toast, badge, or asterisk.
- **Recipe suggested** — `มีสูตรมาตรฐานสำหรับรายการนี้อยู่แล้ว ใช้แล้วปรับตัวเลขให้ตรงกับร้านคุณได้เลย` + `ใช้สูตรนี้แล้วแก้ได้`
- **Recipe editing** — live `ต้นทุนต่อแก้ว` beneath the rows.
- **Forbidden copy anywhere on this screen:** ยังไม่ได้ใส่ / ควรใส่ / กรุณาใส่ / ไม่ครบ / ยังขาด.

### การรับเงิน `/console/settings/payments`
- **Pending KYC** — `ระหว่างรอตรวจสอบเอกสาร` / `ขายหน้าร้านด้วยเงินสดได้เต็มรูปแบบตามปกติ มีเพียงการสั่งล่วงหน้าผ่านลิงก์ที่ยังปิดอยู่ ผู้ให้บริการชำระเงินมักใช้เวลา 1–2 วันทำการ`
- **Tested** — `เชื่อมต่อสำเร็จ` / `เงินจะเข้าบัญชีชื่อ ส. สมใจ พาณิชย์ ธนาคารกสิกรไทย ลงท้าย 4821`
- **Always** — `เลขบัญชีธนาคารของคุณอยู่กับผู้ให้บริการชำระเงินเท่านั้น BrewLedger ไม่เก็บและไม่เห็นเลขบัญชีของคุณ`

### สแกนบิล `/console/expenses/capture`
- **Processing** — `กำลังอ่านบิล...` / `ใบแรกของวันอาจใช้เวลาถึง 1 นาที ระบบต้องปลุกเครื่องอ่านก่อน` + elapsed MM:SS + `ไปทำอย่างอื่นก่อนได้` (navigation away must not cancel the job).
- **Framing hint** — `วางบิลให้เต็มกรอบ หลีกเลี่ยงเงาและแสงสะท้อน`
- `กรอกเอง` is visible at all times, never behind a menu.

### ตรวจบิล `/console/expenses/{id}/review`
- **Low confidence field** — amber border + `!` icon + `ตัวเลขอาจอ่านไม่ชัด ตรวจอีกครั้ง`; first in focus order.
- **High confidence** — plain, no re-verification affordance.
- **Before confirm** — `นมสด: ต้นทุนเปลี่ยนจาก 42 เป็น 45 บาท/ลิตร กระทบ 6 เมนู`
- **Manual entry** — same component, no image column, no confidence styling.

### คลังวัตถุดิบ `/console/inventory`
- **Low stock** — `นมสด เหลือพอราว 1.5 วัน` (informational, never `คำเตือน!`).
- **Negative** — `น่าจะยังไม่ได้บันทึกบิลซื้อ`; never blocks a sale.
- **Empty** — `ยังไม่มีวัตถุดิบในระบบ` / `ส่วนนี้ไม่จำเป็นต้องใช้ก็ขายได้ตามปกติ เปิดใช้เมื่อไหร่ก็ได้ที่สะดวก` — no button to go add recipes.

### กำไรขาดทุน `/console/reports/pnl`
- **Partial** — `หมายเหตุ: 12 จาก 47 รายการยังไม่มีข้อมูลต้นทุน (คิดเป็นยอดขาย 540 บาท) กำไรที่แสดงจึงคำนวณจากรายการที่มีข้อมูลเท่านั้น` — plain text, always visible, never a tooltip, never red.
- **All untracked** — revenue and expenses normal; กำไรสุทธิ `—`; note reads `ยอดขายและค่าใช้จ่ายแสดงตามจริง ส่วนกำไรสุทธิจึงยังคำนวณไม่ได้`.
- **Absorbed fee** — `ค่าธรรมเนียม (BrewLedger ออกให้): 45 บาท`, displayed but not subtracted from merchant profit.

### กำไรต่อเมนู `/console/reports/profit-per-dish`
- **Insight (only when best-seller ≠ top profit contributor)** — `ขายดีที่สุดคือ อเมริกาโน่ (210 แก้ว) แต่กำไรรวมสูงสุดคือ ลาเต้เย็น (3,240 บาท)`
- **Untracked section** — `ยังไม่มีข้อมูลต้นทุน (5 รายการ)`; units and revenue shown, cost/profit `—`; never hidden, never sorted as zero.

### เปรียบเทียบ `/console/reports/overview`
- **Incomplete month** — `เทียบ 1–16 ส.ค. กับ 1–16 ก.ค.` / `เดือนนี้ยังไม่จบ ตัวเลขจึงเทียบเฉพาะช่วงวันเท่ากันของทั้งสองเดือน`
- **Zero baseline** — delta renders `—` with `เดือนก่อนไม่มียอด จึงเทียบเป็นเปอร์เซ็นต์ไม่ได้`. Never Infinity, NaN, or 100%.

---

## 3. Interaction Spec

**Real-time (server push / poll):**
- New orders → console inbox and nav badge. Push when permission granted; **poll every 10s while the tab is open when denied** — this is the primary path for iPhone users, not a fallback nicety.
- Order status → customer tracking screen updates without reload.
- Item availability → customer menu updates; an item that goes unavailable while in a cart is flagged at checkout, not silently removed.
- Slot capacity → re-fetched on entering `/checkout`, and revalidated on submit (see slot-taken state).

**Optimistic with rollback:**
- Order status buttons (`เริ่มทำ` / `พร้อมรับ` / `รับแล้ว`) apply immediately; on failure the badge reverts and a persistent inline message appears. Never a vanishing toast.
- Menu availability toggle.
- Quick-sale tile taps (local until `รับเงินสด`).

**Requires confirmation:**
- Cancel order → reason picker (ของหมด / เครื่องเสีย / ลูกค้าขอยกเลิก / ร้านปิดกะทันหัน / อื่นๆ) → confirm sheet → refund state. Two steps, both dismissible.
- Confirm bill → **no cost is written until this tap.**
- Nothing else confirms. Saving a menu item without a recipe never confirms.

**Timeouts and countdowns:**
| Thing | Duration | On expiry |
|---|---|---|
| Payment QR | 15 min | Order → หมดเวลา, no charge, `ขอ QR ใหม่` |
| OTP resend lock | 60 s | Resend button enables |
| Quick-sale undo | 2 min | Undo control replaced by `หมดเวลายกเลิก` |
| Bill OCR first-of-day | ~60 s expected | Elapsed counter, job continues if user navigates away |
| New-order poll (denied perms) | every 10 s | — |

**Non-standard tap targets:**
- Order status buttons: **56px min height, full width** (`--tap-wet`).
- Quick-sale tiles: 104px min, hot items 128px and double-width.
- Everything else: 44px min (`--tap-min`).
- Long-press on a quick-sale tile opens options; tap adds one.

**Identical-error rule:** wrong OTP and unknown phone number return the same message — `รหัสไม่ถูกต้อง กรุณาลองใหม่`. Order lookup returns the same not-found message regardless of whether the phone number exists.

---

## 4. Component Inventory

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

---

## 5. Rules that do not bend

1. **Unknown is `—`, never 0.** Showing 0 for an unknown cost implies a 100% margin.
2. **The recipe block never nags.** No validation, no badge, no forbidden phrases.
3. **Customer web never renders cost data** — including its loading and error states.
4. **56px targets, wet hands, three-second glances** for every console action in the daily loop.
