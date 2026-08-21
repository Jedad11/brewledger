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
- **รอยืนยันการชำระเงิน section (WBS 5.6 — no counterpart in the delivered prototype; the licensed-gateway webhook this replaced never needed a merchant-facing pending queue at all. Copy authored for the real implementation, same posture as WBS 4.6/4.7's own screens.)** — section header `รอยืนยันการชำระเงิน`, positioned above the working queue. Each pending card shows, in this priority: the order TOTAL in large type (`MoneyValue` `size="lg"`, the merchant is comparing it against a figure in their own banking app), the customer name, the order code, the pickup slot, and a countdown to `expires_at` rendered `หมดเวลาใน MM:SS` (same idiom already established for `/pay`'s own waiting state above, applied here to the merchant-facing card). Two controls: `ได้รับเงินแล้ว` (primary, `StatusButton`, ≥56px full width) and `ยังไม่ได้รับเงิน` (secondary, `Button` variant `danger`). Tapping the secondary control swaps it in place for one confirmation step, dismissible — same "two steps, both dismissible" posture interaction_spec.md already documents for cancel order — showing `ยืนยันว่ายังไม่ได้รับเงิน ออเดอร์นี้จะถูกยกเลิกและคืนเวลาให้ลูกค้าคนอื่น` with `ยืนยัน` / `ยกเลิก`. A confirm or reject that fails leaves the card in place with a persistent inline message `ยืนยันการชำระเงินไม่สำเร็จ ลองใหม่อีกครั้ง` (confirm) or `ยกเลิกออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง` (reject) — never a vanishing toast, same generic-failure idiom as `requestOtp.ts`. Section empty state: `ไม่มีออเดอร์ที่รอยืนยัน`.

### เมนู `/console/menu` **(WBS 4.4 — copy sourced verbatim from `console-setup.js`'s `scMenu()`, not previously extracted into this file)**
- **Default** — header `เมนู` with subtitle `{N} รายการ`; rows show photo/placeholder, name, price, and a `พร้อมขาย` availability switch; `เพิ่มรายการ` button beneath the list.
- **Empty** — `ยังไม่มีรายการในเมนู` / `ใส่ชื่อกับราคาก็ขายได้แล้ว ใช้เวลาไม่ถึงหนึ่งนาที` + `เพิ่มรายการแรก`.
- **No store yet** (authored for the real implementation — the delivered prototype's demo state always has a store; a merchant can genuinely reach `/console/menu` before saving a store profile, same blank-state possibility WBS 4.3 already handles on its own screen) — `ตั้งค่าข้อมูลร้านก่อนเพิ่มเมนู` / `กรอกชื่อร้านกับที่อยู่รับสินค้าไว้ก่อน แล้วค่อยกลับมาเพิ่มเมนูได้เลย` + `ไปตั้งค่าข้อมูลร้าน` (links to `/console/settings/store`).
- **Reorder / availability failure** — persistent inline message, never a vanishing toast (interaction_spec.md's general rule for optimistic controls): reuses the same generic-failure idiom as `requestOtp.ts`/the store form's save error, `บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง`.

### แก้ไขรายการ `/console/menu/{id}`
- **Recipe collapsed** — header `สูตร (ใส่ทีหลังได้)`. Saving without opening succeeds instantly: no warning, dialog, banner, toast, badge, or asterisk.
- **Recipe suggested** — `มีสูตรมาตรฐานสำหรับรายการนี้อยู่แล้ว ใช้แล้วปรับตัวเลขให้ตรงกับร้านคุณได้เลย` + `ใช้สูตรนี้แล้วแก้ได้`
- **Recipe editing** — live `ต้นทุนต่อแก้ว` beneath the rows.
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
- **Absorbed fee** — `ค่าธรรมเนียม (BrewLedger ออกให้): 45 บาท`, displayed but not subtracted from merchant profit.

### กำไรต่อเมนู `/console/reports/profit-per-dish`
- **Insight (only when best-seller ≠ top profit contributor)** — `ขายดีที่สุดคือ อเมริกาโน่ (210 แก้ว) แต่กำไรรวมสูงสุดคือ ลาเต้เย็น (3,240 บาท)`
- **Untracked section** — `ยังไม่มีข้อมูลต้นทุน (5 รายการ)`; units and revenue shown, cost/profit `—`; never hidden, never sorted as zero.

### เปรียบเทียบ `/console/reports/overview`
- **Incomplete month** — `เทียบ 1–16 ส.ค. กับ 1–16 ก.ค.` / `เดือนนี้ยังไม่จบ ตัวเลขจึงเทียบเฉพาะช่วงวันเท่ากันของทั้งสองเดือน`
- **Zero baseline** — delta renders `—` with `เดือนก่อนไม่มียอด จึงเทียบเป็นเปอร์เซ็นต์ไม่ได้`. Never Infinity, NaN, or 100%.

### แผนการใช้งาน `/console/settings/subscription` **(WBS 4.7 — no counterpart in `/design/P5 Handoff.md` §2, same posture as WBS 4.6's own "ลิงก์ร้านและ QR" section: this screen does not exist in the delivered prototype at all. Copy authored for the real implementation.)**
- **Default** — header `แผนการใช้งาน`; a current-plan banner naming the merchant's tier (ฟรี / สตาร์ทเตอร์ / โกรท / สเกล) with, directly beneath it and always visible (never only shown on the free tier, since the guarantee holds on every tier): `ขายและรับเงินได้ครบทุกฟังก์ชันในทุกแผน ไม่มีการล็อกฟีเจอร์การขายไว้`; then a comparison table grouped by unlock tier, not a features-vs-tiers grid (four tiers × up to 15 rows does not fit 375px legibly) — see the four group headings and per-feature Thai labels below.
- **Fee statement, directly beneath the always-available note in the current-plan banner, on every tier, one plain sentence with no asterisk and no footnote (WBS 4.8 — RL-1: the gateway is gone, so no per-transaction fee is ever attributable to BrewLedger or the merchant's use of this product; the parenthetical is not hedging, it is accurate)** — `ไม่มีค่าธรรมเนียมต่อรายการ ลูกค้าโอนเข้าพร้อมเพย์ของร้านโดยตรง (ธนาคารของลูกค้าอาจคิดค่าธรรมเนียมตามเงื่อนไขพร้อมเพย์ปกติ ซึ่งไม่เกี่ยวกับ BrewLedger)`.
- **Group headings, in order** — `รวมในทุกแผน` (free tier's 7 always-on features) / `เริ่มใช้ได้ตั้งแต่แผนสตาร์ทเตอร์` (starter's 3 additions) / `เร็ว ๆ นี้ในแผนโกรท` (growth's 2 additions) / `เร็ว ๆ นี้ในแผนสเกล` (scale's 3 additions).
- **Per-feature Thai labels** — สั่งล่วงหน้าและนัดรับที่ร้าน · รับเงินผ่านพร้อมเพย์ · จัดการคิวและสถานะออเดอร์ · บันทึกการขายหน้าร้าน · ยอดขายรวมรายวัน · จัดการเมนู · ตั้งค่าร้าน · คำนวณต้นทุนต่อหน่วย · แจ้งเตือนต้นทุนเปลี่ยนแปลง · ติดตามวัตถุดิบและสต๊อก · พยากรณ์กระแสเงินสด · ที่ปรึกษา AI · จัดการหลายสาขา · ชุดเครื่องมือภาษี · ช่องทางดูแลลูกค้าแบบเร่งด่วน.
- **Coming-soon tag, on every growth/scale row, not a lock icon alone** — `เร็ว ๆ นี้` — a neutral grey pill, never amber/red and never paired with a warning icon (same "never render a locked feature as a failure" posture RL-2's own forbidden-nag rule takes for the recipe block).
- **Upgrade benefit line beneath the สตาร์ทเตอร์ group, one sentence, stated as a benefit not a restriction** — `อัปเกรดเป็นแผนสตาร์ทเตอร์เพื่อดูต้นทุนต่อแก้วและรับแจ้งเตือนเมื่อราคาวัตถุดิบเปลี่ยน`.
- **Upgrade benefit line beneath the โกรท group** — `แผนโกรทกำลังพัฒนาอยู่ จะช่วยพยากรณ์กระแสเงินสดและแนะนำการตั้งราคาด้วย AI`.
- **Upgrade benefit line beneath the สเกล group** — `แผนสเกลกำลังพัฒนาอยู่ จะรองรับหลายสาขา ชุดเครื่องมือภาษี และช่องทางดูแลลูกค้าแบบเร่งด่วน`.
- **No loading state** — `subscriptionTier` arrives already resolved server-side via `MerchantCtx`/`MerchantProvider` (same posture as every other console page reading that context — see `lib/MerchantProvider.tsx`'s own header comment), so there is no client-side fetch for this screen to show a skeleton for.
- **Forbidden anywhere on this screen, same RL-2 list as `/console/menu/{id}`:** ยังไม่ได้ใส่ / ควรใส่ / กรุณาใส่ / ไม่ครบ / ยังขาด — none of the copy above depends on `bom_lines` in any way; no feature row's unlock condition is "enter a recipe."

### จำนวนที่รับต่อช่วงเวลา `/console/settings/capacity` **(WBS 5.3 — no counterpart in `/design/P5 Handoff.md`: the merchant capacity UI is a new deliverable this entry introduces, not a port of an already-designed screen, same posture as WBS 4.7's subscription screen above. Copy authored for the real implementation.)**
- **Default** — header `จำนวนที่รับต่อช่วงเวลา`; one-line intro `กำหนดว่าร้านรับออเดอร์ล่วงหน้าได้กี่รายการต่อช่วงเวลา ปรับได้ทีละช่วง หรือใช้ค่าเริ่มต้นกับทุกช่วงเวลาที่ยังไม่ถึง`; a bulk-default card (`ค่าเริ่มต้นต่อช่วงเวลา` number field + `ใช้ค่านี้กับทุกช่วงเวลาที่ยังไม่ถึง` button); then a list of upcoming open slots (`ช่วงเวลาที่จะถึง`), each with its own capacity field and `บันทึก` button.
- **Bulk apply result** — `ปรับแล้ว N ช่วงเวลา` when every eligible slot updated; `ปรับแล้ว N ช่วงเวลา · ข้าม M ช่วงเวลาที่จองไว้เกินจำนวนใหม่แล้ว` when one or more future slots already carry more bookings than the new value (those are left untouched, not force-emptied or errored — a merchant lowering the default is not asked to also cancel real orders to do it).
- **Per-slot save** — `บันทึกแล้ว` inline, cleared as soon as the field is edited again.
- **Validation** — a non-positive or non-integer capacity is rejected before any request; a request that would still violate `pickup_slots`' own `check (booked_count <= capacity)` (a slot booked past the new value between page load and save) reports `จำนวนต้องมากกว่า 0`, the same message class, not a raw database error.
- **Empty state** — no store yet, or store hours never configured, so no slots have been generated: `ยังไม่มีช่วงเวลาที่สร้างไว้ล่วงหน้า ตั้งเวลาเปิด-ปิดร้านที่ข้อมูลร้านก่อน ระบบจะสร้างให้อัตโนมัติ`.
- **Save error** — `บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง`, same generic-save-error copy every other settings form in this app uses.
- **Forbidden anywhere on this screen, same RL-2 list:** ยังไม่ได้ใส่ / ควรใส่ / กรุณาใส่ / ไม่ครบ / ยังขาด — capacity is a fulfilment limit the merchant sets, never a nag about missing data.
