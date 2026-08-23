# State Matrix

Extracted from `/design/P5 Handoff.md` §2, plus GAP-1 (see
`/docs/design/gaps.md`). Exact Thai copy per state — cite this file, not a
screenshot of a prototype, when implementing a screen. Reference copy; source
of record is `/design/P5 Handoff.md`.

### เมนูร้าน `/s/{slug}`
- **Default** — store card + grouped items.
- **Loading** — skeleton rows, no text.
- **Empty** — `ร้านนี้ยังไม่ได้เพิ่มเมนู` / `ลองกลับมาใหม่อีกครั้ง หรือสอบถามที่เคาน์เตอร์ได้เลย`
- **Error** — `ตอนนี้เปิดหน้านี้ไม่ได้ ลองใหม่อีกครั้ง`
- **Closed** — `ตอนนี้ร้านปิดอยู่` / `ดูเมนูได้ตามปกติ สั่งได้อีกครั้ง พรุ่งนี้ 07:00`; items disabled, cart bar reads `สั่งได้อีกครั้ง พรุ่งนี้ 07:00`.
- **Slots full** — `ช่วงเวลารับวันนี้เต็มแล้ว` / `สั่งล่วงหน้าสำหรับ พรุ่งนี้ 07:00 ได้ที่หน้าถัดไป`
- **Not found / unpublished** (authored for the real implementation — WBS
  5.1. The delivered prototype's dev switcher has no equivalent state; a
  stranger reaching a bad or since-unpublished `/s/{slug}` link is a case
  the prototype never modelled, same "genuinely reachable, not previously
  extracted" reasoning as WBS 4.4's "No store yet" state above) —
  `ไม่พบร้านนี้` / `ลิงก์อาจไม่ถูกต้อง หรือร้านนี้ยังไม่เปิดให้บริการ`; HTTP 404,
  never distinguishes "never existed" from "unpublished" (same
  non-enumeration posture as `/o/{code}`'s Not found state below).
- **Store open/closed pill** (WBS 5.1, from `customer-web.js`'s own
  `scMenu()` — not previously extracted into this file) — `เปิดอยู่` /
  `ปิดอยู่`, `st st--making` / `st st--expired`.
- **Item temporarily unavailable** (WBS 5.1's own Claude Code Prompt §3, not
  previously extracted into this file — verified verbatim in
  `customer-web.js`'s `scMenu()`) — `หมดชั่วคราว`, shown in place of the
  item's description; the item itself still renders (greyed), never
  disappears. A `hidden` item is the one that disappears — RLS excludes it
  from the response entirely, there is no client-side copy for that case.
- **Opening-hours line** (WBS 5.1; store card, beneath the pickup address) —
  `{opensAt}–{closesAt}` (e.g. `07:00–16:00`), no day-of-week qualifier — the
  schema (`stores.opens_at`/`closes_at`) has no per-weekday column to source
  one from, unlike the prototype's static demo text `(จ.–ส.)`.

### ตัวเลือกรายการ (sheet)

Bottom sheet opened by tapping a menu item on เมนูร้าน (WBS 5.2, not
previously extracted — `customer-web.js`'s `sheet()`, lines 58-66). The
prototype's own demo option groups (`OPTS` in `customer-web.js`) are both
single-select (`ร้อน / เย็น / ปั่น`, `ระดับความหวาน`); WBS 5.2 generalizes the
same markup to a `maxSelect > 1` multi-select group (checkbox-style toggle
instead of radio-style replace) — no prototype reference exists for that
case since the demo data never needed it.

- **Option group heading** — the group's own `name` (e.g. `ร้อน / เย็น / ปั่น`).
- **Option button** — the option's `name`, plus `+{delta}` only when the
  price delta is non-zero (`.cw-opt .num`); selected state is `.cw-opt.is-on`.
- **Quantity** — heading `จำนวน`; stepper buttons `aria-label="ลด"` /
  `aria-label="เพิ่ม"` (verified verbatim in `sheet()`).
- **Footer button** — `ใส่ตะกร้า · {line total}` (`.cw-sheet-foot .btn--primary.btn--wet`),
  disabled until every option group's `minSelect` is satisfied.
- **Back / close** — the shared header back arrow, `aria-label="ย้อนกลับ"`
  (`header()`'s own markup, not previously extracted into this file — reused
  verbatim by the cart page below since no prior WBS entry needed a back
  button). The sheet itself closes via scrim tap (`data-close`) or Escape —
  the Escape handler is new, no prototype equivalent (a11y addition, not a
  visual state).

### ตะกร้า `/s/{slug}/cart`

WBS 5.2, from `customer-web.js`'s `scCart()`, lines 69-75.

- **Default** — line items (`.cw-line`), each showing name, selected option
  labels joined by ` · `, qty stepper, line total, and a `ลบ` remove button;
  a `เพิ่มรายการอีก` link back to the menu; a `รวมทั้งหมด` subtotal card; sticky
  cart bar reading `{cups} แก้ว · {total}` with a `เลือกเวลารับ` proceed button.
- **Empty** — `ตะกร้ายังว่างอยู่` / `เลือกเครื่องดื่มจากเมนูได้เลย` / `กลับไปดูเมนู`
  linking back to `/s/{slug}`.
- **Stale cart at proceed** (WBS 5.2's own Claude Code Prompt §5 — authored
  for the real implementation, no prototype equivalent: the delivered
  prototype has no server re-validation step at all, matching
  `interaction_spec.md`'s own rule that "an item that goes unavailable while
  in a cart is flagged at checkout, not silently removed") —
  `รายการในตะกร้ามีการเปลี่ยนแปลง` / `ตรวจสอบรายการด้านล่างก่อนไปต่อ`, one notice
  per changed line naming what changed:
  - price change — `{name} ราคาเปลี่ยนจาก {old} เป็น {new}`, with `ใช้ราคาใหม่`
    (accept) and `ลบ` (remove) actions.
  - item or option no longer available — `{name} หมดแล้ว ไม่สามารถสั่งได้ในตอนนี้`
    / `{name} ไม่มีให้เลือกแล้ว`, `ลบ` (remove) only — there is no "accept" for
    something that can no longer be sold.
  Resolving every notice (accept or remove) clears the block and proceeds
  automatically; a re-fetch failure shows `ตรวจสอบราคาล่าสุดไม่ได้ ลองใหม่อีกครั้ง`.

### เลือกเวลารับ `/checkout`
- **Default** — slots grouped by hour; `เหลือ N ที่` when ≤2 remain.
- **Slot taken while typing** — `ช่วงเวลา 08:15 เพิ่งเต็มพอดี` / `รายการเวลาด้านล่างอัปเดตให้แล้ว เลือกเวลาใหม่ได้เลย`
- **All full** — `วันนี้เต็มทุกช่วงเวลาแล้ว`
- **Validation** — name required; CTA disabled until a slot is chosen.
- **Phone (WBS 5.4 — copy sourced verbatim from `design/customer-web.js`'s
  `scCheckout()`, not previously extracted into this file)** — label
  `เบอร์โทร` with the trailing tag `ไม่ใส่ก็ได้`; placeholder `08X-XXX-XXXX`;
  never rejects input client-side, no matter how it's shaped — loose
  normalisation happens server-side in `checkout_create_order`, never a
  client-side block.
- **Cart summary (WBS 5.4 — same prototype source, its `สรุปรายการ` card)**
  — heading `สรุปรายการ`, one line per cart line (`{name} × {qty}`), a
  hairline divider, then `รวมทั้งหมด` and the total — identical shape to
  the `/cart` screen's own summary card, just reused at the bottom of this
  one so the customer sees what they're about to pay for one more time
  before choosing a time.
- **Order creation failed (WBS 5.4 — authored for the real implementation;
  the delivered prototype's CTA was a documented no-op stub with nothing to
  fail)** — `สั่งซื้อไม่สำเร็จ ลองใหม่อีกครั้ง`, shown for any
  `public-create-order` outcome that isn't a 409 price-mismatch (which gets
  its own diff notices, reusing `/cart`'s existing diff UI) or a 410
  slot-full (which reuses this screen's own existing "slot taken" notice).

### ชำระเงิน `/pay`
- **Waiting** — `ระบบกำลังรอการชำระเงิน · หมดเวลาใน MM:SS`
- **Returned from bank app** — `กำลังตรวจสอบการชำระเงิน` / `ถ้าโอนแล้ว ไม่ต้องปิดหน้านี้ ระบบจะอัปเดตให้เองภายในไม่กี่วินาที`
- **Expired** — `QR หมดเวลาแล้ว` / `ยังไม่มีการตัดเงิน ขอรหัสใหม่แล้วชำระได้ตามปกติ` + `ขอ QR ใหม่`

### ติดตามออเดอร์ `/o/{code}`

`screen_inventory.md`'s own route table already named five states here
(active, collected, cancelled, expired, not-found), but only three had ever
been extracted into this file (WBS 5.10, GAP-8 — see `gaps.md`). The other
two — the in-progress default and the collected thank-you — exist verbatim
in `design/customer-web.js`'s `scOrder()` (lines 114-121) and are extracted
below, not invented. A sixth and seventh state (pending-payment, refunded)
have no prototype equivalent at all — the demo's `S.dev.track` switcher only
ever models an order already past payment — and are authored for the real
implementation, same posture as WBS 5.2's stale-cart state.

- **Default / active** — a card reading `รหัสออเดอร์` with the code, then
  `รับเวลา {HH:mm} น. ที่ {store name}` (the prototype's own line;
  `public_order_status`/`public_order_lookup` return no store name field, so
  the real implementation renders `รับเวลา {HH:mm} น.` only — see WBS 5.10's
  own engineering note). A 4-step horizontal progress list, steps in order
  `รับออเดอร์` / `กำลังทำ` / `พร้อมรับ` / `รับแล้ว` (verbatim, `customer-web.js`
  line 114 — the exact same four strings the WBS 5.10 Claude Code Prompt
  itself quotes), each step showing a checkmark once passed and a highlighted
  ring on the current step. Maps from `orders.status`: `ACCEPTED` → step 0
  current, `PREPARING` → step 1 current, `READY` → step 2 current. Then a
  `รายการที่สั่ง` card listing each item's name and `× {quantity}` — no price,
  matching the RPC's own allow-listed columns.
- **Collected** (`status = COLLECTED`) — same header/progress card as
  Default/active, with all 4 steps shown done, plus a closing card:
  `ขอบคุณที่อุดหนุน` / `แล้วพบกันใหม่` (verbatim, `customer-web.js` line 121).
  The prototype's own closing card also carries a `กลับไปที่เมนูร้าน` button
  (and the WBS 5.10 Claude Code Prompt's own §4 independently asks for "a
  link back to the store menu") — **not built**: that link needs a store
  slug neither `public_order_status` nor `public_order_lookup` returns, and
  `apps/shop`'s own `/` route is a pre-existing unrelated "coming soon"
  placeholder (`apps/shop/src/app/page.tsx`, WBS 3.1/3.4), not a page a
  customer could use — linking there would be worse than no link. Flagged as
  a real, narrow gap the RPC could close later by adding the store slug to
  its column list, same category as GAP-9 below.
- **Pending payment** (`status = PENDING_PAYMENT`, authored — no prototype
  equivalent; reachable when a customer bookmarks or re-visits `/o/{code}`
  before ever completing `/pay`) — `ยังไม่ได้ชำระเงิน` /
  `เปิดลิงก์หรือ QR ที่ได้รับตอนสั่งซื้ออีกครั้งเพื่อชำระเงิน`. No retry link
  is offered — same reasoning as Collected above, this screen doesn't know
  the store slug needed to rebuild a `/pay` URL.
- **Cancelled** (WBS 5.11 — GAP-9 closed; `cancel_reason`/`refund_status`
  now returned by `public_order_status`/`public_order_lookup`,
  `packages/db/migrations/0051_console_cancel_order_refund.sql`) —
  `ร้านยกเลิกออเดอร์นี้`, plus, when `cancelReason` is non-null, a reason
  line `เหตุผลจากร้าน: {label}` (one of the five fixed Thai labels below —
  never the raw code). **The refund-timeframe line
  (`เงินจะคืนเข้าบัญชีเดิมภายใน 3–5 วันทำการ`) renders if and only if
  `refundStatus === 'pending'` — never on `cancelReason`'s mere presence.**
  This is the load-bearing rule the RPC contract itself was widened to
  enforce (`docs/db/wbs_5_11_refund_design.md` §4): a `PENDING_PAYMENT`
  order cancelled before ever paying carries a `cancelReason` (a reason is
  captured for every cancel, regardless of originating status) but
  `refundStatus` stays `null` — nothing was paid, nothing is owed — and
  must render the reason line alone, with no refund claim beneath it.
  Five fixed reason codes and their Thai labels, identical set and order to
  the console's own cancel-reason picker (`interaction_spec.md:18`):
  `out_of_stock` → ของหมด, `equipment_failure` → เครื่องเสีย,
  `customer_request` → ลูกค้าขอยกเลิก, `unexpected_closure` → ร้านปิดกะทันหัน,
  `other` → อื่นๆ.
- **Refunded** (`status = REFUNDED`, `refundStatus = 'done'`; authored —
  no prototype equivalent, since the prototype never modelled a completed
  refund) — `ร้านยกเลิกออเดอร์นี้` / the same reason line as Cancelled above
  (`cancelReason` is never cleared on `CANCELLED → REFUNDED`, WBS 5.11's own
  design decision) / `เงินคืนเข้าบัญชีเดิมเรียบร้อยแล้ว`. The last line is
  safe to state as fact (not a timeframe estimate) because `REFUNDED` is a
  real, already-transitioned `orders.status` value (`transition_order`,
  `packages/db/migrations/0032_order_status_history.sql`) reached only via
  `console_resolve_refund` — reaching this state means a merchant already
  completed the transfer, not a projection.
- **Expired** — `หมดเวลาชำระเงิน` / `ออเดอร์นี้ถูกยกเลิกเพราะไม่ได้ชำระเงินภายในเวลาที่กำหนด ยังไม่มีการตัดเงิน`
- **Not found** — `ไม่พบออเดอร์นี้` / `ตรวจสอบรหัสอีกครั้ง หรือค้นหาด้วยเบอร์โทรที่ใช้สั่ง` (never reveals whether the code format was valid)

### ค้นหาออเดอร์ `/track`

Undocumented in this file until now (WBS 5.10, GAP-8) — `screen_inventory.md`
already listed the route and its two states (default, not-found);
`design/customer-web.js`'s `scFind()` (lines 123-128) is the source, ported
verbatim below.

- **Default** — one-line intro `ใส่เบอร์โทรที่ใช้ตอนสั่ง และรหัสออเดอร์ที่ได้รับ`;
  two required fields, `เบอร์โทร` (placeholder `08X-XXX-XXXX`) and
  `รหัสออเดอร์` (placeholder `SJ-0000`); submit button `ค้นหา`. Both fields
  are required to submit — there is no client-side path that calls the
  lookup RPC with only one of the two filled in, the same non-enumeration
  posture `public_order_lookup` itself enforces server-side.
- **Not found** — inline `.err` text beneath the fields, not a full-page
  state: `ไม่พบออเดอร์ที่ตรงกับข้อมูลนี้ ลองตรวจสอบอีกครั้ง`. Deliberately the
  same message whether the phone exists with a different code, the code
  exists with a different phone, or neither exists at all —
  `interaction_spec.md`'s own identical-error rule ("Order lookup returns
  the same not-found message regardless of whether the phone number
  exists") applied here.
- **Success** — navigates to `/o/{code}`; no separate rendered state of its
  own.
- **Rate limited** (authored — no prototype equivalent; the prototype has no
  concept of a request budget) — the lookup RPC is capped at 20 attempts per
  hour per caller IP (`packages/db/migrations/0036_order_lookup_rate_limit.sql`,
  blunting scripted phone+code guessing) — inline `.err` text, same position
  as Not found: `ค้นหาบ่อยเกินไป ลองใหม่อีกครั้งในอีกสักครู่`.

### หน้าหลัก `/console` — **the state most pilot shops are in**
- **No cost data** — revenue + order count render normally; กำไรสุทธิวันนี้ renders `—` with plain grey text beneath: `ยังไม่ได้บันทึกต้นทุน จึงยังคำนวณกำไรไม่ได้`. Not amber, no icon, no button.
- **Partial** — profit computed from tracked items + `คำนวณจาก 8 จาก 12 รายการที่มีข้อมูลต้นทุน`
- **Empty** — no orders → order card shows 0/0/0; brief hidden if nothing to say (never `ทุกอย่างเรียบร้อย`).
- **Loading** — four skeleton metric cards.

### ออเดอร์ `/console/orders`
- **Empty** — `ยังไม่มีออเดอร์วันนี้` / `ลูกค้าสั่งผ่านลิงก์ร้านของคุณได้เลย` + `ดูลิงก์ร้าน`
- **New orders** — persistent banner `มีออเดอร์ใหม่ N รายการ` + `รับทราบ`; each unseen card keeps a 6px left border until opened.
- **Working queue (WBS 5.8 — grouped list, copy verbatim from `design/owner-console.js`'s `scOrders()`/`orderCard()`, not previously extracted into this file)** — orders with status ACCEPTED/PREPARING/READY, grouped into one section per pick-up slot, slots ascending; the nearest slot's heading carries the pill `ใกล้ที่สุด`. Each card shows, in order: order code, customer name, `รับ HH:MM น.`, the status badge (`OrderStatusBadge`), a full item-line list (`.oc-items` — item name, options on the line beneath in `note-plain`, quantity as `× N`), then `{cups} แก้ว` beside the order total (`MoneyValue`). WBS 5.8 itself wires no advance/cancel/open handler on these cards — see `OrderCard`'s own component-inventory entry. **WBS 5.9 wires `onAdvance` (status action button, one of `เริ่มทำ` / `พร้อมรับ` / `รับแล้ว` — only the single legal next action ever renders, verbatim from `design/owner-console.js`'s own `NEXT` map) and `onOpen` (`ดูรายละเอียด`, navigates to `/console/orders/{id}`)** — copy unchanged from what `OrderCard`/`orderCard()` already specify. `onCancel` (`ยกเลิกออเดอร์`) stays unwired on this list card: WBS 5.11 wires
  cancellation only on the order detail screen (`onOpen` already navigates
  there), not a second time on the inbox card itself — a merchant working
  the queue opens `ดูรายละเอียด` to cancel, the same one place the refund
  state (`กำลังคืนเงิน`/`คืนเงินแล้ว`) also lives, rather than duplicating a
  destructive action across two surfaces.
- **Bulk "mark all ready" (WBS 5.9 — copy verbatim from `design/owner-console.js`'s own `scOrders()`, `data-bulk="${t}"` button, confirmed against this entry's own Claude Code Prompt text)** — a `btn--quiet` control in each real slot's group header (no button on a group with no `pickup_slot_id`, e.g. a cash-sale order with no reserved slot), labelled `ทำเสร็จทั้งช่วงเวลานี้`, shown only when the group has at least one ACCEPTED/PREPARING order. Marks every ACCEPTED/PREPARING order in that slot READY, one order at a time (an ACCEPTED order takes two hops — ACCEPTED→PREPARING→READY — a PREPARING order takes one; `transition_order` has no direct ACCEPTED→READY pair, WBS 5.7). On full success, no separate message (the cards' own badges update, same "optimistic, no toast" posture as the single-order button). On partial or total failure — authored, no prototype counterpart (the prototype's own bulk handler is a client-side-only mutation that cannot fail) — a persistent inline message beneath the group header, naming which orders failed: `ทำสำเร็จ {N} ออเดอร์ · ไม่สำเร็จ {M} ออเดอร์ ({order_code, order_code, ...})`, or `ทำรายการไม่สำเร็จทั้งหมด ลองใหม่อีกครั้ง` if the whole request failed outright. Never a vanishing toast.
- **Order detail `/console/orders/{id}` (WBS 5.9 — no counterpart in this file until now; structure and copy sourced from `design/owner-console.js`'s own `scDetail()`, same posture as WBS 4.7/5.3's own authored screens)** — header: `ย้อนกลับ` + order code + `{customer name} · รับ HH:MM น.`. First card: status badge, order total (`MoneyValue`), the full item-line list, `{cups} แก้ว`, then the single legal next-action button if one exists (same three labels as the working queue). Second card `ติดต่อลูกค้า`: customer name + phone number with a `โทรหาลูกค้า` `tel:` link, or `ลูกค้าไม่ได้ให้เบอร์โทร` when no phone was given. Third card `ประวัติสถานะ`: one row per `order_status_history` entry, `HH:MM` beside the Thai label of the status reached (`OrderStatusBadge`'s own label map). On an advance failure, the same persistent inline message as the working queue's own card-level error, never a vanishing toast.
- **Cancel + refund (WBS 5.11 — wires the `ยกเลิกออเดอร์` button and the cancelled/refunded card the prototype's own `scDetail()` always renders, both previously omitted; see this file's own prior note, preserved in git history)** — a full-width `ยกเลิกออเดอร์` (`.btn--danger`) button appears beneath the history card **only** while the order is `ACCEPTED`/`PREPARING`/`READY` (the console UI's own scope for "who may cancel" — `docs/db/wbs_5_11_refund_design.md` §3; the RPC itself accepts a wider set, enforced structurally rather than duplicated as a second UI check). Tapping it opens a two-step, both-dismissible flow (`interaction_spec.md:18`):
  1. **Reason picker sheet** (`.oc-scrim`/`.oc-sheet`, verbatim structure from `design/owner-console.js`'s own `cancelSheet()`) — title `เหตุผลที่ยกเลิก`, five reason pills in a row (same five labels/order as the customer-facing Cancelled entry above), `ต่อไป` (disabled until one is picked) and `ปิด` to dismiss with nothing changed.
  2. **Confirm sheet** — title `ยืนยันการยกเลิก`, body `ออเดอร์ {code} · เหตุผล: {label}` then a corrected line **`ลูกค้าจะได้รับแจ้ง คุณจะต้องโอนเงินคืนให้ลูกค้าเองผ่านแอปธนาคาร`** — **not** the prototype's own `...ระบบจะเริ่มคืนเงินทันที` ("the system will begin the refund immediately"), which described the withdrawn gateway-refund design and now contradicts RL-1 (this system never moves money — WBS 5.11's own Revision note). Corrected here per `CLAUDE.md`'s own precedence rule that a red line beats the prototype, in the same change, rather than shipped verbatim. Buttons `ยืนยันยกเลิก` and `ไม่ยกเลิก`.

  A failed cancel dismisses the sheet and leaves the same persistent inline card-level error the advance button uses — `ยกเลิกออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง`, or `สถานะออเดอร์นี้เปลี่ยนไปแล้ว ลองรีเฟรชหน้าอีกครั้ง` on a 409 (another tab/device already moved this order past the point cancellation is legal) — never a vanishing toast.

  Once cancelled/refunded, the button is replaced by an informational card in the same slot — gated on `refund_status`, never `cancel_reason`'s mere presence (identical rule to the customer-facing Cancelled/Refunded entries above): `refund_status = 'pending'` → `กำลังคืนเงิน` / `เงินจะคืนเข้าบัญชีเดิมของลูกค้าภายใน 3–5 วันทำการ ระบบแจ้งลูกค้าให้แล้ว` (verbatim, `scDetail()`); `refund_status = 'done'` → `คืนเงินแล้ว` / `เงินคืนเข้าบัญชีเดิมเรียบร้อยแล้ว` (authored — the prototype showed the SAME "in progress" card for both cancelled and refunded orders, which is factually wrong once a refund is actually resolved; corrected here rather than carried forward, same posture as the confirm-sheet correction above, though this one is an ordinary accuracy fix, not a red-line conflict). A cancelled order with no refund owed (`refund_status` stays `null` — a `PENDING_PAYMENT` cancel reachable only by direct URL, not from this UI) shows neither card.
- **รอคืนเงิน section (WBS 5.11 — no counterpart in the delivered prototype; copy authored for the real implementation, same posture as WBS 5.6's own `รอยืนยันการชำระเงิน` section immediately above it on this page)** — section header `รอคืนเงิน`, positioned below the working queue (there is no completed-orders list on this page to sit above, so this section renders last). **Persists until every entry is resolved: never collapses by default, never ages out, no dismiss/ignore control** — the only way a row leaves this list is a successful `โอนคืนแล้ว` tap (WBS 5.11 Acceptance: "a cancelled order with an unresolved refund remains visible in the console indefinitely"). Backed by `orders_refund_pending_idx` (`store_id`, `refund_status = 'pending'`, `packages/db/migrations/0051_console_cancel_order_refund.sql`). Each card shows, in this priority: the amount to refund, large (`MoneyValue` `size="lg"`), the customer's phone number with a one-tap `คัดลอกเบอร์โทร`/`คัดลอกแล้ว` copy control (omitted when no phone was given, same as the order-detail contact card), the customer name and order code, how long the refund has been outstanding — `ค้างมา {N} วัน`, counted from the `order_status_history` row where the order reached `CANCELLED` (the moment the obligation began), not from order creation — and a `โอนคืนแล้ว` button (`StatusButton`, ≥56px full width). Helper line beneath, verbatim: `โอนคืนลูกค้าผ่านแอปธนาคารของคุณ แล้วกดยืนยันที่นี่`. A resolve that fails leaves the card in place with a persistent inline message `บันทึกการคืนเงินไม่สำเร็จ ลองใหม่อีกครั้ง`, or `รายการนี้เปลี่ยนไปแล้ว ลองรีเฟรชหน้าอีกครั้ง` on a 409 (another tab/device already resolved it) — never a vanishing toast. Section empty state (only reachable after resolving every row client-side during the same visit — the section itself is omitted from the page entirely when the initial server fetch finds nothing, same pattern as `รอยืนยันการชำระเงิน`): `ไม่มีออเดอร์ที่รอคืนเงิน`.
- **Notification permission (WBS 5.8 — copy verbatim from `design/owner-console.js`'s `scSettings()`, surfaced inline on this screen rather than a separate settings page, since interaction_spec.md requires the polling fallback to run ON this screen regardless of permission state)**:
  - *Not yet asked* — no banner shown; the permission prompt itself is requested silently (native browser dialog) the first time the working queue has at least one order, never on bare page load.
  - *Denied* — inline note `อุปกรณ์นี้ปิดการแจ้งเตือนไว้ ระบบจึงตรวจหาออเดอร์ใหม่ให้ทุก 10 วินาทีขณะเปิดหน้านี้อยู่`.
  - *iOS Safari, not installed to home screen (WBS 5.8 — same `scSettings()` source)* — additional inline hint, never blocking the queue below it: `บน iPhone ต้องเพิ่มเว็บนี้ลงหน้าจอโฮมก่อน การแจ้งเตือนจึงจะทำงานได้ — เปิดเมนูแชร์ แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”`.
- **เสียงแจ้งเตือนออเดอร์ใหม่ mute toggle (WBS 5.8 — no counterpart in `design/owner-console.js`, which only describes the notification *pattern* read-only, not a control; copy authored for the real implementation, same posture as WBS 4.6/4.7's own authored screens)** — `Toggle` labelled `เสียงแจ้งเตือนออเดอร์ใหม่`, description `เสียงและการสั่นเมื่อมีออเดอร์ใหม่เข้ามา`, `checked` = sound ON. Persisted per store; respected by both the audible tone and `navigator.vibrate` on every new-order arrival, including ones that arrived via push while the tab was open.
- **Push notification content (WBS 5.8 — authored for the real implementation; the prototype has no push payload to source from)** — title `มีออเดอร์ใหม่`; body `{order_code} · รับ HH:MM น. · {total}` (reuses the same `รับ HH:MM น.` idiom `OrderCard` already renders); tapping it focuses the existing `/console/orders` tab or opens one.
- **รอยืนยันการชำระเงิน section (WBS 5.6 — no counterpart in the delivered prototype; the licensed-gateway webhook this replaced never needed a merchant-facing pending queue at all. Copy authored for the real implementation, same posture as WBS 4.6/4.7's own screens.)** — section header `รอยืนยันการชำระเงิน`, positioned above the working queue. Each pending card shows, in this priority: the order TOTAL in large type (`MoneyValue` `size="lg"`, the merchant is comparing it against a figure in their own banking app), the customer name, the order code, the pickup slot, and a countdown to `expires_at` rendered `หมดเวลาใน MM:SS` (same idiom already established for `/pay`'s own waiting state above, applied here to the merchant-facing card). Two controls: `ได้รับเงินแล้ว` (primary, `StatusButton`, ≥56px full width) and `ยังไม่ได้รับเงิน` (secondary, `Button` variant `danger`). Tapping the secondary control swaps it in place for one confirmation step, dismissible — same "two steps, both dismissible" posture interaction_spec.md already documents for cancel order — showing `ยืนยันว่ายังไม่ได้รับเงิน ออเดอร์นี้จะถูกยกเลิกและคืนเวลาให้ลูกค้าคนอื่น` with `ยืนยัน` / `ยกเลิก`. A confirm or reject that fails leaves the card in place with a persistent inline message `ยืนยันการชำระเงินไม่สำเร็จ ลองใหม่อีกครั้ง` (confirm) or `ยกเลิกออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง` (reject) — never a vanishing toast, same generic-failure idiom as `requestOtp.ts`. Section empty state: `ไม่มีออเดอร์ที่รอยืนยัน`.

### ขายหน้าร้าน `/console/sales/quick` **(WBS 5.12 — undocumented in the delivered `P5 Handoff.md`, added by reading `design/owner-console.js` directly — same class of gap as GAP-1/GAP-5/GAP-6, logged as GAP-11 in `/docs/design/gaps.md`)**
- **Default** — header `ขายหน้าร้าน` with subtitle `แตะเพื่อเพิ่ม · กดค้างเพื่อเลือกตัวเลือก`. A tile grid (`.oc-tiles`, `QuickSaleTile`) of the store's own menu items, largest/most-sold first; each tile shows name and price, a hot (double-width, 128px) variant for the top slice by recent sales volume. Tapping a tile adds one to a local cart using that item's default option selections (no option groups → no options at all) — purely client-side until the confirm tap (interaction_spec.md: "local until รับเงินสด"). A tile already in the cart shows a quantity badge. Long-pressing a tile with option groups opens a bottom sheet (`.oc-scrim`/`.oc-sheet`, the same option-picker pattern `ItemOptionsSheet` uses on Customer Web, mirrored not imported per the `apps/shop`/`apps/console` boundary), letting the merchant choose a non-default combination for that one add via the same `cw-opt` pill controls, confirmed with an authored `เพิ่ม` button (no prototype counterpart — the long-press handler there is a stub `alert()`). Beneath the grid, a running total: `{N} แก้ว` + the total (`MoneyValue` `role="revenue"`), and one big confirm button `รับเงินสด` (`.oc-total`, sticky, ≥56px full width per CLAUDE.md's tap-target rule for an order-status-adjacent action), disabled while the cart is empty.
- **Empty cart** — the `.oc-total` bar still renders (`0 แก้ว`, total `฿0` — a real, known zero, matching the prototype's own unconditional `money(t,'money--revenue')`; `MoneyValue`'s `null` → `—` path is reserved for an UNKNOWN cost, not a legitimately-empty running total — `รับเงินสด` disabled) rather than being hidden, so the confirm bar's position never jumps as the merchant starts tapping tiles.
- **ขายล่าสุด (recent sales strip)** — a card beneath the tile grid, header `ขายล่าสุด`, showing the last 5 cash sales this session, newest first. Each row: sale time (`HH:MM`), `{N} แก้ว`, the sale total (`MoneyValue` `role="revenue"`), and either an active `ยกเลิก` (undo) button or, once the 2-minute window has passed, the button is REPLACED by the static label `หมดเวลายกเลิก` (not disabled — a swapped-in element, per interaction_spec.md's literal wording and the prototype's own `r.undo?...:'<span>หมดเวลายกเลิก</span>'`). Not shown at all when no sale has been recorded this session.
- **Undo failure (authored — the prototype's own `data-undo` handler is a client-side-only array splice with no failure case to source language from)** — a tapped `ยกเลิก` past the server's own 2-minute window (a stale client clock, or a concurrent change) fails with a persistent inline message on that row, never a vanishing toast, same generic-failure idiom as the rest of this console: `ยกเลิกไม่สำเร็จ ไปที่หน้ารายละเอียดออเดอร์เพื่อยกเลิก` — directs the merchant to `/console/orders/{id}` (WBS 5.11, not yet built) rather than retrying an action the server has already refused.
- **Sale failure (authored)** — a `รับเงินสด` tap that fails (e.g. an item went unavailable or changed price between load and confirm — same `PRICE_MISMATCH` diff vocabulary as checkout) leaves the cart untouched with a persistent inline message: `บันทึกการขายไม่สำเร็จ ลองใหม่อีกครั้ง`.

### เมนู `/console/menu` **(WBS 4.4 — copy sourced verbatim from `console-setup.js`'s `scMenu()`, not previously extracted into this file)**
- **Default** — header `เมนู` with subtitle `{N} รายการ`; rows show photo/placeholder, name, price, and a `พร้อมขาย` availability switch; `เพิ่มรายการ` button beneath the list.
- **Empty** — `ยังไม่มีรายการในเมนู` / `ใส่ชื่อกับราคาก็ขายได้แล้ว ใช้เวลาไม่ถึงหนึ่งนาที` + `เพิ่มรายการแรก`.
- **No store yet** (authored for the real implementation — the delivered prototype's demo state always has a store; a merchant can genuinely reach `/console/menu` before saving a store profile, same blank-state possibility WBS 4.3 already handles on its own screen) — `ตั้งค่าข้อมูลร้านก่อนเพิ่มเมนู` / `กรอกชื่อร้านกับที่อยู่รับสินค้าไว้ก่อน แล้วค่อยกลับมาเพิ่มเมนูได้เลย` + `ไปตั้งค่าข้อมูลร้าน` (links to `/console/settings/store`).
- **Reorder / availability failure** — persistent inline message, never a vanishing toast (interaction_spec.md's general rule for optimistic controls): reuses the same generic-failure idiom as `requestOtp.ts`/the store form's save error, `บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง`.

### แก้ไขรายการ `/console/menu/{id}`
- **Recipe collapsed** — header `สูตร (ใส่ทีหลังได้)`. Saving without opening succeeds instantly: no warning, dialog, banner, toast, badge, or asterisk.
- **Recipe suggested** — `มีสูตรมาตรฐานสำหรับรายการนี้อยู่แล้ว ใช้แล้วปรับตัวเลขให้ตรงกับร้านคุณได้เลย` + `ใช้สูตรนี้แล้วแก้ได้`
- **Recipe suggestion dismissed (WBS 6.7 — no counterpart in the delivered prototype, which never modeled a suggestion at all; copy authored for the real implementation, same posture as this screen's own validation states below)** — a quiet secondary control beside the accept button, `ไม่ใช้สูตรนี้`, one tap, no confirmation sheet (same "nothing else confirms" rule interaction_spec.md states for this screen). Once dismissed, the suggestion never reappears for this item — the block simply shows its plain empty-start copy (`เริ่มจากบรรทัดว่างแล้วใส่วัตถุดิบทีละอย่าง` + `เริ่มใส่สูตรเอง`) exactly as if no suggestion had ever matched.
- **Recipe editing** — live `ต้นทุนต่อแก้ว` beneath the rows (rendered by the console page next to `RecipeBlock`, not inside it — see that component's own header comment). While every line's ingredient has a known cost, this renders a `MoneyValue`. **While any line is incomplete or references an ingredient with no confirmed purchase yet (WBS 6.7)** — `MoneyValue` itself renders `—`, and a plain, neutral note beneath it (never amber, never a warning icon) reads: `ต้นทุนของวัตถุดิบที่ยังไม่มีราคาจะปรากฏเองเมื่อคุณยืนยันบิลซื้อของวัตถุดิบนั้น` — stated as information about what happens next, not as something missing now.
- **Forbidden copy anywhere on this screen:** ยังไม่ได้ใส่ / ควรใส่ / กรุณาใส่ / ไม่ครบ / ยังขาด.
- **Validation** (inline, per field — not modeled in the delivered prototype's `scItem()`, which never validates; authored for the real implementation, same posture as WBS 4.3's own added validation states) — name: `กรอกชื่อรายการ`; price: `กรอกราคา` when blank, `ราคาต้องมากกว่า 0 บาท` when zero or negative.
- **Save success** — `บันทึกแล้ว` (reused verbatim from the store profile screen's own save-success idiom, WBS 4.3).
- **Save error** — `บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง` (same generic-failure idiom as `requestOtp.ts`/WBS 4.3's store form).

### ข้อมูลร้าน `/console/settings/store` **(undocumented in the delivered `P5 Handoff.md`, added by reading `console-setup.js` directly — see `/docs/design/gaps.md` GAP-5)**
- **Default** — onboarding strip (see `OnboardingStrip`, hidden once all 3 steps are done) above a form: ชื่อร้าน / ที่อยู่สำหรับรับสินค้า / เวลาเปิด+เวลาปิด / ลิงก์ร้าน (auto-suggested from the name, editable, never blank). Slug field note beneath the input: `ลูกค้าจะเข้าที่ ` **`brewledger.app/s/{slug}`** ` · ตั้งจากชื่อร้านให้อัตโนมัติ แก้ได้ตามต้องการ`.
- **Publish toggle** — label `เปิดให้ลูกค้าสั่งผ่านลิงก์`; note, always visible beneath it, never only on change: `เมื่อเปิด ใครก็ตามที่มีลิงก์หรือสแกน QR จะเห็นเมนูและสั่งล่วงหน้าได้ · เมื่อปิด ลิงก์จะแจ้งว่ายังไม่เปิดรับออเดอร์ และคุณยังขายหน้าร้านได้ตามปกติ`.
- **Save** — `บันทึก`.
- **Onboarding strip** — exactly 3 steps, never a recipe step: ข้อมูลร้าน / เมนูอย่างน้อย 1 รายการ / เชื่อมช่องทางรับเงิน.
- **Validation** (inline, per field, not in the state matrix's delivered prototype — the prototype's `scStore()` never modeled an invalid state; authored for the real implementation) — name: `กรอกชื่อร้าน`; pick-up address: `กรอกที่อยู่สำหรับรับสินค้า`; opening time: `เลือกเวลาเปิด`; closing time: `เลือกเวลาปิด`.
- **Save success** — `บันทึกแล้ว`.
- **Save error** — `บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง` (same generic-failure idiom as `requestOtp.ts`, WBS 4.1).

### การรับเงิน `/console/settings/payments` **(corrected in WBS 4.5 — see `/docs/design/gaps.md` GAP-6; the two states and copy this section carried before described a licensed-gateway KYC flow that stores a bank account name and branch, which both the WBS 4.5 revision note and RL-1 withdrew before this screen was built)**
- **No store yet** (a merchant can reach this route before saving a store profile, same posture as WBS 4.4's own "No store yet" state for `/console/menu`) — `ตั้งค่าข้อมูลร้านก่อนตั้งค่าการรับเงิน` / `กรอกชื่อร้านกับที่อยู่รับสินค้าไว้ก่อน แล้วค่อยกลับมาตั้งค่าการรับเงินได้เลย` + `ไปตั้งค่าข้อมูลร้าน`.
- **Default** — type selector เบอร์มือถือ / เลขบัตรประชาชน / เลขผู้เสียภาษี; one input, normalised and validated per type; a live QR preview beneath it, regenerated on every valid change, encoding a fixed 1.00 THB amount.
- **Verification instruction, beside the preview, prominent (not a footnote)** — `สแกน QR นี้ด้วยแอปธนาคารของคุณเอง แล้วดูว่าชื่อผู้รับเงินเป็นชื่อคุณถูกต้องหรือไม่ (ยังไม่ต้องกดโอน)`.
- **Preview placeholder (no valid identifier yet)** — `กรอกและตรวจสอบข้อมูลด้านบนให้ถูกต้องก่อน จึงจะแสดง QR ตัวอย่างที่นี่`.
- **Preview render failure** — `แสดง QR ตัวอย่างไม่สำเร็จ ลองใหม่อีกครั้ง` (same generic-failure idiom as elsewhere in the console).
- **Invalid identifier (inline, per type, shown as soon as the field is non-empty — reject early, not on blur/submit, since a typo here sends every future QR to a stranger)** — msisdn: `กรอกเบอร์มือถือ 10 หลัก ขึ้นต้นด้วย 0`; nid, shape: `กรอกเลขบัตรประชาชน 13 หลัก`; nid, failed check digit: `เลขบัตรประชาชนไม่ถูกต้อง ตรวจสอบเลขอีกครั้ง`; taxid: `กรอกเลขผู้เสียภาษี 13 หลัก`.
- **Confirmation** — a checkbox-equivalent toggle, `ฉันสแกนแล้วและยืนยันว่าชื่อผู้รับเงินคือฉัน`, persisted as `promptpay_verified_at`; disabled until the current input normalises successfully; unchecked (and the stored timestamp cleared) automatically the instant the identifier or type is edited, since a prior verification proved the OLD value was the merchant's own, not a new one.
- **Always visible, verbatim, never paraphrased** — `เงินจากลูกค้าโอนเข้าบัญชีพร้อมเพย์ของคุณโดยตรง ไม่ผ่าน BrewLedger` / `เราเก็บแค่เบอร์พร้อมเพย์ไว้สร้าง QR เท่านั้น ไม่เห็นและไม่เก็บเลขบัญชีธนาคารของคุณ` / `ไม่มีค่าธรรมเนียมจากเรา`.
- **Save success** — `บันทึกแล้ว` (reused verbatim from the store profile screen's own save-success idiom, WBS 4.3).
- **Save error** — `บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง` (same generic-failure idiom as `requestOtp.ts`/WBS 4.3's store form).
- **Publish gating (surfaces on `/console/settings/store`, not here)** — a store with no verified PromptPay identifier cannot be published; the store profile screen shows `เชื่อมและยืนยันการรับเงินผ่านพร้อมเพย์ก่อน จึงจะเปิดขายผ่านลิงก์ได้` persistently beneath its publish toggle (never only after a failed save, never by silently disabling the toggle itself) with a link back to this screen.

### ลิงก์ร้านและ QR `/console/settings/link` **(WBS 4.6 — no counterpart in `/design/P5 Handoff.md` §2; this screen does not exist in the delivered prototype at all, unlike GAP-1/GAP-5's undocumented-but-present case. Copy authored for the real implementation, same posture as WBS 4.4's own "No store yet" state)**
- **No store yet** (same posture as WBS 4.4/4.5's own "No store yet" states) — `ตั้งค่าข้อมูลร้านก่อนดูลิงก์และ QR` / `กรอกชื่อร้านกับที่อยู่รับสินค้าไว้ก่อน แล้วค่อยกลับมาดูลิงก์ร้านและ QR ได้เลย` + `ไปตั้งค่าข้อมูลร้าน`.
- **Default (store published)** — live QR preview (encoding exactly `https://brewledger.app/s/{slug}`, RL-3: no other identifier); the URL beneath it as selectable text, labelled `ลิงก์ร้านของคุณ`, with a `คัดลอกลิงก์` button; `ดาวน์โหลด QR (PNG)`; a print-sheet subsection `ใบพิมพ์สำหรับติดหน้าร้าน` with an A5/A6 size choice and `ดาวน์โหลด PDF สำหรับพิมพ์`.
- **Unpublished** — the QR renders greyed out (not a live, clickable-looking image) with `ยังไม่เปิดให้ลูกค้าสั่งผ่านลิงก์นี้` / `เปิดใช้งานที่หน้าข้อมูลร้านก่อน แล้ว QR นี้จะพาลูกค้าไปสั่งได้จริง` + `ไปเปิดใช้งานลิงก์ร้าน` (links to `/console/settings/store`, where the publish toggle lives — GAP-5); copy/download actions are disabled in this state rather than producing a QR that leads to a closed page.
- **Copy confirmation** — inline status text beside the button, `คัดลอกลิงก์แล้ว` (same transient-status idiom as the store/payments screens' `บันทึกแล้ว`, not a floating toast component — none exists in `packages/ui`).
- **Copy failure** — `คัดลอกลิงก์ไม่สำเร็จ ลองใหม่อีกครั้ง` (same generic-failure idiom as `PREVIEW_FAILED_NOTE` on `/console/settings/payments`).
- **QR generation failure** — `สร้าง QR ไม่สำเร็จ ลองใหม่อีกครั้ง` (same idiom).
- **Print PDF generation failure** — `สร้างไฟล์พิมพ์ไม่สำเร็จ ลองใหม่อีกครั้ง` (same idiom).
- **Print sheet contents (A5 and A6, generated client-side)** — store name large at the top; QR centred at ≥60% of sheet width; the URL as readable text beneath the QR; call to action `สแกนสั่งล่วงหน้า รับที่ร้านได้เลย` (verbatim from the WBS 4.6 entry). No BrewLedger wordmark or domain footer on the sheet at all — simplest way to satisfy "no branding larger than the store's own name" is to carry no separate branding element to begin with.

### บันทึกบิลซื้อ `/console/expenses/capture` **(corrected in WBS 6.1 — see Phase 6.0 rescope banner in `BrewLedger_WBS_Dictionary.md`: 6.2/6.3 OCR are deferred, so this section's earlier copy — a processing/elapsed-time wait state and a scan-framing hint, both written for an extraction pipeline — no longer describes a screen that exists. Manual entry was always the fallback this screen kept available (`กรอกเอง`); with OCR deferred it is the only path, so the state below replaces the old ones rather than sitting alongside them. Restore the OCR-era states only if 6.2/6.3 are un-deferred.)**
- **Default (the only state — no processing/waiting state exists, because nothing runs in the background)** — header `บันทึกบิลซื้อ` / `บันทึกต้นทุนจากบิลผู้ขาย` (subtitle reused verbatim from the pre-rescope screen — still accurate, not OCR-specific); a form: `ผู้ขาย` (optional text), `วันที่` (date, defaults to today); a repeatable line-item row — `ชื่อ` / `จำนวน` / `หน่วย` / `ราคาต่อหน่วย (บาท)` + a computed, read-only line total rendered through `MoneyValue`; `เพิ่มรายการ` to add a row, `ลบ` per row; a running `รวมทั้งบิล` total through `MoneyValue`; then an optional photo attachment (`<input capture="environment">`, gallery selection allowed) captioned `แตะเพื่อถ่ายหรือเลือกรูป`, purely a private reference image — no framing hint, since nothing reads the pixels back; `บันทึก` submits directly, no intermediate confirmation screen (that step is WBS 6.4's `/console/expenses/{id}/review`, which this screen redirects to on success).
- **No line items entered** — submit is simply disabled, the same quiet incomplete-form posture as every other console form in this file (RL-2's forbidden-nag list applies here too even though no recipe is involved: no amber warning, no `ยังไม่ได้ใส่`/`กรุณาใส่`-shaped copy for a blank row).
- **Save error** — `บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง` (same generic-failure idiom as the rest of the console).
- **Photo upload failure** — `อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง` (same idiom as `/console/menu/{id}`'s own photo failure copy); the bill itself has already saved by this point, so failure here is reported without discarding the typed line items.

### ตรวจบิล `/console/expenses/{id}/review` **(corrected in WBS 6.4 — see the Phase 6.0 rescope banner in `BrewLedger_WBS_Dictionary.md`: 6.2/6.3 OCR are deferred, so this section's earlier copy — a per-field confidence score, amber/low-confidence styling, confidence-ordered focus, an arithmetic-mismatch banner, all written for an extraction pipeline — no longer describes a screen that exists. Every field on this screen was typed by the merchant in WBS 6.1, not extracted, so there is no confidence to threshold against. The states below replace the old ones rather than sitting alongside them. Restore the OCR-era states only if 6.2/6.3 are un-deferred.)**
- **Default (no image attached)** — header `ตรวจบิล` / `ตรวจสอบและยืนยันบิลซื้อ`; the fields carried over from 6.1's capture screen (`ผู้ขาย`, `วันที่`, each line's `ชื่อ` / `จำนวน` / `หน่วย` / `ราคาต่อหน่วย (บาท)`), all still editable; a per-line `หน่วยซื้อ (สำหรับคำนวณต้นทุน)` selector (kg/g, L/ml, or piece/dozen/pack depending on the mapped ingredient's base unit) drives the base-unit conversion and is new to this screen, not carried from 6.1; a per-line `ผูกกับวัตถุดิบ` selector — `ไม่ผูก (บันทึกเป็นค่าใช้จ่ายทั่วไป)` (the default whenever no exact name match is found — RL-2: never auto-force a mapping), `+ สร้างวัตถุดิบใหม่`, or an existing ingredient (exact name match auto-selected, others offered alphabetically); each line's running total through `MoneyValue`; a running `รวมทั้งบิล` total through `MoneyValue`; `ยืนยัน` commits.
- **With image attached** — the reference photo from 6.1 rendered above the fields (mobile) or beside them (tablet/desktop), captioned `แตะรูปเพื่อดูขยาย`; tapping it opens a full-screen tap-to-close zoomed view. Purely a private reference image, same as 6.1's own capture — nothing reads the pixels back.
- **`+ สร้างวัตถุดิบใหม่` selected** — an inline block appears without leaving the screen: `ชื่อวัตถุดิบใหม่` (prefilled from the line's typed name), `หน่วยพื้นฐาน` toggle (same three-way control as `/console/inventory/{id}`), an optional `จำนวนชิ้นต่อแพ็ค (ถ้าซื้อเป็นแพ็ค, ไม่บังคับ)` when the base unit is `piece`, `สร้างวัตถุดิบ` to commit — the new ingredient is immediately selectable in every other line's own dropdown, with `current_unit_cost_satang` left `NULL` until this invoice (or a later one) is confirmed.
- **Before confirm** — a plain Thai summary per line whose typed cost differs from the ingredient's current cost, e.g. `นมสด: ต้นทุนเปลี่ยนจาก 42 เป็น 45 บาท/ลิตร กระทบ 6 เมนู`; a brand-new ingredient reads `นมสด: ต้นทุนเริ่มต้นที่ 45 บาท/ลิตร`; an unmapped line and a line whose cost is unchanged show no summary at all.
- **Unmapped line** — recorded as a general expense; no ingredient selector state is ever forced, no badge, no warning styling (RL-2).
- **Confirm error** — `ยืนยันไม่สำเร็จ ลองใหม่อีกครั้ง` (same generic-failure idiom as the rest of the console).
- **Confirmed** — the form is replaced by a short summary of what changed (or `บันทึกเป็นค่าใช้จ่ายทั่วไปแล้ว` when nothing was mapped), with `ไปที่คลังวัตถุดิบ` and `บันทึกบิลใหม่` next steps. Reopening this URL after confirming (back button, bookmark) shows a read-only summary of the confirmed invoice, headed `บิลนี้ยืนยันแล้ว` — never the editable form a second time.

### คลังวัตถุดิบ `/console/inventory`
- **Low stock** — `นมสด เหลือพอราว 1.5 วัน` (informational, never `คำเตือน!`).
- **Negative** — `น่าจะยังไม่ได้บันทึกบิลซื้อ`; never blocks a sale.
- **Empty** — `ยังไม่มีวัตถุดิบในระบบ` / `ส่วนนี้ไม่จำเป็นต้องใช้ก็ขายได้ตามปกติ เปิดใช้เมื่อไหร่ก็ได้ที่สะดวก` — no button to go add recipes.

### รายการเดินบัญชี `/console/transactions` **(GAP-1 — undocumented in the delivered `P5 Handoff.md`, added by reading `console-reports.js` directly; see `/docs/design/gaps.md`)**
- **Default** — date selector (`‹ อาทิตย์ 16 ส.ค. 2569 ›`); segmented control รายวัน (default) / รายเดือน.
  - **รายวัน view** — summary bar รับเข้า / จ่ายออก / คงเหลือสุทธิ (net figure rendered largest, class `oc-big`); table columns เวลา / รายการ / ประเภท / จำนวนเงิน; each row carries `data-src="order"` or `data-src="bill"` when it has a source record, opening that record on click/Enter; note beneath the table: `ค่าธรรมเนียมที่ BrewLedger ออกให้ แสดงไว้ให้เห็นโครงสร้างต้นทุนจริง แต่ไม่ได้นับรวมในยอดจ่ายออก`.
  - **รายเดือน view** — columns วันที่ / จำนวนรายการ / รับเข้า / จ่ายออก / คงเหลือ, plus a month total row.
- **วันที่ไม่มีรายการ (empty day)** — `วันนี้ยังไม่มีรายการ` / `รายการจะขึ้นที่นี่เมื่อมีการขายหรือบันทึกบิลซื้อ`.
- **กำลังโหลด (loading)** — 5 skeleton rows, 44px each, no text.
- **วันที่มีแต่เงินสด (cash-only variant)** — same layout as default, but every row in the day is a cash-sale or a cash-funded purchase (no online orders); exercises the summary bar and table with a homogeneous row-type set.
- **Row types (6):** ขายออนไลน์ (`online`) · ขายหน้าร้าน (`cash`) · ซื้อวัตถุดิบ (`buy`) · ค่าธรรมเนียม (`fee`) · ค่าธรรมเนียม (BrewLedger ออกให้) (`feeabs`) · คืนเงิน (`refund`).
- **Absorbed-fee rule:** the `feeabs` row type renders as its own muted row style (`is-abs`) and is **excluded** from จ่ายออก — verified directly in `console-reports.js`: `dayOut = r => r.filter(x => x.amt < 0 && x.k !== 'feeabs').reduce(...)`. It still appears in the row list and is netted into คงเหลือสุทธิ, but never counted as an expense line.

### กำไรขาดทุน `/console/reports/pnl`
- **Partial** — `หมายเหตุ: 12 จาก 47 รายการยังไม่มีข้อมูลต้นทุน (คิดเป็นยอดขาย 540 บาท) กำไรที่แสดงจึงคำนวณจากรายการที่มีข้อมูลเท่านั้น` — plain text, always visible, never a tooltip, never red.
- **All untracked** — revenue and expenses normal; กำไรสุทธิ `—`; note reads `ยอดขายและค่าใช้จ่ายแสดงตามจริง ส่วนกำไรสุทธิจึงยังคำนวณไม่ได้`.
- **No fee line (WBS 7.5 — corrected here).** The delivered prototype (`design/console-reports.js` `scPnl()`) renders an absorbed-fee row (`ค่าธรรมเนียม (BrewLedger ออกให้): 45 บาท`, struck-through, excluded from merchant profit) — this bullet previously described it. WBS 4.8 ("Fee Model Documentation," superseding the earlier gateway-fee-absorption design) removed `merchants.absorb_gateway_fee`, `orders.gateway_fee_satang`, and `orders.fee_borne_by` from the schema and its own Claude Code Prompt explicitly lists "the absorbed-fee line in the WBS 7.5 P&L" among the lines to delete: the MVP uses direct merchant-owned PromptPay, so no per-transaction fee is ever attributable to BrewLedger. The line items on this screen are ยอดขาย / ต้นทุนวัตถุดิบ / ค่าใช้จ่ายอื่น / กำไรสุทธิ — no fee row, on any day, any variant.

### กำไรต่อเมนู `/console/reports/profit-per-dish`
- **Period selector** — chips วันนี้ / 7 วัน / 30 วัน / กำหนดเอง; กำหนดเอง reveals two date fields labelled `จากวันที่` / `ถึงวันที่` (added here — not in the delivered prototype's dev-harness chip, which never implemented an actual custom range).
- **Insight (only when best-seller ≠ top profit contributor)** — `ขายดีที่สุดคือ อเมริกาโน่ (210 แก้ว) แต่กำไรรวมสูงสุดคือ ลาเต้เย็น (3,240 บาท)`
- **Untracked section** — `ยังไม่มีข้อมูลต้นทุน (5 รายการ)`; units and revenue shown, cost/profit `—`; never hidden, never sorted as zero.
- **No sales in period (empty, added here — not in the delivered prototype)** — `ยังไม่มีรายการขายในช่วงนี้` / `ตัวเลขจะขึ้นที่นี่เมื่อมีการขาย`, same body-copy pattern as the ledger's empty-day state (`วันที่ไม่มีรายการ`, line above).

### เปรียบเทียบ `/console/reports/overview`
- **Incomplete month** — `เทียบ 1–16 ส.ค. กับ 1–16 ก.ค.` / `เดือนนี้ยังไม่จบ ตัวเลขจึงเทียบเฉพาะช่วงวันเท่ากันของทั้งสองเดือน`
- **Incomplete year (WBS 7.7 — added here, not in the delivered prototype).** The prototype's `scOverview()` only ever renders the month-comparison copy above; this screen's own selector also offers ปีนี้/ปีที่แล้ว, which needs the same "not yet closed" disclosure with year-appropriate wording — `เทียบ 1 ม.ค.–16 ส.ค. กับ 1 ม.ค.–16 ส.ค. 2568` / `ปีนี้ยังไม่จบ ตัวเลขจึงเทียบเฉพาะช่วงวันเท่ากันของทั้งสองปี`.
- **Zero baseline** — delta renders `—` with `เดือนก่อนไม่มียอด จึงเทียบเป็นเปอร์เซ็นต์ไม่ได้`. Never Infinity, NaN, or 100%. Used verbatim for all three comparison modes (month/year/custom) — no year- or custom-specific variant exists; the literal word เดือน ("month") in this string is a known imprecision when the mode is ปีนี้/ปีที่แล้ว or กำหนดเอง, kept as-is per this section's own precedence over invented alternatives.
- **No fee breakdown block.** The delivered prototype's `scOverview()` also renders a ค่าธรรมเนียมเดือนนี้ (monthly fee) card — struck-through "ร้านจ่ายเอง" / "BrewLedger ออกให้" / "รวมค่าธรรมเนียมทั้งหมด" rows, the same absorbed-fee device as the old WBS 7.5 P&L mock. WBS 4.8 removed `merchants.absorb_gateway_fee`, `orders.gateway_fee_satang`, and `orders.fee_borne_by` from the schema; the MVP's direct merchant-owned PromptPay has no per-transaction fee attributable to BrewLedger at all, so there is no figure left to show. WBS 7.7's own Claude Code Prompt says so explicitly ("NO FEE BREAKDOWN BLOCK"). The metric grid on this screen is ยอดขาย / ต้นทุนวัตถุดิบ / ค่าใช้จ่ายอื่น / กำไรสุทธิ / จำนวนออเดอร์ — no fee row, in any mode.

### แผนการใช้งาน `/console/settings/subscription` **(WBS 4.7 — CORRECTED 2026-08-23. The claim this section previously opened with — "no counterpart in `/design/P5 Handoff.md` §2 ... this screen does not exist in the delivered prototype at all" — was wrong. `design/console-setup.js` has a complete `scPlan()` function (line 117, registered in `SCREENS`/`SETUP`) implementing this exact screen as a 4-card pricing grid. It was missed in the `P5 Handoff.md` → `state_matrix.md` extraction, the same class of gap as GAP-1 (see `docs/design/gaps.md`). Per explicit product-owner override, the screen was rebuilt to the prototype's card design in place of the feature-matrix-table layout this section previously described; the copy below reflects what is actually implemented.)**
- **Tier display mapping (internal `merchants.subscription_tier` enum unchanged — `free`/`starter`/`growth`/`scale` — mapped by position onto the prototype's 4 `PLANS` cards, display layer only):**

  | Internal tier | Display name | Price | Description |
  |---|---|---|---|
  | `free` | ทดลองใช้ | ฿0 | ออเดอร์ 50 รายการ/เดือน · เมนูไม่จำกัด |
  | `starter` | เริ่มต้น | ฿199/เดือน | ออเดอร์ไม่จำกัด · รายงานกำไรรายวัน |
  | `growth` | ร้านประจำ | ฿449/เดือน | สแกนบิลอัตโนมัติ · กำไรต่อเมนู · คลังวัตถุดิบ |
  | `scale` | หลายสาขา | ฿990/เดือน | จัดการหลายสาขา · รายงานรวม · ผู้ใช้หลายคน |

- **Default** — header `แผนการใช้งาน`; a current-plan card: label `แพ็กเกจปัจจุบัน`, then `{ชื่อแพ็กเกจ} · {ราคา}` (e.g. `เริ่มต้น · ฿199/เดือน`) for the merchant's actual `subscriptionTier`. No renewal date is shown — the prototype's `ต่ออายุอัตโนมัติ 1 ก.ย. 2569` line is a static mock with no backing column; per `CLAUDE.md`'s null-over-guessed-value rule, it is omitted rather than fabricated.
- **Always-available note, in the current-plan card, on every tier, unconditionally (never only shown on free, since the guarantee holds on every tier)** — `ขายและรับเงินได้ครบทุกฟังก์ชันในทุกแผน ไม่มีการล็อกฟีเจอร์การขายไว้`.
- **Fee statement, directly beneath the always-available note, on every tier, one plain sentence with no asterisk and no footnote (WBS 4.8 — RL-1: the gateway is gone, so no per-transaction fee is ever attributable to BrewLedger or the merchant's use of this product; the parenthetical is not hedging, it is accurate)** — `ไม่มีค่าธรรมเนียมต่อรายการ ลูกค้าโอนเข้าพร้อมเพย์ของร้านโดยตรง (ธนาคารของลูกค้าอาจคิดค่าธรรมเนียมตามเงื่อนไขพร้อมเพย์ปกติ ซึ่งไม่เกี่ยวกับ BrewLedger)`. This replaces the prototype's own placeholder fee-line (`ค่าธรรมเนียมช่วงทดลอง: BrewLedger ออกให้`, which describes a gateway-fee-absorption model WBS 4.8 withdrew — see `gaps.md` GAP-6 for the same class of correction on the payments screen) rather than rendering both.
- **4-card plan grid (`.oc-plans`/`.card oc-plan`), one card per tier in the table above, in order** — each card shows the plan name (bold), `.oc-planprice`, and the one-line description. The card matching the merchant's current `subscriptionTier` carries `is-cur` styling and shows the tag `ใช้อยู่` in place of a select control. Every other card shows a `เลือกแพ็กเกจนี้` button, styled per the design system's outline `Button` variant — not yet wired to a self-serve upgrade action, since no Edge Function/Server Action for a tier change exists yet; it renders per the prototype's markup as a stated intent, not a dead claim of a working flow.
- **"อัปเกรดแล้วได้อะไรเพิ่ม" card** — one fixed checklist (`.oc-rows`/`.oc-row`/`.oc-tick`), not tier-conditional, verbatim from `scPlan()`: `สแกนบิลผู้ขายแล้วเก็บต้นทุนอัตโนมัติ` / `รายงานกำไรต่อเมนู เรียงตามกำไรรวม` / `คลังวัตถุดิบและวันที่ของจะหมด` / `ผู้ใช้หลายคนต่อร้าน`.
- **No loading state** — `subscriptionTier` arrives already resolved server-side via `MerchantCtx`/`MerchantProvider` (same posture as every other console page reading that context — see `lib/MerchantProvider.tsx`'s own header comment), so there is no client-side fetch for this screen to show a skeleton for.
- **Forbidden anywhere on this screen, same RL-2 list as `/console/menu/{id}`:** ยังไม่ได้ใส่ / ควรใส่ / กรุณาใส่ / ไม่ครบ / ยังขาด — none of the copy above depends on `bom_lines` in any way; no card's content is gated on "enter a recipe."

### จำนวนที่รับต่อช่วงเวลา `/console/settings/capacity` **(WBS 5.3 — no counterpart in `/design/P5 Handoff.md`: the merchant capacity UI is a new deliverable this entry introduces, not a port of an already-designed screen, same posture as WBS 4.7's subscription screen above. Copy authored for the real implementation.)**
- **Default** — header `จำนวนที่รับต่อช่วงเวลา`; one-line intro `กำหนดว่าร้านรับออเดอร์ล่วงหน้าได้กี่รายการต่อช่วงเวลา ปรับได้ทีละช่วง หรือใช้ค่าเริ่มต้นกับทุกช่วงเวลาที่ยังไม่ถึง`; a bulk-default card (`ค่าเริ่มต้นต่อช่วงเวลา` number field + `ใช้ค่านี้กับทุกช่วงเวลาที่ยังไม่ถึง` button); then a list of upcoming open slots (`ช่วงเวลาที่จะถึง`), each with its own capacity field and `บันทึก` button.
- **Bulk apply result** — `ปรับแล้ว N ช่วงเวลา` when every eligible slot updated; `ปรับแล้ว N ช่วงเวลา · ข้าม M ช่วงเวลาที่จองไว้เกินจำนวนใหม่แล้ว` when one or more future slots already carry more bookings than the new value (those are left untouched, not force-emptied or errored — a merchant lowering the default is not asked to also cancel real orders to do it).
- **Per-slot save** — `บันทึกแล้ว` inline, cleared as soon as the field is edited again.
- **Validation** — a non-positive or non-integer capacity is rejected before any request; a request that would still violate `pickup_slots`' own `check (booked_count <= capacity)` (a slot booked past the new value between page load and save) reports `จำนวนต้องมากกว่า 0`, the same message class, not a raw database error.
- **Empty state** — no store yet, or store hours never configured, so no slots have been generated: `ยังไม่มีช่วงเวลาที่สร้างไว้ล่วงหน้า ตั้งเวลาเปิด-ปิดร้านที่ข้อมูลร้านก่อน ระบบจะสร้างให้อัตโนมัติ`.
- **Save error** — `บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง`, same generic-save-error copy every other settings form in this app uses.
- **Forbidden anywhere on this screen, same RL-2 list:** ยังไม่ได้ใส่ / ควรใส่ / กรุณาใส่ / ไม่ครบ / ยังขาด — capacity is a fulfilment limit the merchant sets, never a nag about missing data.
