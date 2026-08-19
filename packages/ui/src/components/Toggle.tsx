import * as React from "react";

/**
 * On/off switch, ported from `.oc-toggle`/`.oc-sw` in
 * `/design/Console Setup.html` -- not in the original 12-component
 * inventory. Added the same way Button/Input/Card were (WBS 2.2): the
 * prototype's own base control had no named component in
 * `component_inventory.md`, and WBS 4.3 needs it for the store-publish
 * switch (the same `.oc-sw` markup also backs the menu item availability
 * switches the prototype uses elsewhere, so this is a shared primitive, not
 * a one-off).
 *
 * A labelled row (bold title + optional plain-grey description), not a bare
 * checkbox -- every toggle in the prototype pairs the switch with inline
 * copy explaining what flipping it does.
 *
 * The `.oc-sw` button is the 44px-min hit target (interaction_spec.md line
 * 34 outranks the prototype's own 32px-tall `.oc-sw` per CLAUDE.md's
 * precedence table); `.oc-sw-track`/`.oc-sw-thumb` inside it are the visual
 * switch at its original 56x32/26px size, unchanged. See components.css.
 */
export interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  return (
    <div className="oc-toggle">
      <div>
        <b>{label}</b>
        {description ? <p className="note-plain">{description}</p> : null}
      </div>
      <button
        type="button"
        className={`oc-sw${checked ? " is-on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="oc-sw-track">
          <span className="oc-sw-thumb" />
        </span>
      </button>
    </div>
  );
}
