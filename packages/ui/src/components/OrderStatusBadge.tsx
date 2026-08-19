import * as React from "react";
import type { OrderStatus } from "../types";

const STATUS_LABEL_TH: Record<OrderStatus, string> = {
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
      {STATUS_LABEL_TH[status]}
    </span>
  );
}
