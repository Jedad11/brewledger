// WBS 7.6 — period selector bounds. Reuses WBS 7.1's businessDateBoundsUtc /
// businessDateBoundsForDateUtc (this is the third report needing "business
// date" semantics, after 7.1's dashboard and 7.5's P&L) rather than
// reimplementing the local-midnight-in-an-arbitrary-timezone math.
import { businessDateBoundsForDateUtc, businessDateBoundsUtc } from "../../businessDate";

export type PeriodKind = "today" | "7d" | "30d" | "custom";

export interface PeriodBounds {
  startUtc: Date;
  endUtc: Date;
  /** business_date of the first day included, inclusive. */
  fromBusinessDate: string;
  /** business_date of the last day included, inclusive. */
  toBusinessDate: string;
}

function shiftBusinessDate(businessDate: string, deltaDays: number): string {
  const d = new Date(`${businessDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

// N calendar days ending today, today INCLUSIVE -- same convention as WBS
// 7.5's fetchPnlTrend (day itself + 6 priors = 7 points total).
function nDayPeriod(timeZone: string, days: number): PeriodBounds {
  const today = businessDateBoundsUtc(timeZone);
  const fromBusinessDate = shiftBusinessDate(today.businessDate, -(days - 1));
  const from = businessDateBoundsForDateUtc(timeZone, fromBusinessDate);
  return {
    startUtc: from.startUtc,
    endUtc: today.endUtc,
    fromBusinessDate,
    toBusinessDate: today.businessDate,
  };
}

export function periodBounds(
  timeZone: string,
  kind: PeriodKind,
  custom?: { fromBusinessDate: string; toBusinessDate: string },
): PeriodBounds {
  if (kind === "today") {
    const today = businessDateBoundsUtc(timeZone);
    return { startUtc: today.startUtc, endUtc: today.endUtc, fromBusinessDate: today.businessDate, toBusinessDate: today.businessDate };
  }
  if (kind === "7d") return nDayPeriod(timeZone, 7);
  if (kind === "30d") return nDayPeriod(timeZone, 30);

  // custom -- fromBusinessDate/toBusinessDate inclusive, both required by
  // the caller (PeriodSelector never fires onChange for "custom" until both
  // date fields are filled).
  const from = custom ?? { fromBusinessDate: businessDateBoundsUtc(timeZone).businessDate, toBusinessDate: businessDateBoundsUtc(timeZone).businessDate };
  const fromBounds = businessDateBoundsForDateUtc(timeZone, from.fromBusinessDate);
  const toBounds = businessDateBoundsForDateUtc(timeZone, from.toBusinessDate);
  return {
    startUtc: fromBounds.startUtc,
    endUtc: toBounds.endUtc,
    fromBusinessDate: from.fromBusinessDate,
    toBusinessDate: from.toBusinessDate,
  };
}
