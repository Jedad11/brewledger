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
