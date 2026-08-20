// WBS 5.1 — pure, dependency-free store-hours and pickup-slot-availability
// math for the public store page. Uses Intl.DateTimeFormat against the
// store's IANA timezone (stores.timezone, e.g. "Asia/Bangkok") instead of a
// date library — correct across DST with nothing added to the client bundle
// budget. `stores.opens_at`/`closes_at` are bare Postgres `time` values
// (e.g. "07:00:00") with no timezone of their own — they mean local
// wall-clock time at the pickup address, so they're compared directly
// against the current wall-clock time computed in the store's timezone.
//
// No day-of-week field exists on `stores` (see docs/design/state_matrix.md's
// "Opening-hours line" note) — every day uses the same opens/closes window.
// Overnight-spanning hours (e.g. opens 22:00, closes 02:00) are out of scope:
// no BrewLedger pilot shop operates past midnight, and the schema gives no
// signal to distinguish that case from a same-day window entered backwards.

function partsInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";

  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutesSinceMidnight: Number(get("hour")) * 60 + Number(get("minute")),
    hhmm: `${get("hour")}:${get("minute")}`,
  };
}

function minutesFromTimeString(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export interface StoreOpenState {
  isOpen: boolean;
  /** Thai "วันนี้ HH:MM" / "พรุ่งนี้ HH:MM" label — null only when hours aren't set. */
  nextOpeningLabel: string | null;
}

export function computeStoreOpenState(
  opensAt: string | null,
  closesAt: string | null,
  timezone: string,
  now: Date = new Date(),
): StoreOpenState {
  // Hours not configured yet — never claim "closed" over an absence of data.
  if (!opensAt || !closesAt) {
    return { isOpen: true, nextOpeningLabel: null };
  }

  const openMinutes = minutesFromTimeString(opensAt);
  const closeMinutes = minutesFromTimeString(closesAt);
  const current = partsInTimeZone(now, timezone);
  const isOpen = current.minutesSinceMidnight >= openMinutes && current.minutesSinceMidnight < closeMinutes;

  if (isOpen) {
    return { isOpen: true, nextOpeningLabel: null };
  }

  const opensLaterToday = current.minutesSinceMidnight < openMinutes;
  const hhmm = opensAt.slice(0, 5);
  return {
    isOpen: false,
    nextOpeningLabel: opensLaterToday ? `วันนี้ ${hhmm}` : `พรุ่งนี้ ${hhmm}`,
  };
}

export function formatHoursLabel(opensAt: string, closesAt: string): string {
  return `${opensAt.slice(0, 5)}–${closesAt.slice(0, 5)}`;
}

export interface SlotAvailabilityState {
  hasSlotsToday: boolean;
  /** Thai day/time label for the earliest upcoming slot, or null if there are none at all. */
  nextSlotLabel: string | null;
}

// `slots` must already be ordered by slot_start ascending (public-slots
// queries with .order("slot_start", { ascending: true })) — the first entry
// is treated as the earliest open, future, non-full slot. A slot missing
// from this list entirely (past, closed, or at capacity) is RLS's doing
// (docs/security/rls.md's pickup_slots anon policy), not this function's —
// there is no capacity/booked_count field here to recompute it from (RL-3).
export function computeSlotAvailability(
  slots: { slotStart: string }[],
  timezone: string,
  now: Date = new Date(),
): SlotAvailabilityState {
  if (slots.length === 0) {
    return { hasSlotsToday: false, nextSlotLabel: null };
  }

  const todayKey = partsInTimeZone(now, timezone).dateKey;
  const hasSlotsToday = slots.some(
    (slot) => partsInTimeZone(new Date(slot.slotStart), timezone).dateKey === todayKey,
  );

  const earliest = partsInTimeZone(new Date(slots[0].slotStart), timezone);
  const tomorrowKey = partsInTimeZone(addDays(now, 1), timezone).dateKey;
  const dayLabel = earliest.dateKey === todayKey ? "วันนี้" : earliest.dateKey === tomorrowKey ? "พรุ่งนี้" : null;

  return {
    hasSlotsToday,
    nextSlotLabel: dayLabel ? `${dayLabel} ${earliest.hhmm}` : earliest.hhmm,
  };
}
