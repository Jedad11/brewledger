# BrewLedger — Claude Design Prompts
*Prompt set for building the interactive prototype that Claude Code will read to continue development*

---

## How to use this file

This is a RESPONSIVE WEBSITE built with Next.js, not a native mobile app.
Do not use iOS/Android patterns such as status bars, safe areas, native tab bars,
or platform-specific gestures. Navigation is standard HTML rendered in a mobile browser.

**Do not paste everything at once.** 25 screens in a single instruction produces shallow output on every screen. Paste one block at a time, in this order:

| Order | Prompt | Produces | Why this sequence |
|---|---|---|---|
| 1 | **P0 — Foundation** | Design tokens, navigation shell, responsive rules | Everything downstream references this |
| 2 | **P1 — Customer Web** | 7 customer-facing screens | Fewest screens, highest risk — validate early |
| 3 | **P2 — Console: Core Loop** | 6 screens (login, dashboard, orders, cash sale) | The flow the shop uses every single day |
| 4 | **P3 — Console: Setup** | 6 screens (menu, store, payments, link, subscription) | The onboarding path |
| 5 | **P4 — Console: Money** | 6 screens (OCR, inventory, 3 reports) | Most complex — do last |
| 6 | **P5 — Handoff** | Spec documents + state matrix | This is what Claude Code actually reads |

**Before you start:** paste your existing design system into Claude Design first, then paste P0.

**Note on language:** all prompts are written in English, but every UI string inside the product must be **Thai**. The prompts specify the exact Thai copy where it matters. Never let the prototype ship English placeholder text or Lorem Ipsum.

---

## P0 — Foundation, Navigation Shell and Responsive Rules

```
Build an interactive prototype for BrewLedger — a web app for independent coffee shops in
Thailand (pre-order pickup + per-cup unit costing).

## Context that drives every design decision

The merchant: a coffee shop owner working alone. She is simultaneously barista, cashier,
buyer, and bookkeeper. She uses this on her phone, with wet hands, between two customers,
looking at the screen for about three seconds at a time.

The customer: a stranger who scanned a QR code taped to the counter. No account, installs
nothing, is standing on a street, and closes the tab at the first moment of confusion.

This is a **responsive website**, not a native app. No App Store, no install step. Design
mobile-first at 375px and scale up — do not design for desktop and shrink down.

## System structure — two surfaces that never share anything

Two completely separate surfaces that **must not share navigation or layout**:

**A. Customer Web** (7 screens) — no login, no account, reached via /s/{store-slug}
**B. Owner Console** (18 screens) — phone OTP login, sees cost, profit, stock data

⚠️ HARD DESIGN RULE: **Customer-facing screens must never display cost, profit, margin,
expenses, stock levels, or store-wide totals** in any form, including in loading or error
states. The customer is a stranger holding a public link; cost data is the merchant's
competitive information.

## What to build in THIS prompt (no real screens yet)

### 1. Design tokens
Use the design system provided above as the base, then add project-specific tokens:
- Semantic colours: revenue (positive), cost (negative), profit, warning, unknown-value
- 8 order statuses, each with its own colour and Thai label:
  รอชำระเงิน / รับออเดอร์แล้ว / กำลังทำ / พร้อมรับ / รับแล้ว / ยกเลิก / คืนเงินแล้ว / หมดเวลา
- Tap targets: 44px minimum everywhere, **56px for buttons the merchant taps with wet
  hands** (order status buttons and quick cash sale tiles)

### 2. Thai typography — get this right from the start
Thai has no inter-word spaces and stacks diacritics two levels above and below the baseline.
- Minimum line-height 1.5 for body, 1.35 for headings — noticeably looser than an
  English-first system
- Test every screen with a 40-character Thai menu name, e.g.
  "ลาเต้เย็นหวานน้อยพิเศษเพิ่มช็อต" — no vowel marks or tone marks may be clipped
- Never use Lorem Ipsum anywhere. Always use real Thai copy.

### 3. Breakpoints and per-surface behaviour
- 375px (mobile) — the design baseline
- 768px (tablet)
- 1280px (desktop)

Customer Web: effectively mobile-only. At 768px+ constrain content width to roughly 480px
and centre it — do not stretch to fill. Nobody orders coffee on a desktop.

Owner Console: mobile is primary, but the owner will open reports on a laptop after close.
At 1280px switch from bottom navigation to a sidebar, and let tables show more columns.

### 4. Navigation shell — design both

**Customer Web — no navbar at all**
The customer walks a straight line: menu → cart → pick a time → pay → track.
Use a thin header showing only the store name and a back control.
The cart is a sticky bottom bar showing cup count and total; tapping it opens the cart.
Do not add navigation that invites browsing — every detour is a chance to close the tab.

**Owner Console — 5-slot bottom nav (mobile) / sidebar (desktop)**
1. หน้าหลัก (dashboard)
2. ออเดอร์ (orders) ← carries a count badge for unseen new orders
3. ขายหน้าร้าน (quick cash sale) ← centre slot, visually dominant, because it is the most
   frequent and most time-critical action
4. รายงาน (reports)
5. ตั้งค่า (settings)

The new-order badge must persist until the merchant opens the screen. It must not be a
toast that disappears while she is steaming milk.

### 5. Component states — all of them, on every component
default / hover / press / focus / disabled / loading / error / empty

**Empty states matter more than usual here.** A new shop sees empty states first, and that
is their first impression of the product. Design them deliberately, never as an afterthought.

### 6. Money display rules — critical
- Display in baht, e.g. "45.50" or "฿45.50" (stored as integer satang behind the scenes)
- **An unknown value renders as "—" (em dash). Never 0, never 0.00, never ฿0.**
  A shop that has not entered recipes will see "—" in cost and profit columns. That is
  correct. Rendering 0 would imply a 100% margin, which is the most dangerous wrong number
  this product could show.
- Create a `MoneyValue` component that accepts null and renders "—" for it.

Build P0 completely, then wait for the next instruction before creating real screens.
```

---

## P1 — Customer Web (7 screens)

```
Continuing from P0 — build all 7 Customer Web screens and wire the flow so it is clickable.

User: a stranger who scanned a QR code at the counter. No account. Standing on a street.
Goal: from opening the menu to reaching the payment QR in **6 taps or fewer**, with zero
signup.

⚠️ Reminder of the hard rule: no screen in this section may contain cost, profit, margin,
stock, or store-wide sales figures.

---

### 1. `/s/{slug}` — Store menu (the entry point for everything)

**Displays:** store name, open/closed status, pickup address, opening hours.
Menu grouped by category. Each item: photo / name / short description / price.

**Can do:** scroll the menu, tap an item to open the options sheet, tap the cart.

**Five states that must all be designed:**
- Normal (open, has menu items)
- Currently closed → menu still browsable, ordering disabled, next opening time shown
- Some items sold out → render greyed with a "หมดชั่วคราว" label. **Do not hide them.**
  A regular who cannot find their usual drink is more confused than one who sees it is out.
- Store has no menu items yet → a polite empty state
- All of today's slots are full → menu still browsable + clear message + offer tomorrow

**Sticky bottom bar:** appears when the cart is non-empty. Shows "2 แก้ว · ฿110" and a
button to the cart.

---

### 2. Item Options Sheet (bottom sheet over the menu)

**Displays:** large photo, name, description, base price.
Option groups, e.g. "ร้อน/เย็น/ปั่น" (single-select) and "ระดับความหวาน" (single-select).
Options with a price delta show "+10"; options with no delta show nothing.

**Can do:** select options, adjust quantity with a stepper, add to cart.
Sticky footer inside the sheet shows the live line total.

---

### 3. `/s/{slug}/cart` — Cart

**Displays:** each line with name, chosen options, quantity, line total. Grand total.
**Can do:** change quantity, remove a line, go back to add more, proceed.
**Empty state:** empty cart + a button back to the menu.

---

### 4. `/s/{slug}/checkout` — Pick-up time and name

**Displays:** available pick-up time slots grouped by hour. Name field (required) and phone
field (optional). Order summary and total shown once more before payment.

**Can do:** select a slot, fill in name/phone, proceed to payment.

⚠️ **The detail that must be right:** a full slot must be **absent from the list entirely**.
Do not show it greyed and unselectable, and never let it be selected and then rejected on
submit. Slots with 1–2 places left show a soft signal: "เหลือ 1 ที่".

**Special state:** the selected slot fills up while the customer is typing their name →
show an explanatory message and refresh the slot list. This is a recoverable state, not a
red error.

---

### 5. `/s/{slug}/pay/{code}` — PromptPay QR (the most fragile screen in the flow)

Context: the customer switches to a banking app and comes back. This is where people
drop off.

**Displays:**
- The amount, **very large, very high contrast** (this screen gets read in direct sunlight)
- A large QR code with a generous quiet zone
- The order code as selectable text (in case they need to tell the shop)
- A live countdown to expiry
- One short line of instruction: scan with your banking app

**States:**
- Waiting for payment (default) — with a line saying the system is watching for it
- Returned from the banking app — must show an immediate "checking" state, not a stale screen
- QR expired — replace the QR with a message and a single button: "ขอ QR ใหม่"
- Payment confirmed — auto-navigate to the tracking screen

---

### 6. `/o/{code}` — Order tracking

**Displays:** order code, a 4-step progress indicator
(รับออเดอร์ → กำลังทำ → พร้อมรับ → รับแล้ว), pick-up time, and the ordered items
(name and quantity only — no cost anywhere).

**Terminal states, all designed:**
- Collected → thank-you message + link back to the store menu
- Cancelled by the shop → explain the reason + refund timeframe (never use the word "error")
- Payment window expired → explain + link to order again
- Order not found → a neutral message that does not hint whether the code format was valid

---

### 7. `/track` — Find an order (for use on a different device)

**Displays:** phone number field + order code field. Both are required.
**Can do:** search → go to the tracking screen.
**Empty/error state:** not found — a neutral message that does not reveal whether that phone
number has any orders.

---

## Flow wiring (make it genuinely clickable in the prototype)

```
Scan QR / open link
   ↓
[1] Menu ⟷ [2] Options sheet
   ↓ (tap sticky bar)
[3] Cart
   ↓
[4] Slot + name
   ↓
[5] QR screen ──(expires)──> request new QR → back to [5]
   ↓ (paid)
[6] Order tracking ←── [7] /track (entered from another device)
```

Wire the whole path so it can be clicked through. Add a hidden control for switching between
every special state (closed / slots full / QR expired / order cancelled) so Claude Code can
see all of them.
```

---

## P2 — Owner Console: Core Loop (6 screens)

```
Continuing from P1 — build the Owner Console screens the shop uses every day.

User: a shop owner working alone. Wet hands. Three-second glances. Between two customers.
Principle: big buttons, big numbers, few words, decidable without reading.

---

### 1. `/console/login` — Phone OTP sign-in

Two steps: enter phone number → enter 6-digit OTP.
- OTP input as 6 separate boxes with auto-advance and paste support
- "Resend code" disabled behind a visible 60-second countdown
- The error message must be identical for a wrong code and an unknown number

---

### 2. `/console` — Dashboard (opened every morning)

**AI Brief at the very top** — 2–3 lines telling the merchant what to prepare today:
"พรุ่งนี้จองแล้ว 14 แก้ว ช่วง 08:00-08:30 แน่นสุด"
"นมสดเหลือพอราว 1 วัน ซื้อเพิ่มก่อนเปิดร้าน"

⚠️ If there is nothing worth saying, **hide the entire block**. Never render
"ทุกอย่างเรียบร้อย" or any filler — padding this region teaches the merchant to ignore it
on the day it actually matters.

**Four metric cards**, in this priority order:
ยอดขายวันนี้ / กำไรสุทธิวันนี้ / ค่าใช้จ่ายวันนี้ / ออเดอร์ (split: waiting / preparing / ready)

⚠️ **The most important state to design — a shop that has never entered a recipe:**
- Revenue and order count render normally
- **Net profit renders as "—"** with one plain line of text beneath the card:
  "ยังไม่ได้บันทึกต้นทุน จึงยังคำนวณกำไรไม่ได้"
- That line must be **plain grey text. Not amber. No warning icon. Not a button prompting
  them to add recipes.** It is information, not a fault on the merchant's part.
- Partial case (some items have costs, some do not): show the profit computed from tracked
  items plus a note: "คำนวณจาก 8 จาก 12 รายการที่มีข้อมูลต้นทุน"

**Below:** the next 3 pick-up slots with their booked counts.
**Quick action row:** ออเดอร์ / ขายหน้าร้าน / สแกนบิล — three large buttons.

---

### 3. `/console/orders` — Order inbox

**Displays:** grouped by pick-up slot, nearest slot pinned at the top.
Each order card: order code / customer name / pick-up time / items with options and
quantities / total / current status / the next action button.

**Status buttons — minimum 56px tall, full width.**
Show only the single valid next action:
รับออเดอร์แล้ว → [เริ่มทำ] → กำลังทำ → [พร้อมรับ] → พร้อมรับ → [รับแล้ว]
Cancel is a secondary, lower-contrast control and requires confirmation.

**Unseen new orders:** must carry a **persistent** marker — for example a thick coloured
left border — not a toast that vanishes while she is steaming milk.

**Also:** a "ทำเสร็จทั้งช่วงเวลานี้" bulk action for a whole slot.
**Empty state:** no orders yet today + a link to view their own store link.

---

### 4. `/console/orders/{id}` — Order detail

**Displays:** everything on the card, plus the status change history with timestamps and the
customer's phone number if provided.
**Can do:** change status, call the customer, cancel the order.

**Cancel flow:** tap cancel → pick a reason from a preset list (ของหมด / เครื่องเสีย /
ลูกค้าขอยกเลิก / ร้านปิดกะทันหัน / อื่นๆ) → confirm → show refund-in-progress state.

---

### 5. `/console/sales/quick` — Walk-in cash sale (must be the fastest screen in the product)

Context: most revenue at a Thai independent cafe still arrives as cash at the counter.
Without this screen the profit report is wrong, and the merchant stops trusting every number
the product shows.

**Displays:** a grid of menu tiles, most-sold items first and larger.
A running total bar at the bottom with one large confirm button.

**Can do:** tap a tile = add one. Tap again = add another. Long press = choose options.
Target: a three-item sale completed in under 15 seconds.

**Bottom strip:** the last 5 cash sales with an undo control, active for 2 minutes.

---

### 6. Notification patterns (not a screen, but must be designed)

- Count badge on the "ออเดอร์" nav slot
- A persistent new-order banner that stays until acknowledged
- Notification permission states: not yet asked / granted / denied
- ⚠️ **The denied state needs its own design:** show that the system is still checking every
  10 seconds while the tab is open. Web Push is unreliable on iPhone, so the fallback is not
  a nicety — it is the primary path for a large share of users.
- iPhone guidance: the site must be added to the home screen before notifications can work
```

---

## P3 — Owner Console: Setup and Onboarding (6 screens)

```
Continuing from P2 — build the setup and onboarding screens.

⚠️ Measurable goal: a merchant who has never seen this product reaches a published store
link that can accept a real order **within 15 minutes, unaided**.
15 minutes is the length of a genuine lull between customers, which is the only moment this
user will try new software.

---

### 1. `/console/settings/store` — Store profile

**Fields (exactly these — do not add more):** store name / pickup address / opening time /
closing time / public link slug / published toggle.

- The slug is auto-generated from the Thai store name via transliteration. Editable, never
  blank.
- Show a live preview of the real URL beneath the field.
- The published toggle needs Thai microcopy explaining exactly what happens when it is on.
  Do not use the word "public" without explaining it.

**Onboarding progress strip at the top — exactly 3 steps:**
1. Store profile  2. At least one menu item  3. Payment method linked

⚠️ **No step about recipes or ingredients may appear in this strip.** Ever.

---

### 2. `/console/menu` — Menu list

**Displays:** all menu items. Each row: photo / name / price / availability toggle.
**Can do:** add an item, edit, reorder, toggle availability.
**Empty state:** no items yet + a prominent "add your first item" button.

---

### 3. `/console/menu/{id}` — Menu item editor (get this wrong and the whole product fails)

**Required fields: name and price. Nothing else is required.**

Order top to bottom:
1. Item name (required)
2. Price (required)
3. **Save button** ← here, before anything else
4. Photo (optional)
5. Description (optional)
6. Option groups, e.g. hot/iced (optional)
7. **Recipe block — collapsed, at the very bottom**

⚠️⚠️ **The recipe block — rules that may not be violated:**
- Collapsed by default. Header reads "สูตร (ใส่ทีหลังได้)".
- **Zero validation.** Saving without ever opening it must succeed instantly: no warning, no
  confirmation dialog, no amber banner, no toast, no badge, no asterisk.
- **No copy anywhere on this screen may imply the merchant is incomplete.** Forbidden Thai
  phrases: ยังไม่ได้ใส่ / ควรใส่ / กรุณาใส่ / ไม่ครบ / ยังขาด
- With no recipe, cost renders as "—", never 0.

Why: every competitor gates unit costing behind mandatory recipe entry, and that gate is
precisely why a one-person coffee shop never adopts costing. Removing it is this product's
entire differentiation.

**When the block is opened:** offer a standard recipe matched from the item name (e.g. latte
= 18g beans + 200ml milk) for the merchant to **edit**, not author from scratch. The accept
button reads "ใช้สูตรนี้แล้วแก้ได้". Below it, show the computed cost per cup updating live.

---

### 4. `/console/settings/payments` — Link a payment method

**Displays:** link status (not linked / pending verification / linked).
A field for the merchant ID from the payment provider.
A "test connection" button that shows which account the money will land in, so the merchant
can see it with their own eyes.

⚠️ Include Thai copy stating that **the bank account number stays with the payment provider;
BrewLedger never stores it and never sees it.** This is both a trust matter and a legal one.

**Pending-KYC state:** explain that while waiting, the shop can still use walk-in cash sales
fully — only pre-ordering is switched off.

---

### 5. `/console/settings/link` — Store link and QR

**Displays:** a large QR preview, the URL as selectable text.
**Can do:** copy the link, download PNG, download a print-ready PDF (A5 and A6).

**Print layout:** store name large at the top / QR centred at ≥60% of sheet width / the URL
printed as readable text beneath (some customers will type it) / a Thai call to action.
⚠️ The BrewLedger mark must always be smaller than the shop's own name — this sheet belongs
on the merchant's counter, not to us.

**State:** unpublished store → QR greyed out with an explanation and a link to publish.

---

### 6. `/console/settings/subscription` — Plan

**Displays:** current plan, a 4-tier comparison table, what upgrading unlocks.
A fee status line: "ค่าธรรมเนียมช่วงทดลอง: BrewLedger ออกให้"
```

---

## P4 — Owner Console: Money and Reports (6 screens)

```
Continuing from P3 — build the costing and reporting screens. These are the most complex.

⚠️ Rules that apply to every screen in this group: **unknown values render as "—", never 0**,
and a shop that has never entered a recipe must be able to use every one of these screens
without breakage and without being nagged.

---

### 1. `/console/expenses/capture` — Photograph a supplier bill

Real context: the merchant is photographing a crumpled thermal receipt on a stainless steel
counter under fluorescent light, one-handed.

**Displays:** a large camera button, a "choose from gallery" option, and a **permanently
visible "กรอกเอง" (enter manually) link**.
A framing guide during capture plus a Thai hint:
"วางบิลให้เต็มกรอบ หลีกเลี่ยงเงาและแสงสะท้อน"

⚠️ **The processing state must tell the truth.**
The backend runs on a free service that sleeps when idle, so the first bill of the day
genuinely takes about a minute.
→ Do not use a bare spinner that reads as frozen.
→ Show "กำลังอ่านบิล... ใบแรกของวันอาจใช้เวลาถึง 1 นาที" with an elapsed counter.
→ The merchant must be able to navigate away and come back.

---

### 2. `/console/expenses/{id}/review` — Review and confirm a bill

Principle: the system **must not** write any cost until a human confirms.
A single misread digit (250 read as 2500) corrupts the cost of every menu item using that
ingredient, and the merchant discovers it as a profit number she cannot explain. That is
unrecoverable trust damage.

**Layout:** mobile = bill image on top (pinch-zoom, tap to expand) with fields below.
Tablet and up = side by side. She must be able to read the actual receipt while correcting
a value — never make her remember it.

**Fields:** vendor / date / line items (name, quantity, unit, unit price, line total).

**Confidence-driven treatment:**
- Low-confidence fields → amber border + small icon + **first in focus order**
- High-confidence fields → render plainly. Do not make her re-verify what the system got
  right, or she will stop using the feature entirely.

**Before confirming:** a plain Thai summary of what will change:
"นมสด: ต้นทุนเปลี่ยนจาก 42 เป็น 45 บาท/ลิตร กระทบ 6 เมนู"

**This screen doubles as the manual entry form** (no image, no confidence styling) — one
component, two entry points.

---

### 3. `/console/inventory` — Ingredients and stock

**Displays:** ingredient rows with name / unit cost in human units (show "45 บาท/กก."
not "4.5 สตางค์/กรัม") / current stock / last purchase date / low-stock signal.

**Low stock must be expressed in days of cover, not just quantity.** Two litres of milk is a
week for one shop and two hours for another. Copy: "นมสด เหลือพอราว 1.5 วัน" — informational
tone, not "คำเตือน!".

**Negative stock:** allowed, never blocks a sale. Copy: "น่าจะยังไม่ได้บันทึกบิลซื้อ"
(framed as a missing record, not merchant error).

**Empty state:** a shop with no ingredients → explain this section is optional and can be
used whenever they are ready. **No button prompting them to go add recipes.**

---

### 4. `/console/reports/pnl` — Daily profit and loss

**Displays:** date selector with previous/next controls.
Lines: ยอดขาย / ต้นทุนวัตถุดิบ / ค่าธรรมเนียม / ค่าใช้จ่ายอื่น / **กำไรสุทธิ**
A small 7-day sparkline of net profit.

⚠️ **Untracked-items disclosure block — always shown when applicable:**
"หมายเหตุ: 12 จาก 47 รายการยังไม่มีข้อมูลต้นทุน (คิดเป็นยอดขาย 540 บาท)
 กำไรที่แสดงจึงคำนวณจากรายการที่มีข้อมูลเท่านั้น"
→ Plain text. Not hidden in a tooltip. Not red. Not a prompt to add recipes.
→ If every item is untracked: revenue and expenses render normally, net profit renders "—".

**Absorbed gateway fee:** shown as its own line —
"ค่าธรรมเนียม (BrewLedger ออกให้): 45 บาท" — and **not** subtracted from merchant profit,
but still displayed so the merchant understands the real cost structure from day one.

---

### 5. `/console/reports/profit-per-dish` — Profit per item (the product's headline KPI)

**Displays:** a table sorted by **total profit contribution** (profit per cup × units sold).
Not by units sold. Not by revenue.

Columns: เมนู / ขายได้ (แก้ว) / ยอดขาย / ต้นทุน / กำไรต่อแก้ว / **กำไรรวม**

⚠️ **The insight line above the table — this single sentence is the product's core value.**
Shown only when the best-selling item differs from the highest profit contributor:
"ขายดีที่สุดคือ อเมริกาโน่ (210 แก้ว) แต่กำไรรวมสูงสุดคือ ลาเต้เย็น (3,240 บาท)"
Give this line distinct visual prominence — no other tool this merchant has access to will
tell her this.

**Untracked items:** placed in a separate section below the ranked list, headed neutrally:
"ยังไม่มีข้อมูลต้นทุน (5 รายการ)". Units sold and revenue still shown (those are known);
cost and profit render "—". Never hide these rows, never sort them as zero.

**Period selector:** วันนี้ / 7 วัน / 30 วัน / กำหนดเอง

---

### 6. `/console/reports/overview` — Period comparison

**Displays:** this month vs last month. Each metric shows current value, absolute change, and
percentage change with a direction arrow. A 12-month bar chart of revenue and profit that
must remain readable at 375px.

⚠️ **Incomplete current month:** state the comparison explicitly —
"เทียบ 1-16 ก.ย. กับ 1-16 ส.ค." Comparing 16 days against a full 31-day month produces a
frightening, meaningless number.
⚠️ **Zero baseline:** render "—". Never Infinity, NaN, or 100%.

**Fee breakdown block:** all three lines — paid by the shop / covered by BrewLedger / total.
```

---

## P5 — Handoff Package for Claude Code

```
Continuing from P4 — produce the handoff documents Claude Code will use to build this.

Everything created so far will be read by an AI writing the implementation, not only by
humans reviewing visuals. It therefore needs documentation covering what images cannot say.

Produce these four artefacts:

### 1. Screen Inventory
A table of every screen: Route | Screen name | Surface | Auth required | Primary features |
Links to | All states

### 2. State Matrix
For every data-backed screen, specify all five states with the **real Thai copy** used in
each: default / loading / empty / error / screen-specific state.

⚠️ Give particular attention to the "shop with no cost data" state on every screen that
displays money. This is the state most pilot merchants will actually be in.

### 3. Interaction Spec — behaviour that static screens cannot express
Specify:
- What updates in real time (new orders / order status / item availability)
- What uses optimistic update with rollback on failure (order status buttons)
- What requires confirmation before acting (cancel order / confirm bill)
- Every timeout and countdown (QR 15 min / OTP resend 60s / cash sale undo 2 min)
- Any tap target that deviates from the standard (56px order status buttons)

### 4. Component Inventory
List every reused component with the props it must accept:
- MoneyValue (accepts null → renders "—")
- OrderStatusBadge (8 statuses)
- OrderCard (used in both the inbox and the detail screen)
- SlotPicker
- ConfidenceField (input with a confidence level — used in bill review)
- EmptyState (used on every data-backed screen)
- UntrackedDisclosure (the untracked-items note — used on 3 screens)

Export everything as markdown that Claude Code can read, with links to each prototype screen.
```

---

## Notes before you begin

**Four things this prompt set deliberately repeats** — these are the points that break most
easily and cost the most to fix later:

1. **"—" not 0** — appears in P0, P2, and P4. If the design shows 0 when cost is unknown, it
   implies a 100% margin, which is the most dangerous wrong number in the product.
2. **The recipe block must never nag** — spelled out in detail in P3, including a list of
   forbidden Thai phrases. This is the single thing that differentiates the product from
   every competitor.
3. **Customer Web never sees cost data** — in P0 and P1. One leak permanently loses a pilot
   store.
4. **56px targets and wet hands** — the real usage context is very different from a designer
   working at a desk.

**If Claude Design cannot complete a block in one pass**, split P1–P4 further into groups of
2–3 screens. Three well-considered screens beat seven shallow ones.
