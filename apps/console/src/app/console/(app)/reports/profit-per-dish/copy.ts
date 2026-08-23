// WBS 7.6 — copy verbatim from docs/design/state_matrix.md's own
// "กำไรต่อเมนู /console/reports/profit-per-dish" section for the insight
// and untracked-section strings; period-chip labels from the WBS
// Dictionary's own Claude Code Prompt step 5 (state_matrix.md doesn't
// restate them, and design/console-reports.js's scDish() dev harness
// matches the same four labels verbatim).
//
// Table headers below are ported from design/console-reports.js scDish()
// (line ~150) verbatim: "ขายได้" and "กำไรต่อแก้ว" -- NOT the WBS
// Dictionary's own Claude Code Prompt step 2, which writes "ขายได้ (แก้ว)"
// and "กำไร/แก้ว". Per CLAUDE.md's precedence table the delivered prototype
// outranks the WBS entry's own description on appearance when they
// disagree, and state_matrix.md doesn't cover the header row at all, so the
// prototype's exact strings win here — flagged for redline_reviewer.
export const PAGE_TITLE = "กำไรต่อเมนู";

export const COL_ITEM = "เมนู";
export const COL_UNITS = "ขายได้";
export const COL_REVENUE = "ยอดขาย";
export const COL_COST = "ต้นทุน";
export const COL_MARGIN_PER_UNIT = "กำไรต่อแก้ว";
export const COL_TOTAL_PROFIT = "กำไรรวม";

export const PERIOD_TODAY = "วันนี้";
export const PERIOD_7D = "7 วัน";
export const PERIOD_30D = "30 วัน";
export const PERIOD_CUSTOM = "กำหนดเอง";

export const CUSTOM_FROM_LABEL = "จากวันที่";
export const CUSTOM_TO_LABEL = "ถึงวันที่";

export const INSIGHT_TAG = "สิ่งที่ตัวเลขบอก";
// state_matrix.md's own example sentence, kept as a template:
// "ขายดีที่สุดคือ อเมริกาโน่ (210 แก้ว) แต่กำไรรวมสูงสุดคือ ลาเต้เย็น (3,240 บาท)"
export function insightSentence(
  bestSellerName: string,
  bestSellerUnits: number,
  topProfitName: string,
  topProfitBaht: string,
): string {
  return `ขายดีที่สุดคือ ${bestSellerName} (${bestSellerUnits} แก้ว) แต่กำไรรวมสูงสุดคือ ${topProfitName} (${topProfitBaht} บาท)`;
}

export const EMPTY_TITLE = "ยังไม่มีรายการขายในช่วงนี้";
export const EMPTY_BODY = "ตัวเลขจะขึ้นที่นี่เมื่อมีการขาย";
