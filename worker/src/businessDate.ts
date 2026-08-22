// WBS 7.5 — same "business date" cut-off as apps/console's own businessDate.ts
// (WBS 7.1): a sale belongs to the calendar day it fell on in the STORE's
// own timezone. Duplicated here rather than imported — this worker is a
// separate package/runtime from apps/console (no shared package currently
// houses this pure helper), the same "second implementation, not a shared
// import, because the two run in different runtimes" call apps/console's
// lib/merchant.ts already made for its own auth mirror. Keep both copies in
// sync if the offset math ever changes; there is no DST case in the MVP's
// one timezone (Asia/Bangkok) for this to silently drift on.
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
  businessDate: string;
  startUtc: Date;
  endUtc: Date;
}

export function businessDateBoundsUtc(timeZone: string, now: Date = new Date()): BusinessDateBounds {
  const businessDate = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return businessDateBoundsForDateUtc(timeZone, businessDate);
}

export function businessDateBoundsForDateUtc(timeZone: string, businessDate: string): BusinessDateBounds {
  const midnightGuessUtc = new Date(`${businessDate}T00:00:00Z`);
  const offsetMs = timeZoneOffsetMs(midnightGuessUtc, timeZone);
  const startUtc = new Date(midnightGuessUtc.getTime() - offsetMs);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { businessDate, startUtc, endUtc };
}

// The completed business day as of `now`: at 01:00 local, "today" per
// businessDateBoundsUtc(now) has already started, so the day that just
// finished — the one the nightly aggregate is meant to roll up — is the
// PREVIOUS calendar day. Recomputes the offset for that specific target date
// (via businessDateBoundsForDateUtc) rather than shifting `now` by exactly
// 24h and reusing today's offset, so this stays correct if this timezone
// ever does observe DST.
export function previousBusinessDateBoundsUtc(timeZone: string, now: Date = new Date()): BusinessDateBounds {
  const today = businessDateBoundsUtc(timeZone, now);
  const priorDate = new Date(`${today.businessDate}T00:00:00Z`);
  priorDate.setUTCDate(priorDate.getUTCDate() - 1);
  const priorBusinessDate = priorDate.toISOString().slice(0, 10);
  return businessDateBoundsForDateUtc(timeZone, priorBusinessDate);
}
