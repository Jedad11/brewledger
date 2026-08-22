"use client";

// WBS 5.10 — "ติดตามออเดอร์ /o/{code}" (docs/design/state_matrix.md, section
// extended for this entry — see its own comments and gaps.md's GAP-8/GAP-9).
//
// Data comes ONLY from public-order-status's code-only branch
// (public_order_status RPC) via fetchOrderStatus — never a direct `orders`
// query, which anon has no RLS policy for at all (deliberately, WBS 3.6).
// No store slug is available anywhere in this screen's data (the RPC's
// allow-list has none), so there is no back button and no "back to menu"
// link on any state here — see state_matrix.md's own Collected entry for
// why a link to `/` would be worse than none (that route is an unrelated
// pre-existing placeholder, not a real destination).
//
// Realtime is deliberately NOT wired here, despite the WBS 5.10 Claude Code
// Prompt's own §2 asking for "a Realtime subscription as the fast path":
// Supabase Realtime's postgres_changes gates delivery on the SAME RLS the
// subscribing role would need for a plain SELECT, and `orders` carries
// zero anon SELECT policies by design — docs/db/rls_design.md's own §6
// asserts "exactly four" anon SELECT policies as a structural invariant a
// dedicated proof (0020_rl1_structural_proof.sql) and a repo-wide test
// (packages/db/tests/rls.test.ts) both check. Adding a fifth anon policy on
// `orders` to unlock Realtime here is a schema-and-RLS decision, not screen
// work — flagged for architect/redline_reviewer rather than added
// unprompted. The 5s poll below is the WBS's own "RELIABLE path" and
// satisfies "status changes appear within 5 seconds" (WBS 5.10 acceptance)
// on its own, with no fast-path optimisation layered on top.
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, EmptyState } from "@brewledger/ui";
import { fetchOrderStatus, type PublicOrderStatusRow } from "@/lib/publicApi";
import { formatPickupTimeLabel } from "@/lib/storeSchedule";
import {
  TRACK_ORDER_TITLE,
  ORDER_CODE_LABEL,
  pickupTimeLabel,
  ORDER_PROGRESS_STEPS,
  ORDER_ITEMS_TITLE,
  ORDER_COLLECTED_TITLE,
  ORDER_COLLECTED_BODY,
  ORDER_PENDING_PAYMENT_TITLE,
  ORDER_PENDING_PAYMENT_BODY,
  ORDER_CANCELLED_TITLE,
  ORDER_REFUNDED_BODY,
  ORDER_EXPIRED_TITLE,
  ORDER_EXPIRED_BODY,
  ORDER_NOT_FOUND_TITLE,
  ORDER_NOT_FOUND_BODY,
  FIND_ORDER_LABEL,
  ERROR_MESSAGE,
  ERROR_RETRY_LABEL,
} from "@/lib/copy";

const POLL_INTERVAL_MS = 5000;

type Phase =
  | "loading"
  | "pending_payment"
  | "active"
  | "collected"
  | "cancelled"
  | "refunded"
  | "expired"
  | "not_found"
  | "error";

const TERMINAL_PHASES: ReadonlySet<Phase> = new Set([
  "collected",
  "cancelled",
  "refunded",
  "expired",
  "not_found",
]);

function phaseFromStatus(status: string): Phase {
  switch (status) {
    case "PENDING_PAYMENT":
      return "pending_payment";
    case "ACCEPTED":
    case "PREPARING":
    case "READY":
      return "active";
    case "COLLECTED":
      return "collected";
    case "CANCELLED":
      return "cancelled";
    case "REFUNDED":
      return "refunded";
    case "EXPIRED":
      return "expired";
    default:
      return "error";
  }
}

function stepIndexFromStatus(status: string): number {
  if (status === "PREPARING") return 1;
  if (status === "READY") return 2;
  if (status === "COLLECTED") return 3;
  return 0; // ACCEPTED
}

export default function OrderTrackPage() {
  const params = useParams<{ code: string }>();
  const code = params.code;
  const router = useRouter();

  const [phase, setPhase] = React.useState<Phase>("loading");
  const [rows, setRows] = React.useState<PublicOrderStatusRow[] | null>(null);

  const load = React.useCallback(async () => {
    const result = await fetchOrderStatus(code);
    if (result.kind !== "ok") {
      // Only the INITIAL fetch surfaces "error" — a transient poll failure
      // once the screen is already showing real data leaves the last-known
      // state on screen and simply retries next interval, same posture as
      // /pay's own poll loop.
      setPhase((prev) => (prev === "loading" ? "error" : prev));
      return;
    }
    if (result.data.length === 0) {
      setRows(null);
      setPhase("not_found");
      return;
    }
    setRows(result.data);
    setPhase(phaseFromStatus(result.data[0].status));
  }, [code]);

  React.useEffect(() => {
    if (!code) return;
    async function run() {
      await load();
    }
    void run();
  }, [code, load]);

  React.useEffect(() => {
    if (phase === "loading" || phase === "error" || TERMINAL_PHASES.has(phase)) return;
    function poll() {
      if (document.visibilityState !== "visible") return;
      void load();
    }
    const id = window.setInterval(poll, POLL_INTERVAL_MS);
    function handleVisibility() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [phase, load]);

  function renderTerm(title: string, body?: string) {
    return (
      <Card>
        <div className="cw-paycard">
          <p className="note-plain">
            {ORDER_CODE_LABEL} <b className="num">{code}</b>
          </p>
          <h3 style={{ marginTop: ".8rem" }}>{title}</h3>
          {body ? (
            <p className="note-plain" style={{ marginTop: ".8rem" }}>
              {body}
            </p>
          ) : null}
        </div>
      </Card>
    );
  }

  function renderBody() {
    if (phase === "loading") {
      return (
        <Card>
          <div className="cw-checking">
            <span className="spinner" aria-hidden="true" />
          </div>
        </Card>
      );
    }
    if (phase === "error") {
      return (
        <EmptyState
          title={ERROR_MESSAGE}
          body=""
          action={{ label: ERROR_RETRY_LABEL, onPress: () => void load() }}
        />
      );
    }
    if (phase === "not_found") {
      return (
        <EmptyState
          title={ORDER_NOT_FOUND_TITLE}
          body={ORDER_NOT_FOUND_BODY}
          action={{ label: FIND_ORDER_LABEL, onPress: () => router.push("/track") }}
        />
      );
    }
    if (phase === "pending_payment") {
      return renderTerm(ORDER_PENDING_PAYMENT_TITLE, ORDER_PENDING_PAYMENT_BODY);
    }
    if (phase === "cancelled") {
      return renderTerm(ORDER_CANCELLED_TITLE);
    }
    if (phase === "refunded") {
      return renderTerm(ORDER_CANCELLED_TITLE, ORDER_REFUNDED_BODY);
    }
    if (phase === "expired") {
      return renderTerm(ORDER_EXPIRED_TITLE, ORDER_EXPIRED_BODY);
    }

    // active / collected — rows is always set by the time either phase is
    // reached (both are only entered from phaseFromStatus, which only runs
    // after `setRows(result.data)` in the same synchronous update).
    if (!rows) return null;
    const status = rows[0].status;
    const currentStep = stepIndexFromStatus(status);

    return (
      <>
        <Card>
          <p className="note-plain">{ORDER_CODE_LABEL}</p>
          <div className="cw-code num">{rows[0].orderCode}</div>
          {rows[0].pickupAt ? (
            <p className="note-plain">{pickupTimeLabel(formatPickupTimeLabel(rows[0].pickupAt))}</p>
          ) : null}
        </Card>
        <Card>
          <div className="cw-steps">
            {ORDER_PROGRESS_STEPS.map((step, i) => (
              <div
                key={step}
                className={`cw-stepitem${i < currentStep ? " is-done" : ""}${i === currentStep ? " is-now" : ""}`}
              >
                <span className="cw-dot">{i < currentStep ? "✓" : ""}</span>
                <span>{step}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <h4>{ORDER_ITEMS_TITLE}</h4>
          {rows.map((row, i) => (
            <div className="cw-sumline" key={i}>
              <span>{row.itemName}</span>
              <b className="num">× {row.quantity}</b>
            </div>
          ))}
        </Card>
        {phase === "collected" ? (
          <Card>
            <h4>{ORDER_COLLECTED_TITLE}</h4>
            <p className="note-plain">{ORDER_COLLECTED_BODY}</p>
          </Card>
        ) : null}
      </>
    );
  }

  return (
    <div className="cw">
      <header className="cw-header">
        <span className="name">{TRACK_ORDER_TITLE}</span>
      </header>
      <div className="cw-body">{renderBody()}</div>
    </div>
  );
}
