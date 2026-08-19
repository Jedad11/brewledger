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

### ข้อมูลร้าน `/console/settings/store` **(undocumented in the delivered `P5 Handoff.md`, added by reading `console-setup.js` directly — see `/docs/design/gaps.md` GAP-5)**
- **Default** — onboarding strip (see `OnboardingStrip`, hidden once all 3 steps are done) above a form: ชื่อร้าน / ที่อยู่สำหรับรับสินค้า / เวลาเปิด+เวลาปิด / ลิงก์ร้าน (auto-suggested from the name, editable, never blank). Slug field note beneath the input: `ลูกค้าจะเข้าที่ ` **`brewledger.app/s/{slug}`** ` · ตั้งจากชื่อร้านให้อัตโนมัติ แก้ได้ตามต้องการ`.
- **Publish toggle** — label `เปิดให้ลูกค้าสั่งผ่านลิงก์`; note, always visible beneath it, never only on change: `เมื่อเปิด ใครก็ตามที่มีลิงก์หรือสแกน QR จะเห็นเมนูและสั่งล่วงหน้าได้ · เมื่อปิด ลิงก์จะแจ้งว่ายังไม่เปิดรับออเดอร์ และคุณยังขายหน้าร้านได้ตามปกติ`.
- **Save** — `บันทึก`.
- **Onboarding strip** — exactly 3 steps, never a recipe step: ข้อมูลร้าน / เมนูอย่างน้อย 1 รายการ / เชื่อมช่องทางรับเงิน.
- **Validation** (inline, per field, not in the state matrix's delivered prototype — the prototype's `scStore()` never modeled an invalid state; authored for the real implementation) — name: `กรอกชื่อร้าน`; pick-up address: `กรอกที่อยู่สำหรับรับสินค้า`; opening time: `เลือกเวลาเปิด`; closing time: `เลือกเวลาปิด`.
- **Save success** — `บันทึกแล้ว`.
- **Save error** — `บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง` (same generic-failure idiom as `requestOtp.ts`, WBS 4.1).

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
