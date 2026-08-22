import * as React from "react";
import type { OrderStatus } from "../types";

/**
 * Exported (WBS 5.9) so the order-detail screen's status-history log can
 * render the same verbatim Thai label for a past status a `transition_order`
 * row names, rather than a second hand-copied map drifting out of sync with
 * this one — this file remains the single source for "what a status is
 * called," badge or history row alike.
 */
export const ORDER_STATUS_LABEL_TH: Record<OrderStatus, string> = {
  unpaid: "รอชำระเงิน",
  accepted: "รับออเดอร์แล้ว",
  making: "กำลังทำ",
  ready: "พร้อมรับ",
  collected: "รับแล้ว",
  cancelled: "ยกเลิก",
  refunded: "คืนเงินแล้ว",
  expired: "หมดเวลา",
};

// 8-value exhaustive map. `satisfies` makes a 9th status — added to
// OrderStatus without a matching entry here — a compile error, not a
// runtime fallback to an undefined style.
const _exhaustive: Record<OrderStatus, true> = {
  unpaid: true,
  accepted: true,
  making: true,
  ready: true,
  collected: true,
  cancelled: true,
  refunded: true,
  expired: true,
} satisfies Record<OrderStatus, true>;
void _exhaustive;

export interface OrderStatusBadgeProps {
  status: OrderStatus;
}

// `ready` is the only filled (solid-background) badge — st--ready is the
// sole status pair where fg is white-on-solid rather than a tint. Every
// other status uses a light tint background. Do not invert.
export function OrderStatusBadge({ status }: OrderStatusBadgeProps) {
  return (
    <span className={`st st--${status}`} data-testid={`order-status-badge-${status}`}>
      {ORDER_STATUS_LABEL_TH[status]}
    </span>
  );
}
