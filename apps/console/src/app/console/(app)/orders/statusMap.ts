// WBS 5.8 — `orders.status` (DB, packages/db/migrations/0011_orders.sql:
// PENDING_PAYMENT/ACCEPTED/PREPARING/READY/COLLECTED/CANCELLED/REFUNDED/
// EXPIRED) and packages/ui's `OrderStatus` (display union: unpaid/accepted/
// making/ready/collected/cancelled/refunded/expired, packages/ui/src/
// types.ts) are two different vocabularies for the same 8 states — OrderCard
// has never had a real caller before this entry, so no mapping between them
// existed yet. One direction only (DB -> display): nothing in this app
// writes a status by name, everything goes through transitionOrder's own
// literal DB values (WBS 5.7).
import type { OrderStatus as UiOrderStatus } from "@brewledger/ui";

const DB_TO_UI_STATUS: Record<string, UiOrderStatus> = {
  PENDING_PAYMENT: "unpaid",
  ACCEPTED: "accepted",
  PREPARING: "making",
  READY: "ready",
  COLLECTED: "collected",
  CANCELLED: "cancelled",
  REFUNDED: "refunded",
  EXPIRED: "expired",
};

export function toUiOrderStatus(dbStatus: string): UiOrderStatus {
  return DB_TO_UI_STATUS[dbStatus] ?? "unpaid";
}

// The inbox's working queue (WBS 5.8) — orders the merchant is actively
// handling. PENDING_PAYMENT has its own section (WBS 5.6); COLLECTED/
// CANCELLED/REFUNDED/EXPIRED are terminal and drop off the queue.
export const WORKING_QUEUE_STATUSES = ["ACCEPTED", "PREPARING", "READY"] as const;
