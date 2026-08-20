// WBS 5.3 — no prototype screen and no pre-existing docs/design/state_matrix.md
// section exist for this console screen (the merchant capacity UI is a new
// deliverable this entry introduces, not a port of an already-designed
// screen) -- self-authored per CLAUDE.md's own precedent for exactly this
// gap (WBS 4.6's QR screen, WBS 5.1's not-found state, WBS 4.7's
// subscription screen all did the same: add the state_matrix.md section in
// the same change, then source copy from it here, rather than inventing
// strings inline). See docs/design/state_matrix.md's new
// "จำนวนที่รับต่อช่วงเวลา /console/settings/capacity" section for the copy
// this file sources verbatim.
export const PAGE_TITLE = "จำนวนที่รับต่อช่วงเวลา";
export const PAGE_INTRO =
  "กำหนดว่าร้านรับออเดอร์ล่วงหน้าได้กี่รายการต่อช่วงเวลา ปรับได้ทีละช่วง หรือใช้ค่าเริ่มต้นกับทุกช่วงเวลาที่ยังไม่ถึง";

export const DEFAULT_CAPACITY_LABEL = "ค่าเริ่มต้นต่อช่วงเวลา";
export const DEFAULT_CAPACITY_APPLY_BUTTON = "ใช้ค่านี้กับทุกช่วงเวลาที่ยังไม่ถึง";
export const DEFAULT_CAPACITY_SAVED = "บันทึกค่าเริ่มต้นแล้ว";

export function bulkApplySummary(updated: number, skipped: number): string {
  if (skipped === 0) {
    return `ปรับแล้ว ${updated} ช่วงเวลา`;
  }
  return `ปรับแล้ว ${updated} ช่วงเวลา · ข้าม ${skipped} ช่วงเวลาที่จองไว้เกินจำนวนใหม่แล้ว`;
}

export const UPCOMING_SLOTS_TITLE = "ช่วงเวลาที่จะถึง";
export const UPCOMING_SLOTS_EMPTY =
  "ยังไม่มีช่วงเวลาที่สร้างไว้ล่วงหน้า ตั้งเวลาเปิด-ปิดร้านที่ข้อมูลร้านก่อน ระบบจะสร้างให้อัตโนมัติ";
export const SLOT_CAPACITY_SAVED = "บันทึกแล้ว";

export const SAVE_ERROR = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
export const CAPACITY_INVALID = "จำนวนต้องมากกว่า 0";
