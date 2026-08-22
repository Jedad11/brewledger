// WBS 7.7 — comparison range math. Three modes: เดือนนี้/เดือนที่แล้ว
// (default), ปีนี้/ปีที่แล้ว, and a merchant-picked custom range pair.
// Reuses WBS 7.1's businessDateBoundsUtc for "what business_date is today"
// (this is the fourth report needing that semantic, after 7.1's dashboard,
// 7.5's P&L, and 7.6's profit-per-dish), but everything downstream of that
// stays plain YYYY-MM-DD string math against daily_financials.business_date
// (a `date` column, timezone-free once "today" is resolved) — no UTC
// timestamp bounds needed here, unlike the other three reports which filter
// `orders.created_at` (a `timestamptz`).
import { businessDateBoundsUtc } from "../../businessDate";

export type ComparisonMode = "month" | "year" | "custom";

export interface DateRange {
  fromBusinessDate: string;
  toBusinessDate: string;
}

export interface ComparisonRanges {
  mode: ComparisonMode;
  current: DateRange;
  previous: DateRange;
  /** true when `current` does not yet cover the full calendar month/year (never true for "custom" — the merchant picked both ranges explicitly). */
  incomplete: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseBusinessDate(businessDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = businessDate.split("-").map(Number);
  return { year, month, day };
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate(); // month1 is 1-indexed target month
}

export function monthComparisonRanges(timeZone: string, now: Date = new Date()): ComparisonRanges {
  const today = businessDateBoundsUtc(timeZone, now).businessDate;
  const { year, month, day } = parseBusinessDate(today);

  const currentFrom = `${year}-${pad2(month)}-01`;
  const daysInCurrentMonth = daysInMonth(year, month);
  const incomplete = day < daysInCurrentMonth;

  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth === 0) {
    prevMonth = 12;
    prevYear -= 1;
  }
  const daysInPrevMonth = daysInMonth(prevYear, prevMonth);
  const clampedDay = Math.min(day, daysInPrevMonth);
  const previousFrom = `${prevYear}-${pad2(prevMonth)}-01`;
  const previousTo = `${prevYear}-${pad2(prevMonth)}-${pad2(clampedDay)}`;
  const currentTo = clampedDay < day ? `${year}-${pad2(month)}-${pad2(clampedDay)}` : today;

  return {
    mode: "month",
    current: { fromBusinessDate: currentFrom, toBusinessDate: currentTo },
    previous: { fromBusinessDate: previousFrom, toBusinessDate: previousTo },
    incomplete,
  };
}

export function yearComparisonRanges(timeZone: string, now: Date = new Date()): ComparisonRanges {
  const today = businessDateBoundsUtc(timeZone, now).businessDate;
  const { year, month, day } = parseBusinessDate(today);

  const currentFrom = `${year}-01-01`;
  const incomplete = !(month === 12 && day === 31);

  const prevYear = year - 1;
  const daysInTargetMonth = daysInMonth(prevYear, month);
  const clampedDay = Math.min(day, daysInTargetMonth); // handles Feb 29 -> Feb 28
  const previousFrom = `${prevYear}-01-01`;
  const previousTo = `${prevYear}-${pad2(month)}-${pad2(clampedDay)}`;

  return {
    mode: "year",
    current: { fromBusinessDate: currentFrom, toBusinessDate: today },
    previous: { fromBusinessDate: previousFrom, toBusinessDate: previousTo },
    incomplete,
  };
}

export function customComparisonRanges(current: DateRange, previous: DateRange): ComparisonRanges {
  return { mode: "custom", current, previous, incomplete: false };
}

export function comparisonRanges(
  mode: ComparisonMode,
  timeZone: string,
  custom?: { current: DateRange; previous: DateRange },
  now: Date = new Date(),
): ComparisonRanges {
  if (mode === "month") return monthComparisonRanges(timeZone, now);
  if (mode === "year") return yearComparisonRanges(timeZone, now);
  if (!custom) {
    const today = businessDateBoundsUtc(timeZone, now).businessDate;
    return customComparisonRanges(
      { fromBusinessDate: today, toBusinessDate: today },
      { fromBusinessDate: today, toBusinessDate: today },
    );
  }
  return customComparisonRanges(custom.current, custom.previous);
}
