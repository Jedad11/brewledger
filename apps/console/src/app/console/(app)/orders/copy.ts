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
