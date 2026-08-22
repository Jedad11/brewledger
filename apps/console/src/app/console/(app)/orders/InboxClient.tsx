"use client";

// WBS 5.8 built the working-queue inbox: realtime + poll (useOrdersFeed.ts),
// the persistent unseen banner/marker, the audible cue with its mute
// toggle, the push subscribe flow (asked only once real value exists), and
// the iOS home-screen hint. It deliberately left onAdvance/onCancel/onOpen
// unwired — see OrderCard's own doc comment (packages/ui/src/components/
// OrderCard.tsx) for why. WBS 5.9 (this change) wires onAdvance/onOpen;
// onCancel stays unwired — WBS 5.11 (order cancellation) is not built yet,
// and an omitted handler correctly omits its button (same reasoning
// OrderCard's own comment already gives).
import * as React from "react";
import { useRouter } from "next/navigation";
import { OrderCard, Toggle, type OrderSummary } from "@brewledger/ui";
import type { OrderStatus as UiOrderStatus } from "@brewledger/ui";
import { createClient } from "@/lib/supabase/client";
import { useOrdersFeed } from "./useOrdersFeed";
import { toUiOrderStatus, nextDbStatusFor, nextUiStatusFor } from "./statusMap";
import { isUnseen } from "./unseen";
import { playNewOrderCue } from "./audibleCue";
import { isIosNonStandalone } from "./pushSupport";
import { registerServiceWorker, requestPushSubscription } from "./pushSubscribe";
import { markOrdersSeen, setNotifySoundMuted, advanceOrder, bulkMarkReady } from "./actions";
import type { WorkingOrder } from "./fetchWorkingQueue";
import {
  NEW_ORDERS_BANNER,
  NEW_ORDERS_ACK,
  NEAREST_SLOT_PILL,
  CUPS_SUFFIX,
  NOTIFY_DENIED_HINT,
  NOTIFY_IOS_HINT,
  MUTE_TOGGLE_LABEL,
  MUTE_TOGGLE_DESCRIPTION,
  BULK_READY_LABEL,
  BULK_READY_TOTAL_FAILURE,
  bulkReadyPartialResult,
} from "./copy";

function toOrderSummary(order: WorkingOrder, statusOverride?: UiOrderStatus): OrderSummary {
  return {
    id: order.id,
    code: order.code,
    status: statusOverride ?? toUiOrderStatus(order.status),
    itemsSummary: `${order.cups} ${CUPS_SUFFIX}`,
    items: order.items,
    pickupTime: order.pickupTime,
    totalSatang: order.totalSatang,
    cups: order.cups,
    customerName: order.customerName,
  };
}

export function InboxClient({
  storeId,
  initialOrders,
  initialLastSeenAt,
  initialMuted,
}: {
  storeId: string;
  initialOrders: WorkingOrder[];
  initialLastSeenAt: string | null;
  initialMuted: boolean;
}) {
  const supabase = React.useMemo(() => createClient(), []);
  const router = useRouter();
  const [lastSeenAt, setLastSeenAt] = React.useState(initialLastSeenAt);
  const [muted, setMuted] = React.useState(initialMuted);

  // WBS 5.9 — optimistic status overrides, keyed by order id. Applied on
  // tap, before the network round-trip resolves (interaction_spec.md line
  // 13: the merchant looks away immediately, a spinner they never see is
  // useless). Cleared either by the reconciliation effect below (the real
  // feed confirms the target, via realtime/poll/the response itself) or,
  // on a failed request, immediately by handleAdvance/handleBulkReady —
  // "the badge reverts" is this override being removed so the card falls
  // back to rendering the real `orders` status.
  const [overrideStatus, setOverrideStatus] = React.useState<Record<string, UiOrderStatus>>({});
  const [cardError, setCardError] = React.useState<Record<string, string>>({});
  const [bulkBusy, setBulkBusy] = React.useState<Set<string>>(new Set());
  const [bulkResult, setBulkResult] = React.useState<Record<string, string>>({});
  const [notifyPermission, setNotifyPermission] = React.useState<NotificationPermission | "unsupported">(
    "unsupported",
  );
  const [showIosHint, setShowIosHint] = React.useState(false);
  const askedRef = React.useRef(false);

  const handleRefreshed = React.useCallback(
    (next: WorkingOrder[], previousIds: ReadonlySet<string>) => {
      const hasNewArrival = next.some((o) => !previousIds.has(o.id));
      if (hasNewArrival && !muted) {
        playNewOrderCue();
      }
    },
    [muted],
  );

  const orders = useOrdersFeed(supabase, storeId, initialOrders, handleRefreshed);

  // Reconciliation: once the real feed (realtime event, the 10s poll, or
  // this very request's own response landing) shows an order at the status
  // an optimistic tap already predicted — or the order has left the working
  // queue entirely, which is exactly what happens when READY -> COLLECTED
  // succeeds (WORKING_QUEUE_STATUSES, statusMap.ts, no longer includes it)
  // — the override is redundant and is dropped so the card goes back to
  // rendering the real row directly.
  React.useEffect(() => {
    // Deferred a microtask, not called synchronously in the effect body --
    // same reason the registerServiceWorker effect below does (react-hooks/
    // set-state-in-effect): reading `orders` here is genuinely synchronous,
    // but the setState call itself still shouldn't be the first synchronous
    // statement this effect runs.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setOverrideStatus((prev) => {
        if (Object.keys(prev).length === 0) return prev;
        let changed = false;
        const next = { ...prev };
        for (const id of Object.keys(prev)) {
          const real = orders.find((o) => o.id === id);
          if (!real || toUiOrderStatus(real.status) === prev[id]) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [orders]);

  async function handleAdvance(orderId: string) {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const currentUiStatus = toUiOrderStatus(order.status);
    const dbTarget = nextDbStatusFor(currentUiStatus);
    const uiTarget = nextUiStatusFor(currentUiStatus);
    if (!dbTarget || !uiTarget) return; // no legal next action -- OrderCard itself would not have rendered a button for this status

    setCardError((prev) => {
      if (!(orderId in prev)) return prev;
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
    setOverrideStatus((prev) => ({ ...prev, [orderId]: uiTarget }));

    const result = await advanceOrder(orderId, dbTarget);

    if (!result.ok) {
      // Roll back visibly: drop the override so the badge reverts to the
      // real (unchanged) status, and show a persistent inline message next
      // to THIS card -- never a vanishing toast (interaction_spec.md line 13).
      setOverrideStatus((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      setCardError((prev) => ({ ...prev, [orderId]: result.error }));
    }
  }

  function handleOpen(orderId: string) {
    router.push(`/console/orders/${orderId}`);
  }

  async function handleBulkReady(groupKey: string, groupOrders: WorkingOrder[]) {
    const eligible = groupOrders.filter((o) => o.status === "ACCEPTED" || o.status === "PREPARING");
    if (eligible.length === 0 || bulkBusy.has(groupKey)) return;

    setBulkBusy((prev) => new Set(prev).add(groupKey));
    setBulkResult((prev) => {
      if (!(groupKey in prev)) return prev;
      const next = { ...prev };
      delete next[groupKey];
      return next;
    });
    setOverrideStatus((prev) => {
      const next = { ...prev };
      for (const o of eligible) next[o.id] = "ready";
      return next;
    });

    const result = await bulkMarkReady(eligible.map((o) => o.id));

    setBulkBusy((prev) => {
      const next = new Set(prev);
      next.delete(groupKey);
      return next;
    });

    if (!result.ok) {
      setOverrideStatus((prev) => {
        const next = { ...prev };
        for (const o of eligible) delete next[o.id];
        return next;
      });
      setBulkResult((prev) => ({ ...prev, [groupKey]: BULK_READY_TOTAL_FAILURE }));
      return;
    }

    const failed = result.results.filter((r) => !r.ok);
    if (failed.length > 0) {
      setOverrideStatus((prev) => {
        const next = { ...prev };
        for (const r of failed) delete next[r.orderId];
        return next;
      });
      const failedCodes = failed.map((r) => eligible.find((o) => o.id === r.orderId)?.code ?? r.orderId);
      const successCount = result.results.length - failed.length;
      setBulkResult((prev) => ({ ...prev, [groupKey]: bulkReadyPartialResult(successCount, failedCodes) }));
    }
  }

  React.useEffect(() => {
    void registerServiceWorker();
    // Deferred a microtask, not called synchronously in the effect body --
    // same reason StoreLinkQR.tsx's own QR-generation effect only ever
    // calls setState from inside a .then()/.catch() (react-hooks/set-state-
    // in-effect): these two reads (navigator.userAgent, Notification.
    // permission) are genuinely synchronous, but the setState calls
    // themselves still shouldn't be the first synchronous statements this
    // effect runs.
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setShowIosHint(isIosNonStandalone());
      if (typeof Notification !== "undefined") {
        setNotifyPermission(Notification.permission);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Ask for permission once real value exists (at least one order already
  // sitting in the queue), never on a bare, order-less page load — a
  // permission prompt before any value is delivered gets denied and cannot
  // be re-asked (WBS 5.8). Fires at most once per mount, and only from the
  // browser's 'default' (not yet asked) state.
  React.useEffect(() => {
    if (askedRef.current || orders.length === 0) return;
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    askedRef.current = true;
    void requestPushSubscription().then(() => {
      if (typeof Notification !== "undefined") setNotifyPermission(Notification.permission);
    });
  }, [orders.length]);

  // "A revoked or expired subscription is detected and re-requested without
  // breaking the inbox" — opportunistic, silent (permission is already
  // granted so no prompt appears), re-creates the subscription if the
  // browser dropped it since the last visit.
  React.useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    void requestPushSubscription();
  }, []);

  async function handleAck() {
    const now = new Date().toISOString();
    setLastSeenAt(now);
    await markOrdersSeen();
  }

  async function handleMuteChange(soundOn: boolean) {
    setMuted(!soundOn);
    await setNotifySoundMuted(!soundOn);
  }

  const unseenCount = orders.filter((o) => isUnseen(o.arrivedAt, lastSeenAt)).length;

  const slotGroups = React.useMemo(() => {
    const byTime = new Map<string, WorkingOrder[]>();
    for (const order of orders) {
      const list = byTime.get(order.pickupTime) ?? [];
      list.push(order);
      byTime.set(order.pickupTime, list);
    }
    return [...byTime.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }, [orders]);

  return (
    <section data-testid="orders-inbox" className="flex flex-col gap-3">
      {unseenCount > 0 ? (
        <div className="oc-banner" data-testid="new-orders-banner">
          <span>{NEW_ORDERS_BANNER(unseenCount)}</span>
          <button type="button" className="btn" onClick={() => void handleAck()}>
            {NEW_ORDERS_ACK}
          </button>
        </div>
      ) : null}

      {notifyPermission === "denied" ? (
        <p className="note-plain" data-testid="notify-denied-hint">
          {NOTIFY_DENIED_HINT}
        </p>
      ) : null}
      {showIosHint ? (
        <p className="note-plain" data-testid="ios-push-hint">
          {NOTIFY_IOS_HINT}
        </p>
      ) : null}

      <Toggle
        label={MUTE_TOGGLE_LABEL}
        description={MUTE_TOGGLE_DESCRIPTION}
        checked={!muted}
        onChange={(checked) => void handleMuteChange(checked)}
      />

      {slotGroups.map(([pickupTime, group], i) => {
        // Bulk-ready only makes sense for a real shared slot -- a group
        // keyed "-" (no pickup_slot_id, e.g. a cash-sale order with no
        // reserved slot at all) has no single "this pickup slot" the button
        // label refers to.
        const hasRealSlot = group.some((o) => o.pickupSlotId !== null);
        const bulkEligibleCount = group.filter((o) => o.status === "ACCEPTED" || o.status === "PREPARING").length;
        return (
          <section key={pickupTime} className="oc-group">
            <div className="oc-grouphead">
              <h3>
                {pickupTime} น.
                {i === 0 ? <span className="oc-nearest">{NEAREST_SLOT_PILL}</span> : null}
              </h3>
              {hasRealSlot && bulkEligibleCount > 0 ? (
                <button
                  type="button"
                  className="btn btn--quiet"
                  disabled={bulkBusy.has(pickupTime)}
                  onClick={() => void handleBulkReady(pickupTime, group)}
                  data-testid="bulk-ready-button"
                >
                  {BULK_READY_LABEL}
                </button>
              ) : null}
            </div>
            {bulkResult[pickupTime] ? (
              <p role="alert" className="err" data-testid="bulk-ready-result">
                {bulkResult[pickupTime]}
              </p>
            ) : null}
            {group.map((order) => (
              <div key={order.id}>
                <OrderCard
                  order={toOrderSummary(order, overrideStatus[order.id])}
                  variant="inbox"
                  showNextAction={true}
                  unseen={isUnseen(order.arrivedAt, lastSeenAt)}
                  onAdvance={() => void handleAdvance(order.id)}
                  onOpen={handleOpen}
                />
                {cardError[order.id] ? (
                  <p role="alert" className="err" data-testid="order-card-error">
                    {cardError[order.id]}
                  </p>
                ) : null}
              </div>
            ))}
          </section>
        );
      })}
    </section>
  );
}
