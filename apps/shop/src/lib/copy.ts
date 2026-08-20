// WBS 5.1 — Thai copy for the public store page, sourced verbatim from
// docs/design/state_matrix.md's "เมนูร้าน /s/{slug}" section. Do not
// paraphrase; if a string this screen needs isn't there, add it to
// state_matrix.md in the same change that adds it here (three of the
// constants below were added to that file for this WBS entry — see its
// comments for exactly which, and why).

export const MENU_EMPTY_TITLE = "ร้านนี้ยังไม่ได้เพิ่มเมนู";
export const MENU_EMPTY_BODY = "ลองกลับมาใหม่อีกครั้ง หรือสอบถามที่เคาน์เตอร์ได้เลย";

// state_matrix's Error entry is a single sentence, not a title/body pair —
// rendered as one string. The retry button reuses this sentence's own
// trailing clause verbatim rather than inventing new copy for the button.
export const ERROR_MESSAGE = "ตอนนี้เปิดหน้านี้ไม่ได้ ลองใหม่อีกครั้ง";
export const ERROR_RETRY_LABEL = "ลองใหม่อีกครั้ง";

export const CLOSED_TITLE = "ตอนนี้ร้านปิดอยู่";
export function closedBody(nextOpeningLabel: string): string {
  return `ดูเมนูได้ตามปกติ สั่งได้อีกครั้ง ${nextOpeningLabel}`;
}

export const SLOTS_FULL_TITLE = "ช่วงเวลารับวันนี้เต็มแล้ว";
export function slotsFullBody(nextSlotLabel: string): string {
  return `สั่งล่วงหน้าสำหรับ ${nextSlotLabel} ได้ที่หน้าถัดไป`;
}

export const NOT_FOUND_TITLE = "ไม่พบร้านนี้";
export const NOT_FOUND_BODY = "ลิงก์อาจไม่ถูกต้อง หรือร้านนี้ยังไม่เปิดให้บริการ";

export const STORE_OPEN_LABEL = "เปิดอยู่";
export const STORE_CLOSED_LABEL = "ปิดอยู่";

export const ITEM_UNAVAILABLE_LABEL = "หมดชั่วคราว";
