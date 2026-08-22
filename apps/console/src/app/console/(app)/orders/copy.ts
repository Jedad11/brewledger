// WBS 5.6 — Thai copy for /console/orders's "รอยืนยันการชำระเงิน" section.
// Sourced verbatim from docs/design/state_matrix.md's own "ออเดอร์
// /console/orders" section (added in this change — no prototype screen
// exists for this section, same posture as WBS 4.6/4.7's own authored
// screens). Do not paraphrase any of it.
export const PENDING_SECTION_TITLE = "รอยืนยันการชำระเงิน";
export const PENDING_EMPTY = "ไม่มีออเดอร์ที่รอยืนยัน";

export const CONFIRM_LABEL = "ได้รับเงินแล้ว";
export const REJECT_LABEL = "ยังไม่ได้รับเงิน";

export const REJECT_CONFIRM_PROMPT =
  "ยืนยันว่ายังไม่ได้รับเงิน ออเดอร์นี้จะถูกยกเลิกและคืนเวลาให้ลูกค้าคนอื่น";
export const REJECT_CONFIRM_YES = "ยืนยัน";
export const REJECT_CONFIRM_CANCEL = "ยกเลิก";

export const CONFIRM_FAILED = "ยืนยันการชำระเงินไม่สำเร็จ ลองใหม่อีกครั้ง";
export const REJECT_FAILED = "ยกเลิกออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง";

export const EXPIRES_IN_PREFIX = "หมดเวลาใน";
export const EXPIRED_LABEL = "หมดเวลาแล้ว";

// Page-level empty state -- pre-existing copy, docs/design/state_matrix.md
// line 127, not new to this change.
export const PAGE_EMPTY_TITLE = "ยังไม่มีออเดอร์วันนี้";
export const PAGE_EMPTY_BODY = "ลูกค้าสั่งผ่านลิงก์ร้านของคุณได้เลย";
export const PAGE_EMPTY_ACTION = "ดูลิงก์ร้าน";

export const PAGE_TITLE = "ออเดอร์";

// WBS 5.8 -- working-queue inbox. Verbatim from docs/design/state_matrix.md's
// own "ออเดอร์ /console/orders" section (this change's own additions there),
// sourced from design/owner-console.js's scOrders()/orderCard().
export const NEW_ORDERS_BANNER = (n: number) => `มีออเดอร์ใหม่ ${n} รายการ`;
export const NEW_ORDERS_ACK = "รับทราบ";
export const NEAREST_SLOT_PILL = "ใกล้ที่สุด";
export const CUPS_SUFFIX = "แก้ว";

export const NOTIFY_DENIED_HINT =
  "อุปกรณ์นี้ปิดการแจ้งเตือนไว้ ระบบจึงตรวจหาออเดอร์ใหม่ให้ทุก 10 วินาทีขณะเปิดหน้านี้อยู่";
export const NOTIFY_IOS_HINT =
  "บน iPhone ต้องเพิ่มเว็บนี้ลงหน้าจอโฮมก่อน การแจ้งเตือนจึงจะทำงานได้ — เปิดเมนูแชร์ แล้วเลือก “เพิ่มไปยังหน้าจอโฮม”";

// WBS 5.8 -- authored (no prototype counterpart; see state_matrix.md's own
// note on this toggle).
export const MUTE_TOGGLE_LABEL = "เสียงแจ้งเตือนออเดอร์ใหม่";
export const MUTE_TOGGLE_DESCRIPTION = "เสียงและการสั่นเมื่อมีออเดอร์ใหม่เข้ามา";

// WBS 5.9 -- status action buttons. Failure copy sourced from
// interaction_spec.md line 13 ("on failure the badge reverts and a
// persistent inline message appears") -- the message text itself is
// authored (no exact string existed anywhere), same generic-failure idiom
// as the rest of this app (requestOtp.ts / menu save / capacity save all
// use the identical "ลองใหม่อีกครั้ง" pattern), plus one MORE specific
// message for the one distinguishable failure mode (another tab/device
// already moved this order) rather than folding it into the generic one.
export const ADVANCE_FAILED = "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";
export const ADVANCE_STALE = "สถานะออเดอร์นี้เปลี่ยนไปแล้ว ลองรีเฟรชหน้าอีกครั้ง";

// WBS 5.9 -- bulk "mark all ready" per pickup slot. Button label verbatim
// from design/owner-console.js's own scOrders() (`data-bulk`), confirmed
// against the WBS 5.9 Claude Code Prompt's identical string -- added here
// and to docs/design/state_matrix.md in this same change (state_matrix.md
// had documented the working queue's grouping but not this control, per
// its own note "WBS 5.9/5.11 add them"). Result copy is authored: the
// prototype's own bulk handler is a client-side-only mutation with no
// failure case to source language from.
export const BULK_READY_LABEL = "ทำเสร็จทั้งช่วงเวลานี้";
export function bulkReadyPartialResult(successCount: number, failedCodes: string[]): string {
  return `ทำสำเร็จ ${successCount} ออเดอร์ · ไม่สำเร็จ ${failedCodes.length} ออเดอร์ (${failedCodes.join(", ")})`;
}
export const BULK_READY_TOTAL_FAILURE = "ทำรายการไม่สำเร็จทั้งหมด ลองใหม่อีกครั้ง";

// WBS 5.9 -- order detail screen `/console/orders/{id}`. No counterpart in
// docs/design/state_matrix.md (only the working-queue *list* was
// documented there, WBS 5.8) -- authored here from
// design/owner-console.js's own scDetail(), same posture as WBS 4.7/5.3's
// own authored screens, and added to state_matrix.md in this same change.
export const DETAIL_BACK = "ย้อนกลับ";
export const DETAIL_CONTACT_TITLE = "ติดต่อลูกค้า";
export const DETAIL_CONTACT_MISSING = "ลูกค้าไม่ได้ให้เบอร์โทร";
export const DETAIL_CALL_CUSTOMER = "โทรหาลูกค้า";
export const DETAIL_HISTORY_TITLE = "ประวัติสถานะ";
