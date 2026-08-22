"use client";

// WBS 5.9 — /console/orders/{id}. Authored screen (no counterpart in
// docs/design/state_matrix.md — see copy.ts's own header note); structure
// and copy sourced from design/owner-console.js's scDetail(), adapted:
// the prototype's `o.log` is static seed data, this reads the real
// order_status_history table (WBS 5.7) via fetchOrderDetail.ts. The cancel
// button scDetail() always renders is OMITTED here — WBS 5.11 (order
// cancellation) is not built yet, and a button with no working handler is
// worse than no button (same reasoning OrderCard's own doc comment gives
// for its onCancel prop).
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
import { advanceOrder } from "../actions";
import type { OrderDetail } from "../fetchOrderDetail";
import {
  DETAIL_BACK,
  DETAIL_CONTACT_TITLE,
  DETAIL_CONTACT_MISSING,
  DETAIL_CALL_CUSTOMER,
  DETAIL_HISTORY_TITLE,
  CUPS_SUFFIX,
} from "../copy";

export function OrderDetailClient({ order }: { order: OrderDetail }) {
  const router = useRouter();
  const [statusOverride, setStatusOverride] = React.useState<UiOrderStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

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

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <header className="oc-top">
        <button type="button" className="btn btn--quiet" onClick={() => router.push("/console/orders")}>
          {DETAIL_BACK}
        </button>
        <div>
          <h1 className="num font-serif text-3xl font-bold leading-[1.35] text-ink">{order.code}</h1>
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
      </div>
    </main>
  );
}
