// Mirrors the Prisma OrderStatus enum (packages/db/prisma/schema.prisma) as
// a plain string union, so apps/shop can depend on it without depending on
// packages/db or @prisma/client at all — that dependency edge is the one
// the RL-3 import-boundary lint (eslint.config.mjs) forbids.
export const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "COLLECTED",
  "CANCELLED",
  "REFUNDED",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Only paid orders enter the store queue, notify the merchant, deduct stock,
// or appear in P&L (WBS glossary, "Paid Order").
export function isPaidStatus(status: OrderStatus): boolean {
  return status !== "PENDING_PAYMENT";
}
