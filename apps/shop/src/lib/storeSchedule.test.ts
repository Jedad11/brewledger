// WBS 5.3 qa_engineer leg. Also closes a WBS 5.1 gap flagged in its own
// PROGRESS.md entry ("the pure, seam-exposed functions... that need unit
// coverage") — computeStoreOpenState/computeSlotAvailability had zero test
// coverage and apps/shop had no test infrastructure at all until this
// change (package.json's "test" script + the vitest devDependency are new
// here). Picked up opportunistically alongside groupSlotsByHour (this
// entry's own new function) since it's the same file.
import { describe, expect, it } from "vitest";
import { computeSlotAvailability, computeStoreOpenState, formatHoursLabel, groupSlotsByHour } from "./storeSchedule";

const TZ = "Asia/Bangkok";

describe("computeStoreOpenState", () => {
  it("hours not configured — never claims closed over an absence of data", () => {
    const result = computeStoreOpenState(null, null, TZ, new Date("2026-08-20T03:00:00Z"));
    expect(result).toEqual({ isOpen: true, nextOpeningLabel: null });
  });

  it("within hours (07:00 Bangkok = 00:00Z) is open", () => {
    // 08:00 Bangkok = 01:00Z, inside 07:00-19:00.
    const result = computeStoreOpenState("07:00", "19:00", TZ, new Date("2026-08-20T01:00:00Z"));
    expect(result.isOpen).toBe(true);
    expect(result.nextOpeningLabel).toBeNull();
  });

  it("before opening today shows a 'วันนี้ HH:MM' label", () => {
    // 05:00 Bangkok = 2026-08-19T22:00:00Z (before 07:00 Bangkok open).
    const result = computeStoreOpenState("07:00", "19:00", TZ, new Date("2026-08-19T22:00:00Z"));
    expect(result).toEqual({ isOpen: false, nextOpeningLabel: "วันนี้ 07:00" });
  });

  it("after closing shows a 'พรุ่งนี้ HH:MM' label", () => {
    // 20:00 Bangkok = 13:00Z, after 19:00 close.
    const result = computeStoreOpenState("07:00", "19:00", TZ, new Date("2026-08-20T13:00:00Z"));
    expect(result).toEqual({ isOpen: false, nextOpeningLabel: "พรุ่งนี้ 07:00" });
  });
});

describe("formatHoursLabel", () => {
  it("formats HH:MM–HH:MM, dropping seconds", () => {
    expect(formatHoursLabel("07:00:00", "19:00:00")).toBe("07:00–19:00");
  });
});

describe("computeSlotAvailability", () => {
  it("no slots at all — nothing today, no next label", () => {
    expect(computeSlotAvailability([], TZ, new Date("2026-08-20T01:00:00Z"))).toEqual({
      hasSlotsToday: false,
      nextSlotLabel: null,
    });
  });

  it("earliest slot is today — hasSlotsToday true, label prefixed 'วันนี้'", () => {
    const result = computeSlotAvailability(
      [{ slotStart: "2026-08-20T01:00:00Z" }], // 08:00 Bangkok, same day as "now"
      TZ,
      new Date("2026-08-20T00:30:00Z"), // 07:30 Bangkok
    );
    expect(result.hasSlotsToday).toBe(true);
    expect(result.nextSlotLabel).toBe("วันนี้ 08:00");
  });

  it("earliest slot is tomorrow — hasSlotsToday false, label prefixed 'พรุ่งนี้'", () => {
    const result = computeSlotAvailability(
      [{ slotStart: "2026-08-21T00:00:00Z" }], // 07:00 Bangkok, next day
      TZ,
      new Date("2026-08-20T13:00:00Z"), // 20:00 Bangkok today, store already closed
    );
    expect(result.hasSlotsToday).toBe(false);
    expect(result.nextSlotLabel).toBe("พรุ่งนี้ 07:00");
  });
});

describe("groupSlotsByHour", () => {
  it("groups consecutive same-hour slots into one entry, preserving chronological order", () => {
    const slots = [
      { id: "a", slotStart: "2026-08-20T01:00:00Z", remaining: 3 }, // 08:00 Bangkok
      { id: "b", slotStart: "2026-08-20T01:15:00Z", remaining: 2 }, // 08:15
      { id: "c", slotStart: "2026-08-20T01:45:00Z", remaining: 3 }, // 08:45
      { id: "d", slotStart: "2026-08-20T02:00:00Z", remaining: 3 }, // 09:00
    ];
    const groups = groupSlotsByHour(slots, TZ);

    expect(groups.map((g) => g.hourLabel)).toEqual(["08", "09"]);
    expect(groups[0].slots.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(groups[0].slots.map((s) => s.hhmm)).toEqual(["08:00", "08:15", "08:45"]);
    expect(groups[1].slots.map((s) => s.id)).toEqual(["d"]);
  });

  it("a repeated hour LATER in the list (non-contiguous input) becomes its own separate group, not merged with the earlier one", () => {
    // public-slots orders by slot_start ascending, so this shape shouldn't
    // occur across different days in practice — asserted anyway so the
    // function's actual behavior (adjacency-based grouping) is documented,
    // not assumed.
    const slots = [
      { id: "a", slotStart: "2026-08-20T01:00:00Z", remaining: 3 }, // 08:00 day 1
      { id: "b", slotStart: "2026-08-20T02:00:00Z", remaining: 3 }, // 09:00
      { id: "c", slotStart: "2026-08-21T01:00:00Z", remaining: 3 }, // 08:00 day 2
    ];
    const groups = groupSlotsByHour(slots, TZ);
    expect(groups.map((g) => g.hourLabel)).toEqual(["08", "09", "08"]);
  });

  it("empty input yields no groups", () => {
    expect(groupSlotsByHour([], TZ)).toEqual([]);
  });
});
