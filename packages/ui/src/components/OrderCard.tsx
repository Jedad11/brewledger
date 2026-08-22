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
export interface OrderLineItem {
  name: string;
  /** Pre-formatted option summary, e.g. "เย็น · หวานน้อย". Omitted when the item has no options. */
  optionsLabel?: string;
  quantity: number;
}

export interface OrderSummary {
  id: string;
  code: string;
  status: OrderStatus;
  /** Pre-formatted, e.g. "2 แก้ว". */
  itemsSummary: string;
  /**
   * Full line-item breakdown (name, options, qty) per WBS 5.8's inbox card
   * ("item lines with options and quantity") and /design/Owner Console.html's
   * own `orderCard()` `.oc-items` block. Optional — a caller that only has
   * itemsSummary (no line-level data fetched) still renders a valid card.
   */
  items?: OrderLineItem[];
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
  /**
   * All three optional: a caller renders only the affordances it has a real,
   * working handler for. An omitted handler simply omits its button — WBS
   * 5.8 (the inbox) deliberately does not wire onAdvance/onCancel/onOpen
   * (those actions belong to WBS 5.9/5.11's own detail screen and cancel
   * flow, not yet built) rather than render a button that does nothing when
   * tapped with a wet hand.
   */
  onAdvance?: (orderId: string) => void;
  onCancel?: (orderId: string) => void;
  onOpen?: (orderId: string) => void;
}

/**
 * WBS 5.9 — the verb for the single legal next tap, not a generic
 * "continue". Sourced verbatim from `design/owner-console.js`'s own `NEXT`
 * map (`docs/design/interaction_spec.md` line 13 confirms the same three
 * strings) — a status absent here (unpaid/collected/cancelled/refunded/
 * expired) has no legal forward transition a merchant drives from this
 * card, so it gets no button, regardless of what the caller passes for
 * showNextAction/onAdvance. This is the SAME guarantee "illegal
 * transitions are never offered in the UI at all" needs, enforced here
 * too (not only by which props WBS 5.9's callers choose to pass) so it
 * cannot regress if a future caller wires onAdvance for a terminal status
 * by mistake.
 */
export const NEXT_ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  accepted: "เริ่มทำ",
  making: "พร้อมรับ",
  ready: "รับแล้ว",
};

export function OrderCard({
  order,
  variant,
  showNextAction,
  unseen,
  onAdvance,
  onCancel,
  onOpen,
}: OrderCardProps) {
  const nextActionLabel = NEXT_ACTION_LABEL[order.status];
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

      {order.items && order.items.length > 0 ? (
        <div className="oc-items">
          {order.items.map((item, i) => (
            <div className="oc-item" key={i}>
              <span>
                {item.name}
                {item.optionsLabel ? (
                  <>
                    <br />
                    <span className="note-plain">{item.optionsLabel}</span>
                  </>
                ) : null}
              </span>
              <b className="num">× {item.quantity}</b>
            </div>
          ))}
        </div>
      ) : null}

      <div className="oc-ordertot">
        <span className="note-plain">{order.itemsSummary}</span>
        <MoneyValue value={order.totalSatang} role="revenue" />
      </div>

      {showNextAction && onAdvance && nextActionLabel ? (
        <button
          type="button"
          className="btn btn--primary btn--wet"
          onClick={() => onAdvance(order.id)}
          data-testid="order-card-advance"
        >
          {nextActionLabel}
        </button>
      ) : null}

      {(variant === "inbox" && onOpen) || onCancel ? (
        <div className="oc-orderfoot">
          {variant === "inbox" && onOpen ? (
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => onOpen(order.id)}
              data-testid="order-card-open"
            >
              ดูรายละเอียด
            </button>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              className="btn btn--quiet oc-cancel"
              onClick={() => onCancel(order.id)}
              data-testid="order-card-cancel"
            >
              ยกเลิกออเดอร์
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
