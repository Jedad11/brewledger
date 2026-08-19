import * as React from "react";

// Fixed string per state_matrix.md §"ตรวจบิล" — one exact copy, not a
// caller-supplied message (unlike SlotPicker.fullMessage, which varies by
// context per the state matrix).
const LOW_CONFIDENCE_HINT = "ตัวเลขอาจอ่านไม่ชัด ตรวจอีกครั้ง";

export interface ConfidenceFieldProps {
  label: string;
  /** Controlled input string — numeric parsing to satang/grams is the caller's job. */
  value: string;
  confidence: "high" | "low";
  unit?: string;
  onChange: (value: string) => void;
  /** Low-confidence fields are first in focus order on the review screen. */
  autoFocusIfLow: boolean;
}

export function ConfidenceField({
  label,
  value,
  confidence,
  unit,
  onChange,
  autoFocusIfLow,
}: ConfidenceFieldProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const isLow = confidence === "low";

  React.useEffect(() => {
    if (isLow && autoFocusIfLow) {
      inputRef.current?.focus();
    }
    // Only re-run if the low+autofocus condition itself changes — not on
    // every keystroke (`value` is deliberately excluded from the deps list).
  }, [isLow, autoFocusIfLow]);

  return (
    <div className={`field bl-confidence-field${isLow ? " is-low" : ""}`}>
      <label>{label}</label>
      <input
        ref={inputRef}
        className="input"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={isLow || undefined}
      />
      {unit ? <span className="note-plain">{unit}</span> : null}
      {isLow ? (
        /* "!" badge is rendered by .bl-confidence-field__hint::before in
           components.css, matching design/Console Reports.html's
           .oc-lowtag::before — not a DOM span, so it isn't duplicated here. */
        <span className="bl-confidence-field__hint" role="alert">
          {LOW_CONFIDENCE_HINT}
        </span>
      ) : null}
    </div>
  );
}
