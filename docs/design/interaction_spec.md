# Interaction Spec

Extracted from `/design/P5 Handoff.md` §3. Reference copy; source of record
is `/design/P5 Handoff.md`.

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
