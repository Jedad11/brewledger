// Shared type vocabulary for @brewledger/ui. See docs/ui/design_system_port_design.md §2.

/** Money role — used by MoneyValue and MetricCard. */
export type MoneyRole = "revenue" | "cost" | "profit" | "plain";

export type OrderStatus =
  | "unpaid"
  | "accepted"
  | "making"
  | "ready"
  | "collected"
  | "cancelled"
  | "refunded"
  | "expired";
