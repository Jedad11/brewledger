import * as React from "react";
import { OrderStatusBadge } from "./OrderStatusBadge";
import { MoneyValue } from "./MoneyValue";
import type { OrderStatus } from "../types";

/**
 * Field-by-field DTO, not a DB row spread — same discipline as WBS 3.7's
 * public serializer, applied here so apps/shop's usage of OrderCard never
 * pulls a cost/margin field in transitively via a wider `order` shape.
 * Deliberately excludes totalCostSatang/marginSatang/any /cost|margin|
 * profit/ field — packages/ui has no visibility into which app renders a
 * given instance, so the type itself must not carry a field that would make
 * an accidental cost render possible. RL-3.
 */
export interface OrderSummary {
  id: string;
  code: string;
  status: OrderStatus;
  /** Pre-formatted, e.g. "2 รายการ". */
  itemsSummary: string;
  pickupTime: string;
  totalSatang: number;
  cups: number;
  /** Console-only display; the component carries no gate — the gate is which app is allowed to pass this prop. */
  customerName?: string;
}

export interface OrderCardProps {
  order: OrderSummary;
  variant: "inbox" | "detail";
  showNextAction: boolean;
  unseen: boolean;
  onAdvance: (orderId: string) => void;
  onCancel: (orderId: string) => void;
  onOpen: (orderId: string) => void;
}

export function OrderCard({
  order,
  variant,
  showNextAction,
  unseen,
  onAdvance,
  onCancel,
  onOpen,
}: OrderCardProps) {
  return (
    <div
      className={`card oc-order${unseen ? " is-new" : ""}`}
      data-testid="order-card"
      data-variant={variant}
    >
      <div className="oc-orderhead">
        <div>
          <b className="num oc-code">{order.code}</b>
          {order.customerName ? (
            <p className="note-plain">
              {order.customerName} · รับ {order.pickupTime} น.
            </p>
          ) : (
            <p className="note-plain">รับ {order.pickupTime} น.</p>
          )}
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      <div className="oc-ordertot">
        <span className="note-plain">{order.itemsSummary}</span>
        <MoneyValue value={order.totalSatang} role="revenue" />
      </div>

      {showNextAction ? (
        <button
          type="button"
          className="btn btn--primary btn--wet"
          onClick={() => onAdvance(order.id)}
          data-testid="order-card-advance"
        >
          ดำเนินการต่อ
        </button>
      ) : null}

      <div className="oc-orderfoot">
        {variant === "inbox" ? (
          <button
            type="button"
            className="btn btn--quiet"
            onClick={() => onOpen(order.id)}
            data-testid="order-card-open"
          >
            ดูรายละเอียด
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--quiet oc-cancel"
          onClick={() => onCancel(order.id)}
          data-testid="order-card-cancel"
        >
          ยกเลิกออเดอร์
        </button>
      </div>
    </div>
  );
}
