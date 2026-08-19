import * as React from "react";

/**
 * Base surface, ported from `.card` in /design/brewledger-tokens.css.
 * Added per user decision (WBS 2.2 dispatch) — the prototype's unnamed
 * base card class. OrderCard composes this internally rather than
 * reimplementing the surface styling.
 */
export interface CardProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "style"> {
  children: React.ReactNode;
}

export function Card({ children, ...rest }: CardProps) {
  return (
    <div className="card" {...rest}>
      {children}
    </div>
  );
}
