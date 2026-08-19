import * as React from "react";

/**
 * The merchant taps this with a wet hand while holding a milk jug, then
 * looks away — 56px minimum, full width, is non-negotiable. `minHeight` and
 * `optimistic` are TypeScript numeric/boolean LITERAL types, not `number`/
 * `boolean`: `<StatusButton minHeight={44} .../>` is a compile error, and a
 * caller cannot construct a non-optimistic instance of this specific
 * component (interaction_spec.md's optimistic-update convention for the
 * daily loop). Deliberately has NO `style`/`className`/`...rest` escape
 * hatch onto the root element — either of those could override min-height
 * via CSS and silently reopen the hole the literal type closes. A caller
 * needing a differently-styled button reaches for `Button` instead.
 */
export interface StatusButtonProps {
  label: string;
  onPress: () => void;
  minHeight: 56;
  optimistic: true;
  disabled?: boolean;
}

export function StatusButton({ label, onPress, disabled }: StatusButtonProps) {
  return (
    <button
      type="button"
      className="btn btn--primary btn--wet"
      onClick={onPress}
      disabled={disabled}
      data-testid="status-button"
    >
      {label}
    </button>
  );
}
