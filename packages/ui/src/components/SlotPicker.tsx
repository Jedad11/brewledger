import * as React from "react";

export interface Slot {
  time: string; // "08:15"
  remaining: number;
}

export interface SlotPickerProps {
  slots: Slot[];
  /** Selected time, or null before a choice is made. */
  value: string | null;
  onChange: (time: string) => void;
  /** Default 2, per state_matrix "เหลือ N ที่" when remaining <= this. */
  showRemainingBelow?: number;
  /** Caller-supplied Thai copy — state_matrix.md gives "วันนี้เต็มทุกช่วงเวลาแล้ว" as the specific string for /checkout. */
  fullMessage: string;
}

// A remaining:0 slot is never omitted from the list — it renders disabled,
// inline, with fullMessage-style unavailability, rather than vanishing
// (docs/ui/design_system_port_design.md §2). No hardcoded slot count.
export function SlotPicker({
  slots,
  value,
  onChange,
  showRemainingBelow = 2,
  fullMessage,
}: SlotPickerProps) {
  const allFull = slots.length > 0 && slots.every((s) => s.remaining === 0);

  if (allFull) {
    return (
      <div className="cw-notice" data-testid="slot-picker-full">
        <b>{fullMessage}</b>
      </div>
    );
  }

  return (
    <div className="cw-slotg" data-testid="slot-picker">
      <div className="cw-slots">
        {slots.map((slot) => {
          const isFull = slot.remaining === 0;
          const isOn = value === slot.time;
          return (
            <button
              key={slot.time}
              type="button"
              className={`cw-slot${isOn ? " is-on" : ""}${isFull ? " is-full" : ""}`}
              disabled={isFull}
              onClick={() => !isFull && onChange(slot.time)}
              data-testid={`slot-${slot.time}`}
            >
              <b className="num">{slot.time}</b>
              {slot.remaining <= showRemainingBelow && !isFull ? (
                <span className="note-plain">เหลือ {slot.remaining} ที่</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
