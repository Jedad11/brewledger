// WBS 7.1 — same "Realtime + mandatory visible-tab poll, both feeding one
// refresh() call" shape as orders/useOrdersFeed.ts (WBS 5.8). The dashboard's
// own acceptance criterion is looser than the inbox's (5s target here vs.
// the inbox's 10s-poll-alone requirement, since nothing here is gated on
// push-notification permission), so the poll below exists purely as the
// same safety net, not as a documented primary path — realtime is expected
// to carry this one in practice.
"use client";

import * as React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchDashboardSummary, type DashboardSummary } from "./fetchDashboardSummary";

const POLL_INTERVAL_MS = 10_000;

export function useDashboardSummary(
  supabase: SupabaseClient,
  storeId: string,
  timezone: string,
  initialSummary: DashboardSummary,
): DashboardSummary {
  const [summary, setSummary] = React.useState<DashboardSummary>(initialSummary);

  const refresh = React.useCallback(async () => {
    const next = await fetchDashboardSummary(supabase, storeId, timezone);
    setSummary(next);
  }, [supabase, storeId, timezone]);

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
      .channel(`dashboard-summary-${storeId}`)
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

  return summary;
}
