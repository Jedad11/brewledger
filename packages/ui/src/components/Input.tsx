import * as React from "react";

/**
 * Base text input, ported from `.field`/`.input`/`.err` in
 * /design/brewledger-tokens.css. Added per user decision (WBS 2.2 dispatch)
 * alongside Button and Card — the prototype's unnamed base field pattern.
 * ConfidenceField is a distinct, higher-level component (owns its own low-
 * confidence copy and focus behaviour) and does not reuse this one
 * internally, to keep that component's contract self-contained per the
 * architect's design.
 */
export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "className" | "style"> {
  label?: string;
  error?: string;
  valid?: boolean;
}

export function Input({ label, error, valid, id, ...rest }: InputProps) {
  const inputId = id ?? React.useId();
  const stateClass = error ? "is-error" : valid ? "is-valid" : "";

  return (
    <div className="field">
      {label ? <label htmlFor={inputId}>{label}</label> : null}
      <input id={inputId} className={`input ${stateClass}`.trim()} {...rest} />
      {error ? <span className="err">{error}</span> : null}
    </div>
  );
}
