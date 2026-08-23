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

// WBS 5.11 -- order cancellation and merchant-initiated refund. Reason
// picker labels/order verbatim from interaction_spec.md:18 (also
// design/owner-console.js's own REASONS const) -- mapped client-side to the
// five orders.cancel_reason DB codes (docs/db/wbs_5_11_refund_design.md
// §1); the codes never appear as literal UI strings.
export type CancelReasonCode =
  | "out_of_stock"
  | "equipment_failure"
  | "customer_request"
  | "unexpected_closure"
  | "other";

export const CANCEL_REASONS: { code: CancelReasonCode; label: string }[] = [
  { code: "out_of_stock", label: "ของหมด" },
  { code: "equipment_failure", label: "เครื่องเสีย" },
  { code: "customer_request", label: "ลูกค้าขอยกเลิก" },
  { code: "unexpected_closure", label: "ร้านปิดกะทันหัน" },
  { code: "other", label: "อื่นๆ" },
];

export function cancelReasonLabel(code: CancelReasonCode): string {
  return CANCEL_REASONS.find((r) => r.code === code)?.label ?? code;
}

export const DETAIL_CANCEL_BUTTON = "ยกเลิกออเดอร์";

// Two dismissible steps, per interaction_spec.md:18 -- reason picker, then
// a confirm sheet. Titles/next-step labels verbatim from
// design/owner-console.js's own cancelSheet(). The confirm sheet's BODY
// text is authored, not the prototype's verbatim "...ระบบจะเริ่มคืนเงินทันที"
// ("the system will begin the refund immediately") -- that line describes
// the withdrawn gateway-refund design and now contradicts RL-1 (this system
// never moves money; the merchant transfers the refund from their own
// banking app, WBS 5.11's own Revision note). Corrected here rather than
// carried forward verbatim, per CLAUDE.md's own rule that a red line beats
// the prototype and the correction is made in the same change.
export const CANCEL_REASON_SHEET_TITLE = "เหตุผลที่ยกเลิก";
export const CANCEL_REASON_NEXT_LABEL = "ต่อไป";
export const CANCEL_REASON_CLOSE_LABEL = "ปิด";

export const CANCEL_CONFIRM_TITLE = "ยืนยันการยกเลิก";
export function cancelConfirmOrderLine(orderCode: string, reasonLabel: string): string {
  return `ออเดอร์ ${orderCode} · เหตุผล: ${reasonLabel}`;
}
export const CANCEL_CONFIRM_REFUND_NOTE = "ลูกค้าจะได้รับแจ้ง คุณจะต้องโอนเงินคืนให้ลูกค้าเองผ่านแอปธนาคาร";
export const CANCEL_CONFIRM_YES = "ยืนยันยกเลิก";
export const CANCEL_CONFIRM_NO = "ไม่ยกเลิก";

export const CANCEL_FAILED = "ยกเลิกออเดอร์ไม่สำเร็จ ลองใหม่อีกครั้ง";
export const CANCEL_STALE = "สถานะออเดอร์นี้เปลี่ยนไปแล้ว ลองรีเฟรชหน้าอีกครั้ง";
export const CANCEL_VALIDATION_FAILED = "กรุณาเลือกเหตุผลก่อนยืนยัน";

// The order-detail screen's own informational cards for a terminal
// cancelled/refunded order -- gated on refund_status, never cancel_reason's
// mere presence (same load-bearing rule as the customer-facing tracking
// page, docs/db/wbs_5_11_refund_design.md §4): refund_status='pending'
// shows the in-progress card (title/body verbatim,
// design/owner-console.js's own scDetail()); refund_status='done' shows a
// completed card instead of the SAME "in progress" copy the prototype
// showed for both cases -- a resolved obligation is not "in progress",
// and the prototype never modelled a completed refund at all (same gap as
// state_matrix.md's own "Refunded" entry).
export const DETAIL_REFUND_PENDING_TITLE = "กำลังคืนเงิน";
export const DETAIL_REFUND_PENDING_BODY = "เงินจะคืนเข้าบัญชีเดิมของลูกค้าภายใน 3–5 วันทำการ ระบบแจ้งลูกค้าให้แล้ว";
export const DETAIL_REFUND_DONE_TITLE = "คืนเงินแล้ว";
export const DETAIL_REFUND_DONE_BODY = "เงินคืนเข้าบัญชีเดิมเรียบร้อยแล้ว";

// "รอคืนเงิน" section -- placed below the working queue, above completed
// orders, persists until every entry is resolved (never ages out, no
// dismiss/ignore control). Copy authored for the real implementation, same
// posture as WBS 5.6's own "รอยืนยันการชำระเงิน" section -- see
// docs/design/state_matrix.md's own entry for this section, added in this
// change.
export const REFUND_SECTION_TITLE = "รอคืนเงิน";
export const REFUND_SECTION_EMPTY = "ไม่มีออเดอร์ที่รอคืนเงิน";
export const REFUND_HELPER_LINE = "โอนคืนลูกค้าผ่านแอปธนาคารของคุณ แล้วกดยืนยันที่นี่";
export const REFUND_RESOLVE_LABEL = "โอนคืนแล้ว";
export function refundOutstandingDays(days: number): string {
  return `ค้างมา ${days} วัน`;
}
export const REFUND_COPY_PHONE_LABEL = "คัดลอกเบอร์โทร";
export const REFUND_COPY_SUCCESS = "คัดลอกแล้ว";
export const REFUND_COPY_FAILED = "คัดลอกไม่สำเร็จ ลองใหม่อีกครั้ง";
export const RESOLVE_REFUND_FAILED = "บันทึกการคืนเงินไม่สำเร็จ ลองใหม่อีกครั้ง";
export const RESOLVE_REFUND_STALE = "รายการนี้เปลี่ยนไปแล้ว ลองรีเฟรชหน้าอีกครั้ง";
