"use client";

// WBS 5.9 — /console/orders/{id}. Authored screen (no counterpart in
// docs/design/state_matrix.md until WBS 5.11 — see copy.ts's own header
// note); structure and copy sourced from design/owner-console.js's
// scDetail(), adapted: the prototype's `o.log` is static seed data, this
// reads the real order_status_history table (WBS 5.7) via
// fetchOrderDetail.ts. WBS 5.11 wires the cancel button and the
// cancelled/refunded informational card scDetail() always renders, both
// deliberately omitted until now (see this file's own prior header note,
// preserved in git history).
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  OrderStatusBadge,
  MoneyValue,
  StatusButton,
  ORDER_STATUS_LABEL_TH,
  NEXT_ACTION_LABEL,
  type OrderStatus as UiOrderStatus,
} from "@brewledger/ui";
import { toUiOrderStatus, nextDbStatusFor, nextUiStatusFor } from "../statusMap";
import { advanceOrder, cancelOrder } from "../actions";
import type { OrderDetail } from "../fetchOrderDetail";
import { CancelOrderSheet } from "./CancelOrderSheet";
import {
  DETAIL_BACK,
  DETAIL_CONTACT_TITLE,
  DETAIL_CONTACT_MISSING,
  DETAIL_CALL_CUSTOMER,
  DETAIL_HISTORY_TITLE,
  DETAIL_CANCEL_BUTTON,
  DETAIL_REFUND_PENDING_TITLE,
  DETAIL_REFUND_PENDING_BODY,
  DETAIL_REFUND_DONE_TITLE,
  DETAIL_REFUND_DONE_BODY,
  CUPS_SUFFIX,
  type CancelReasonCode,
} from "../copy";

export function OrderDetailClient({ order }: { order: OrderDetail }) {
  const router = useRouter();
  const [statusOverride, setStatusOverride] = React.useState<UiOrderStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [showCancelSheet, setShowCancelSheet] = React.useState(false);
  // Set only by a cancel THIS SCREEN just performed -- distinct from
  // order.refundStatus (the server-fetched value for an order already
  // terminal before this page loaded). Only ACCEPTED/PREPARING/READY are
  // cancellable from here (see `cancellable` below), all three paid states,
  // so a cancel reaching this line always owes a refund by construction --
  // no need to read the RPC's own echoed refund_status back.
  const [justCancelledReason, setJustCancelledReason] = React.useState<CancelReasonCode | null>(null);

  const realUiStatus = toUiOrderStatus(order.status);
  const displayStatus = statusOverride ?? realUiStatus;
  const dbTarget = nextDbStatusFor(realUiStatus);
  const uiTarget = nextUiStatusFor(realUiStatus);
  // Keyed by the CURRENT status, not the target -- these are two different
  // Thai vocabularies that only coincide for two of the three pairs
  // (making->ready both say "พร้อมรับ", ready->collected both say
  // "รับแล้ว") and diverge for the third: NEXT_ACTION_LABEL["accepted"] is
  // the verb "เริ่มทำ" ("start making"), not ORDER_STATUS_LABEL_TH["making"]
  // ("กำลังทำ", "in progress") -- the button says what tapping it DOES, the
  // badge says what state IS. Only relevant while no override is in flight
  // -- once one succeeds the page's own server data is stale until the
  // merchant navigates back and returns (no client poll on this
  // single-order screen; the working queue list it was opened from already
  // polls/subscribes, WBS 5.8).
  const nextActionLabel = !statusOverride && dbTarget && uiTarget ? NEXT_ACTION_LABEL[realUiStatus] : null;

  async function handleAdvance() {
    if (!dbTarget || !uiTarget) return;
    setError(null);
    setStatusOverride(uiTarget);
    setBusy(true);

    const result = await advanceOrder(order.id, dbTarget);

    setBusy(false);
    if (!result.ok) {
      setStatusOverride(null);
      setError(result.error);
      return;
    }
    // Left in place (not reset to null): the real order row on the server
    // now matches uiTarget, so continuing to render the override is
    // correct until the merchant navigates and this page re-fetches from
    // the server, same "confirm on next real read" posture as
    // InboxClient's reconciliation effect uses its own live feed for.
  }

  // Only ACCEPTED/PREPARING/READY may be cancelled from the console (WBS
  // 5.11 guard-rail bullet 1) -- the console UI's own scope, per
  // docs/db/wbs_5_11_refund_design.md §3 ("console_cancel_order does not
  // restrict which orders.status may be cancelled... the WBS's own
  // guard-rail bullet 1 is the console UI's own scope"). `statusOverride`
  // being set (an advance in flight, or a cancel that already succeeded)
  // disables this the same way it already disables the advance button.
  const cancellable = !statusOverride && (realUiStatus === "accepted" || realUiStatus === "making" || realUiStatus === "ready");

  // refund_status, never cancel_reason's mere presence, gates which card
  // renders below -- same rule the customer-facing tracking page enforces
  // (docs/db/wbs_5_11_refund_design.md §4). order.refundStatus covers an
  // order that was already terminal when this page loaded; justCancelledReason
  // covers a cancel this screen itself just performed (see its own comment).
  const effectiveRefundStatus = justCancelledReason ? "pending" : order.refundStatus;

  async function handleCancelConfirm(reason: CancelReasonCode) {
    setError(null);
    setBusy(true);
    const result = await cancelOrder(order.id, reason);
    setBusy(false);
    if (!result.ok) {
      setShowCancelSheet(false);
      setError(result.error);
      return;
    }
    setStatusOverride("cancelled");
    setJustCancelledReason(reason);
    setShowCancelSheet(false);
  }

  return (
    <div className="oc-body">
      <header className="oc-top">
        <button type="button" className="btn btn--quiet" onClick={() => router.push("/console/orders")}>
          {DETAIL_BACK}
        </button>
        <div>
          <h1 className="num">{order.code}</h1>
          <p className="note-plain">
            {order.customerName} · รับ {order.pickupTime} น.
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-3">
        <Card>
          <div className="oc-orderhead">
            <OrderStatusBadge status={displayStatus} />
            <MoneyValue value={order.totalSatang} role="revenue" />
          </div>
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
          <p className="note-plain">
            {order.cups} {CUPS_SUFFIX}
          </p>

          {error ? (
            <p role="alert" className="err" data-testid="order-detail-error">
              {error}
            </p>
          ) : null}

          {nextActionLabel ? (
            <StatusButton label={nextActionLabel} onPress={() => void handleAdvance()} minHeight={56} optimistic={true} disabled={busy} />
          ) : null}
        </Card>

        <Card>
          <h3>{DETAIL_CONTACT_TITLE}</h3>
          {order.customerPhone ? (
            <>
              <p className="note-plain">
                {order.customerName} · <b className="num">{order.customerPhone}</b>
              </p>
              <a className="btn btn--outline" href={`tel:${order.customerPhone.replace(/-/g, "")}`}>
                {DETAIL_CALL_CUSTOMER}
              </a>
            </>
          ) : (
            <p className="note-plain">{DETAIL_CONTACT_MISSING}</p>
          )}
        </Card>

        <Card>
          <h3>{DETAIL_HISTORY_TITLE}</h3>
          <div className="oc-log">
            {order.history.map((entry, i) => (
              <div className="oc-logrow" key={i}>
                <b className="num">{entry.time}</b>
                <span>{ORDER_STATUS_LABEL_TH[toUiOrderStatus(entry.toStatus)]}</span>
              </div>
            ))}
          </div>
        </Card>

        {effectiveRefundStatus === "pending" ? (
          <Card>
            <h3>{DETAIL_REFUND_PENDING_TITLE}</h3>
            <p className="note-plain">{DETAIL_REFUND_PENDING_BODY}</p>
          </Card>
        ) : effectiveRefundStatus === "done" ? (
          <Card>
            <h3>{DETAIL_REFUND_DONE_TITLE}</h3>
            <p className="note-plain">{DETAIL_REFUND_DONE_BODY}</p>
          </Card>
        ) : cancellable ? (
          <button
            type="button"
            className="btn btn--danger"
            style={{ width: "100%" }}
            disabled={busy}
            onClick={() => setShowCancelSheet(true)}
          >
            {DETAIL_CANCEL_BUTTON}
          </button>
        ) : null}
      </div>

      {showCancelSheet ? (
        <CancelOrderSheet
          orderCode={order.code}
          busy={busy}
          onClose={() => setShowCancelSheet(false)}
          onConfirm={(reason) => void handleCancelConfirm(reason)}
        />
      ) : null}
    </div>
  );
}
