// WBS 7.5 — copy verbatim from docs/design/state_matrix.md's own
// "กำไรขาดทุน /console/reports/pnl" section and design/console-reports.js's
// scPnl() (that section's own source), per state_matrix.md's precedence
// note. The fee row ("ค่าธรรมเนียม (BrewLedger ออกให้)") in scPnl() is NOT
// reproduced — see fetchPnlDay.ts's header comment: WBS 4.8 already
// superseded it, and state_matrix.md is corrected in this same change.
export const PAGE_TITLE = "กำไรขาดทุนรายวัน";

export const REVENUE_LABEL = "ยอดขาย";
export const COGS_LABEL = "ต้นทุนวัตถุดิบ";
export const OTHER_EXPENSE_LABEL = "ค่าใช้จ่ายอื่น";
export const NET_PROFIT_LABEL = "กำไรสุทธิ";

export const TREND_TITLE = "กำไรสุทธิ 7 วันล่าสุด";

export const PREV_DAY_LABEL = "วันก่อนหน้า";
export const NEXT_DAY_LABEL = "วันถัดไป";
