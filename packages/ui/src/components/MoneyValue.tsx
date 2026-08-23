import * as React from "react";
import type { MoneyRole } from "../types";

const SIZE_FONT_VAR: Record<NonNullable<MoneyValueProps["size"]>, string> = {
  sm: "var(--text-2)",
  md: "var(--text-3)",
  lg: "var(--text-5)",
};

const ROLE_CLASS: Record<MoneyRole, string> = {
  revenue: "money--revenue",
  cost: "money--cost",
  profit: "money--profit",
  plain: "",
};

export interface MoneyValueProps {
  /**
   * Satang. `null` means "unknown" and renders "—" — never coerce an
   * unknown cost to 0 (RL-2: zero implies a 100% margin). This prop is
   * intentionally NOT optional (`value?:`) — there is no undefined variant
   * for a caller to silently backfill with `?? 0`.
   */
  value: number | null;
  role: MoneyRole;
  /**
   * Default 0 — the prototype (`console-reports.js`'s and `customer-web.js`'s
   * own `B()` helper) never shows decimal baht, and every caller in this
   * codebase relied on this default rather than passing `decimals={2}`
   * explicitly. Confirmed safe project-wide 2026-08 (see PROGRESS.md).
   */
  decimals?: 0 | 2;
  /**
   * No enum is given in component_inventory.md / P5 Handoff.md §4 — this is
   * an engineer decision point per docs/ui/design_system_port_design.md §2
   * (the `MoneyValue.size?` ambiguity), confirmed against the prototype:
   * `.money` in brewledger-tokens.css carries no size-variant class of its
   * own, size is achieved by the surrounding container (e.g. `.oc-big`).
   * 'sm'/'md'/'lg' here map onto that same --text-N scale contextually
   * rather than inventing a new class. Non-load-bearing per the design doc;
   * flagged for redline_reviewer.
   *
   * Left unset (the default), MoneyValue sets no inline font-size at all —
   * `.money` inherits whatever ambient size its container CSS establishes
   * (e.g. `.oc-big .money` at --text-8 inside MetricCard). Passing an
   * explicit size overrides that inherited size, for a caller that wants
   * this exact span sized independent of its container.
   */
  size?: "sm" | "md" | "lg";
}

export function MoneyValue({ value, role, decimals = 0, size }: MoneyValueProps) {
  const style = size ? { fontSize: SIZE_FONT_VAR[size] } : undefined;

  if (value === null) {
    return (
      <span className="money money--unknown" style={style} data-testid="money-value">
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
    <span
      className={`money ${ROLE_CLASS[role]} ${negativeClass}`.trim()}
      style={style}
      data-testid="money-value"
    >
      {formatted}
    </span>
  );
}
