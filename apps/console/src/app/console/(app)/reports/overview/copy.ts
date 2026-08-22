// WBS 7.7 — copy verbatim from docs/design/state_matrix.md's own
// "เปรียบเทียบ /console/reports/overview" section (lines 314-317) and
// design/console-reports.js's scOverview() (that section's own source),
// per state_matrix.md's precedence note. The fee breakdown block scOverview()
// also renders ("ค่าธรรมเนียมเดือนนี้" / "BrewLedger ออกให้") is NOT
// reproduced anywhere in this route — the WBS 7.7 entry's own Claude Code
// Prompt step 2 says so explicitly ("NO FEE BREAKDOWN BLOCK"), and WBS 4.8
// already dropped merchants.absorb_gateway_fee / orders.gateway_fee_satang /
// orders.fee_borne_by from the schema — there is no fee figure left to show.
export const PAGE_TITLE = "เปรียบเทียบช่วงเวลา";

export const REVENUE_LABEL = "ยอดขาย";
export const COGS_LABEL = "ต้นทุนวัตถุดิบ";
export const OTHER_EXPENSE_LABEL = "ค่าใช้จ่ายอื่น";
export const NET_PROFIT_LABEL = "กำไรสุทธิ";
export const ORDER_COUNT_LABEL = "จำนวนออเดอร์";

export const MODE_MONTH_LABEL = "เดือนนี้/เดือนที่แล้ว";
export const MODE_YEAR_LABEL = "ปีนี้/ปีที่แล้ว";
export const MODE_CUSTOM_LABEL = "กำหนดเอง";

export const CUSTOM_CURRENT_FROM_LABEL = "ช่วงนี้ — จากวันที่";
export const CUSTOM_CURRENT_TO_LABEL = "ช่วงนี้ — ถึงวันที่";
export const CUSTOM_PREVIOUS_FROM_LABEL = "ช่วงเปรียบเทียบ — จากวันที่";
export const CUSTOM_PREVIOUS_TO_LABEL = "ช่วงเปรียบเทียบ — ถึงวันที่";

// state_matrix.md line 315's own literal example, kept as the incomplete-
// month note; line 316's own literal zero-baseline note.
export const INCOMPLETE_MONTH_NOTE = "เดือนนี้ยังไม่จบ ตัวเลขจึงเทียบเฉพาะช่วงวันเท่ากันของทั้งสองเดือน";
// Not present in state_matrix.md — the year-comparison analogue of line 315's
// month note, needed because MODE_YEAR_LABEL ("ปีนี้/ปีที่แล้ว") is one of
// the three selector options this same WBS entry requires. Added to
// docs/design/state_matrix.md in this change per CLAUDE.md's "invent copy"
// rule (never invent it only in code).
export const INCOMPLETE_YEAR_NOTE = "ปีนี้ยังไม่จบ ตัวเลขจึงเทียบเฉพาะช่วงวันเท่ากันของทั้งสองปี";
export const ZERO_BASELINE_NOTE = "เดือนก่อนไม่มียอด จึงเทียบเป็นเปอร์เซ็นต์ไม่ได้";

export function rangeHeading(currentLabel: string, previousLabel: string): string {
  return `เทียบ ${currentLabel} กับ ${previousLabel}`;
}

export function previousValueNote(baht: string): string {
  return `เดือนก่อน ${baht}`;
}

export const CHART_TITLE = "ยอดขายและกำไร 12 เดือน";
export const LEGEND_REVENUE = "ยอดขาย";
export const LEGEND_PROFIT = "กำไรสุทธิ";
