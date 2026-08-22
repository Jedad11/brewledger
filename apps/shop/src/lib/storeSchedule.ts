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

// Bug fix, post-review (flagged for redline_reviewer — WBS 5.3/5.4 were
// already `done`/`needs review` when this was found): `generate_pickup_slots_for_store`
// (0028) generates `days_ahead=7` by default and `public-slots` returns
// every open future slot with no date filter, so a real store's standing
// 7-day window hands groupSlotsByHour ~560 rows spanning 7 calendar days.
// groupSlotsByHour itself only ever grouped by 2-digit hour-of-day with no
// notion of which day a slot fell on, so "07" from today and "07" from six
// days later rendered as two separate, identically-labelled headers, and
// the picker became an unbounded, undifferentiated wall of ~140 tiny
// buttons over 15,000px of scroll — confirmed live via Playwright against a
// real 562-slot seeded dataset.
//
// The delivered prototype (design/customer-web.js's scCheckout, ~line
// 78-88) only ever renders one day's worth of hour-grouped slots — its
// SLOTS mock is a single day — and docs/design/state_matrix.md's own
// "เลือกเวลารับ /checkout" section names the "All full" state
// `วันนี้เต็มทุกช่วงเวลาแล้ว` ("today is completely full"), i.e. the
// documented default view IS today, with the existing all-full notice
// already the intended path to "come back later" rather than a second,
// undocumented multi-day browsing UI. Neither state_matrix.md nor
// interaction_spec.md nor component_inventory.md mentions a day picker or
// day-level header anywhere. Fix: filter to today's slots (store-local
// calendar day) before grouping by hour — groupSlotsByHour's own contract
// is untouched (still adjacency-based hour-only grouping, still assumes a
// single day's worth of input) since day-scoping happens one step earlier,
// in the new filterSlotsForToday. This is the smaller of the two
// defensible fixes named in the fix brief (single day vs. multi-day list
// with headers) — it needs no new component, no new Thai string beyond the
// วันนี้/พรุ่งนี้ vocabulary already established in this same file's
// computeStoreOpenState/computeSlotAvailability, and it makes the "All
// full" notice's own title finally true (it used to fire only when EVERY
// future slot across all 7 days was gone, never when just today was —
// SlotPicker.tsx's allFull was `slots.length === 0` over the unfiltered
// list). If a genuine pre-order-multiple-days-ahead browsing UI is wanted
// later, that is new scope, not a bug fix, and belongs in its own WBS
// entry with its own state_matrix.md section.
export function filterSlotsForToday<T extends { slotStart: string }>(
  slots: T[],
  timezone: string,
  now: Date = new Date(),
): T[] {
  const todayKey = partsInTimeZone(now, timezone).dateKey;
  return slots.filter((slot) => partsInTimeZone(new Date(slot.slotStart), timezone).dateKey === todayKey);
}

export interface SlotHourGroup {
  /** "08" — 2-digit hour, store-local, per the prototype's `${g.h} น.` heading (design/customer-web.js scCheckout). */
  hourLabel: string;
  slots: { id: string; hhmm: string; remaining: number }[];
}

// WBS 5.3 — groups public-slots' flat, already-filtered (open/future/
// non-full — RLS's doing, see publicApi.ts's PublicSlot comment) list by
// store-local hour, for the /checkout picker. Slots are already ordered by
// slot_start ascending (public-slots' own .order call) so groups come out
// in chronological order for free without a separate sort here. Callers
// must pre-filter to a single calendar day (see filterSlotsForToday above)
// — this function has no day awareness of its own, by design, so its
// existing adjacency-based grouping stays simple and its existing tests
// stay valid.
export function groupSlotsByHour(
  slots: { id: string; slotStart: string; remaining: number }[],
  timezone: string,
): SlotHourGroup[] {
  const groups: SlotHourGroup[] = [];
  for (const slot of slots) {
    const parts = partsInTimeZone(new Date(slot.slotStart), timezone);
    const hourLabel = parts.hhmm.slice(0, 2);
    const last = groups[groups.length - 1];
    const entry = { id: slot.id, hhmm: parts.hhmm, remaining: slot.remaining };
    if (last && last.hourLabel === hourLabel) {
      last.slots.push(entry);
    } else {
      groups.push({ hourLabel, slots: [entry] });
    }
  }
  return groups;
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

// WBS 5.10 — `/o/{code}`'s pickup-time line. `public_order_status`/
// `public_order_lookup` return `pickup_at` with no accompanying store
// timezone (that screen deliberately reads nothing but the RPC — see its
// own header comment), unlike every other caller in this file, which has a
// real `stores.timezone` in hand. Every store's `timezone` defaults to, and
// today can only ever be, 'Asia/Bangkok' (packages/db/migrations/
// 0003_stores.sql; no settings screen exists to change it) — hardcoded here
// for that reason, not as a guess.
export function formatPickupTimeLabel(pickupAtIso: string): string {
  return `${partsInTimeZone(new Date(pickupAtIso), "Asia/Bangkok").hhmm} น.`;
}
