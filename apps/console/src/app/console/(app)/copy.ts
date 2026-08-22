// WBS 7.1 — `/console` dashboard. Copy verbatim from
// docs/design/state_matrix.md's own "หน้าหลัก /console" section and
// design/owner-console.js's scDash(), which is that section's own source
// (see state_matrix.md's header note on precedence). Never paraphrased.
export const PAGE_TITLE = "หน้าหลัก";

export const REVENUE_LABEL = "ยอดขายวันนี้";
export const PROFIT_LABEL = "กำไรสุทธิวันนี้";
export const EXPENSES_LABEL = "ค่าใช้จ่ายวันนี้";
export const ORDERS_LABEL = "ออเดอร์";

export const ORDERS_WAITING_SUFFIX = "รอทำ";
export const ORDERS_PREPARING_SUFFIX = "กำลังทำ";
export const ORDERS_READY_SUFFIX = "พร้อมรับ";

// RL-2 zero-BOM disclosure — plain grey text, never amber, never an icon,
// never a warning. This is information, not a fault (state_matrix.md line
// 207 / WBS 7.1 Claude Code Prompt step 2).
export const NO_COST_DATA_NOTE = "ยังไม่ได้บันทึกต้นทุน จึงยังคำนวณกำไรไม่ได้";

export const UPCOMING_SLOTS_TITLE = "ช่วงเวลารับถัดไป";
export const UPCOMING_SLOTS_UNIT = "น.";
export function upcomingSlotBookedLabel(bookedCount: number): string {
  return `จองแล้ว ${bookedCount} ออเดอร์`;
}

export const QUICK_ACTION_ORDERS = "ออเดอร์";
export const QUICK_ACTION_QUICK_SALE = "ขายหน้าร้าน";
export const QUICK_ACTION_SCAN_BILL = "สแกนบิล";
