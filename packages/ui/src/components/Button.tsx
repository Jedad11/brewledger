import * as React from "react";

/**
 * Base button, ported from `.btn`/`.btn--*` in /design/brewledger-tokens.css.
 * Added per user decision (WBS 2.2 dispatch): the prototype has an unnamed
 * `.btn` base class with no entry in the 12-component inventory — this is
 * the generic button every other button-shaped component (StatusButton)
 * builds on top of, not a replacement for StatusButton's 56px/optimistic
 * contract.
 */
export type ButtonVariant = "primary" | "dark" | "outline" | "quiet" | "danger";

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "style"> {
  variant?: ButtonVariant;
  /** Matches `.btn--wet` — full width, 56px min-height, larger type. */
  wet?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}

export function Button({
  variant = "primary",
  wet = false,
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    `btn--${variant}`,
    wet ? "btn--wet" : "",
    loading ? "is-loading" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {children}
    </button>
  );
}
