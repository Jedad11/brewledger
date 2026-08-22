// WBS 5.8 — Supabase Realtime + a mandatory 10s visible-tab poll, both
// feeding the SAME refresh() call. Deduplication is structural, not a merge
// algorithm: fetchWorkingQueue always returns the full, current, id-keyed
// working queue, and every trigger (realtime event, poll tick, initial
// mount) replaces the whole array via setOrders(next) rather than appending
// to it — so a realtime event and a poll tick landing together can only
// ever produce one render with one card per order id, never two.
//
// The poll is NOT gated on push permission (interaction_spec.md: "poll
// every 10s while the tab is open when denied -- this is the primary path
// for iPhone users, not a fallback nicety") and runs whenever the document
// is visible, permission state notwithstanding — this is what the
// acceptance criterion "a paid order appears within 10 seconds... with push
// permission denied" is actually asserting.
"use client";

import * as React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchWorkingQueue, type WorkingOrder } from "./fetchWorkingQueue";

const POLL_INTERVAL_MS = 10_000;

export function useOrdersFeed(
  supabase: SupabaseClient,
  storeId: string,
  initialOrders: WorkingOrder[],
  onRefreshed?: (orders: WorkingOrder[], previousIds: ReadonlySet<string>) => void,
): WorkingOrder[] {
  const [orders, setOrders] = React.useState<WorkingOrder[]>(initialOrders);

  // Synced in an effect (post-render), never during render itself
  // (react-hooks/refs) — refresh() below is an imperative callback invoked
  // from a timer/realtime event, never from render, so reading and mutating
  // via this ref there is safe; it exists only so refresh() can know "the
  // orders as of right before this fetch" without retriggering itself every
  // time `orders` changes (it would, if `orders` were a dependency instead).
  const ordersRef = React.useRef(orders);
  React.useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  const refresh = React.useCallback(async () => {
    const previousIds = new Set(ordersRef.current.map((o) => o.id));
    const next = await fetchWorkingQueue(supabase, storeId);
    setOrders(next);
    onRefreshed?.(next, previousIds);
  }, [supabase, storeId, onRefreshed]);

  React.useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void refresh();
      }, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh();
        start();
      } else {
        stop();
      }
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  React.useEffect(() => {
    const channel = supabase
      .channel(`orders-inbox-${storeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${storeId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase, storeId, refresh]);

  return orders;
}
