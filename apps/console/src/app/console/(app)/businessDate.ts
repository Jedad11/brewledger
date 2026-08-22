// WBS 7.1 — "business date" per WBS 7.5's own cut-off definition (WBS
// Dictionary line 5551-5553, restated here since 7.5 itself isn't built
// yet and this dashboard cannot wait for it): a sale belongs to the
// calendar day it fell on in the STORE's own timezone, not UTC and not the
// merchant's browser timezone. A shop open past midnight local time is out
// of MVP scope — a 23:59 sale and a 00:10 sale on the same physical
// business day would land in two different business dates here; documented
// rather than silently wrong.
//
// No date library pulled in for this (ponytail: `Intl.DateTimeFormat`
// already ships in the runtime) — the only non-trivial part is converting a
// LOCAL midnight in an arbitrary IANA zone to the UTC instant Postgres
// timestamptz columns compare against, which needs the zone's UTC offset at
// that instant (Thailand has no DST, but `stores.timezone` is a free-text
// column, not a hardcoded constant, so this stays timezone-generic).
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === "24" ? "0" : parts.hour;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hour, +parts.minute, +parts.second);
  return asUtc - date.getTime();
}

export interface BusinessDateBounds {
  /** YYYY-MM-DD in the store's timezone — matches `purchase_invoices.invoice_date` (a plain `date` column, already timezone-free). */
  businessDate: string;
  /** UTC instant of local 00:00:00 for businessDate — inclusive lower bound for a `timestamptz` filter. */
  startUtc: Date;
  /** UTC instant of the following local 00:00:00 — exclusive upper bound. */
  endUtc: Date;
}

export function businessDateBoundsUtc(timeZone: string, now: Date = new Date()): BusinessDateBounds {
  const businessDate = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const midnightGuessUtc = new Date(`${businessDate}T00:00:00Z`);
  const offsetMs = timeZoneOffsetMs(midnightGuessUtc, timeZone);
  const startUtc = new Date(midnightGuessUtc.getTime() - offsetMs);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);

  return { businessDate, startUtc, endUtc };
}
