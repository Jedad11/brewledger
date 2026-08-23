// WBS 5.12 — Thai copy for /console/sales/quick. Sourced verbatim from
// docs/design/state_matrix.md's own "ขายหน้าร้าน /console/sales/quick"
// section (added in this change by reading design/owner-console.js's
// scQuick() directly — see docs/design/gaps.md GAP-11). Do not paraphrase.
export const PAGE_TITLE = "ขายหน้าร้าน";
export const PAGE_SUBTITLE = "แตะเพื่อเพิ่ม · กดค้างเพื่อเลือกตัวเลือก";

export const RECENT_SALES_TITLE = "ขายล่าสุด";
export const CUPS_SUFFIX = "แก้ว";

export const CONFIRM_LABEL = "รับเงินสด";
export const UNDO_LABEL = "ยกเลิก";
export const UNDO_EXPIRED_LABEL = "หมดเวลายกเลิก";

// Authored — the option sheet itself has no prototype counterpart (scQuick()'s
// own long-press handler is a stub alert(), see gaps.md GAP-11); "เพิ่ม" reuses
// the exact verb this screen's own subtitle already establishes ("แตะเพื่อเพิ่ม")
// rather than borrowing apps/shop's differently-scoped ADD_TO_CART_LABEL
// ("ใส่ตะกร้า" — there is no "cart" concept a merchant recognizes here, only
// an immediate sale).
export const SHEET_ADD_LABEL = "เพิ่ม";

// Authored — the prototype's own data-undo handler is a client-side-only
// array splice with no failure case to source language from (see gaps.md
// GAP-11 and this entry's own state_matrix.md section).
export const UNDO_FAILED = "ยกเลิกไม่สำเร็จ ไปที่หน้ารายละเอียดออเดอร์เพื่อยกเลิก";
export const SALE_FAILED = "บันทึกการขายไม่สำเร็จ ลองใหม่อีกครั้ง";
