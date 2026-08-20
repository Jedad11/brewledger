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

// WBS 5.2 — item options sheet and cart, sourced from state_matrix.md's
// "ตัวเลือกรายการ (sheet)" and "ตะกร้า `/s/{slug}/cart`" sections (added to
// that file for this WBS entry — see its comments for exactly which lines
// are new).

export const BACK_LABEL = "ย้อนกลับ";

export const QUANTITY_LABEL = "จำนวน";
export const DECREASE_QUANTITY_LABEL = "ลด";
export const INCREASE_QUANTITY_LABEL = "เพิ่ม";
export const ADD_TO_CART_LABEL = "ใส่ตะกร้า";

export const CART_TITLE = "ตะกร้า";
export const CART_EMPTY_TITLE = "ตะกร้ายังว่างอยู่";
export const CART_EMPTY_BODY = "เลือกเครื่องดื่มจากเมนูได้เลย";
export const BACK_TO_MENU_LABEL = "กลับไปดูเมนู";
export const REMOVE_LABEL = "ลบ";
export const ADD_MORE_ITEMS_LABEL = "เพิ่มรายการอีก";
export const CART_TOTAL_LABEL = "รวมทั้งหมด";
export const VIEW_CART_LABEL = "ดูตะกร้า";
export const PROCEED_TO_SLOT_LABEL = "เลือกเวลารับ";

export function cupsLabel(count: number): string {
  return `${count} แก้ว`;
}

// Cart bar's disabled state reuses the exact trailing clause already
// documented under เมนูร้าน's own "Closed" state ("cart bar reads
// `สั่งได้อีกครั้ง พรุ่งนี้ 07:00`") — not a new string, just not previously
// wired into a copy.ts function.
export function cartBarDisabledLabel(nextOpeningLabel: string): string {
  return `สั่งได้อีกครั้ง ${nextOpeningLabel}`;
}

// Stale-cart-at-proceed re-validation copy — authored for the real
// implementation, no prototype equivalent (the delivered prototype never
// re-validates). See state_matrix.md's "Stale cart at proceed" entry for
// the full reasoning.
export const CART_REVALIDATING_LABEL = "กำลังตรวจสอบราคาล่าสุด...";
export const CART_CHANGED_TITLE = "รายการในตะกร้ามีการเปลี่ยนแปลง";
export const CART_CHANGED_BODY = "ตรวจสอบรายการด้านล่างก่อนไปต่อ";
export const CART_REVALIDATION_ERROR = "ตรวจสอบราคาล่าสุดไม่ได้ ลองใหม่อีกครั้ง";
export const ACCEPT_NEW_PRICE_LABEL = "ใช้ราคาใหม่";

export function itemUnavailableDiffText(name: string): string {
  return `${name} หมดแล้ว ไม่สามารถสั่งได้ในตอนนี้`;
}

export function optionRemovedDiffText(name: string): string {
  return `${name} ไม่มีให้เลือกแล้ว`;
}

// Price-changed diffs embed two money values, which must render through
// PublicMoneyValue (never hand-formatted inline) — the caller composes
// `priceChangedDiffPrefix(name)` + <PublicMoneyValue/> + PRICE_CHANGED_DIFF_MIDDLE
// + <PublicMoneyValue/> as JSX rather than this file returning a fully
// formatted string.
export function priceChangedDiffPrefix(name: string): string {
  return `${name} ราคาเปลี่ยนจาก `;
}
export const PRICE_CHANGED_DIFF_MIDDLE = " เป็น ";
