"use client";

// WBS 5.8 — the working-queue inbox: realtime + poll (useOrdersFeed.ts),
// the persistent unseen banner/marker, the audible cue with its mute
// toggle, the push subscribe flow (asked only once real value exists), and
// the iOS home-screen hint. Card rendering deliberately omits
// onAdvance/onCancel/onOpen — see OrderCard's own doc comment
// (packages/ui/src/components/OrderCard.tsx) for why: those actions belong
// to WBS 5.9/5.11, not built yet, and a tap target with no working handler
// is worse than the button not existing.
import * as React from "react";
import { OrderCard, Toggle, type OrderSummary } from "@brewledger/ui";
import { createClient } from "@/lib/supabase/client";
import { useOrdersFeed } from "./useOrdersFeed";
import { toUiOrderStatus } from "./statusMap";
import { isUnseen } from "./unseen";
import { playNewOrderCue } from "./audibleCue";
import { isIosNonStandalone } from "./pushSupport";
import { registerServiceWorker, requestPushSubscription } from "./pushSubscribe";
import { markOrdersSeen, setNotifySoundMuted } from "./actions";
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
} from "./copy";

function toOrderSummary(order: WorkingOrder): OrderSummary {
  return {
    id: order.id,
    code: order.code,
    status: toUiOrderStatus(order.status),
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
  const [lastSeenAt, setLastSeenAt] = React.useState(initialLastSeenAt);
  const [muted, setMuted] = React.useState(initialMuted);
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

      {slotGroups.map(([pickupTime, group], i) => (
        <section key={pickupTime} className="oc-group">
          <div className="oc-grouphead">
            <h3>
              {pickupTime} น.
              {i === 0 ? <span className="oc-nearest">{NEAREST_SLOT_PILL}</span> : null}
            </h3>
          </div>
          {group.map((order) => (
            <OrderCard
              key={order.id}
              order={toOrderSummary(order)}
              variant="inbox"
              showNextAction={false}
              unseen={isUnseen(order.arrivedAt, lastSeenAt)}
            />
          ))}
        </section>
      ))}
    </section>
  );
}
