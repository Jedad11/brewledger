import * as React from "react";

// Role-free sibling of MoneyValue.tsx, safe for apps/shop (RL-3) — see that
// file for the role/size design rationale this mirrors. MoneyValue's
// ROLE_CLASS static map embeds the literal strings "money--cost" /
// "money--profit" into its own module regardless of which role a caller
// passes, so importing MoneyValue at all — even with role="plain" — puts
// those substrings in apps/shop's built client bundle. This file's whole
// point is that "money--cost"/"money--profit" never enter its module graph;
// it has no ROLE_CLASS and no MoneyRole import.

const SIZE_FONT_VAR: Record<NonNullable<PublicMoneyValueProps["size"]>, string> = {
  sm: "var(--text-2)",
  md: "var(--text-3)",
  lg: "var(--text-5)",
};

export interface PublicMoneyValueProps {
  /**
   * Satang. `null` means "unknown" and renders "—" — never coerce an
   * unknown value to 0. This prop is intentionally NOT optional
   * (`value?:`) — there is no undefined variant for a caller to silently
   * backfill with `?? 0`.
   */
  value: number | null;
  /** Default 2 — satang round-trips exactly at 2 decimal places. */
  decimals?: 0 | 2;
  /** See MoneyValue.tsx's size doc — same contextual sizing, no default. */
  size?: "sm" | "md" | "lg";
}

export function PublicMoneyValue({ value, decimals = 2, size }: PublicMoneyValueProps) {
  const style = size ? { fontSize: SIZE_FONT_VAR[size] } : undefined;

  if (value === null) {
    return (
      <span className="money money--unknown" style={style} data-testid="public-money-value">
        —
      </span>
    );
  }

  const baht = value / 100;
  const formatted =
    "฿" +
    baht.toLocaleString("th-TH", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

  const negativeClass = baht < 0 ? "money--negative" : "";

  return (
    <span className={`money ${negativeClass}`.trim()} style={style} data-testid="public-money-value">
      {formatted}
    </span>
  );
}
