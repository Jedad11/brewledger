"use client";

// WBS 5.5 — "ชำระเงิน /pay" (docs/design/state_matrix.md). The forward
// reference SlotPicker.tsx already documented ("/s/{slug}/pay/{code} is
// WBS 5.5, not built yet") is closed here.
//
// Client component, not a Server Component, same reasoning cart/page.tsx
// already established: everything this screen does — issuing the charge,
// the 15-minute countdown, the 3s poll, QRCode.toDataURL — is browser-only
// interaction with no meaningful SSR win (payment status is never stable
// at request time).
//
// state_matrix.md's "ชำระเงิน /pay" section documents three states —
// waiting, returned-from-bank (checking), expired — not four. There is no
// "confirmed" render string there, and none is invented here: confirming
// leaves this screen entirely. Once a poll (or the immediate re-check on
// tab-visible) observes the order's status is no longer PENDING_PAYMENT or
// EXPIRED, the customer is redirected to /o/{code} — the exact route
// screen_inventory.md's own table names as /pay's "next" screen. /o/{code}
// itself is WBS 5.10, not built in this entry; this is the same kind of
// forward reference SlotPicker.tsx already made to this very screen.
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Button, Card, EmptyState, PublicMoneyValue } from "@brewledger/ui";
import { createCharge, fetchOrderStatus, type PublicPaymentIntent } from "@/lib/publicApi";
import {
  BACK_LABEL,
  ERROR_MESSAGE,
  ERROR_RETRY_LABEL,
  NOT_FOUND_BODY,
  NOT_FOUND_TITLE,
  PAY_AMOUNT_LABEL,
  PAY_CHECKING_BODY,
  PAY_CHECKING_TITLE,
  PAY_EXPIRED_BODY,
  PAY_EXPIRED_TITLE,
  PAY_INSTRUCTION,
  PAY_ORDER_CODE_LABEL,
  PAY_REISSUE_LABEL,
  PAY_TITLE,
  PAY_WAITING_PREFIX,
} from "@/lib/copy";

const BACK_ARROW = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M12.5 4 6.5 10l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Statuses public_order_status can report (orders.status's full check
// constraint, packages/db/migrations/0011_orders.sql). Anything past
// PENDING_PAYMENT that isn't EXPIRED means the order moved on — paid,
// cancelled, refunded, whatever — and /o/{code} is what renders that, not
// this screen.
const STILL_PAYABLE_STATUS = "PENDING_PAYMENT";
const EXPIRED_STATUS = "EXPIRED";

type UiState = "loading" | "waiting" | "checking" | "expired" | "not_found" | "error";

function computeRemainingSeconds(expiresAt: string): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function formatCountdown(totalSeconds: number): string {
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function PayPage() {
  const params = useParams<{ slug: string; code: string }>();
  const { slug, code } = params;
  const router = useRouter();

  const [uiState, setUiState] = React.useState<UiState>("loading");
  const [intent, setIntent] = React.useState<PublicPaymentIntent | null>(null);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = React.useState(0);
  const [reissueBusy, setReissueBusy] = React.useState(false);
  const [reissueFailed, setReissueFailed] = React.useState(false);

  const issueCharge = React.useCallback(async () => {
    const result = await createCharge(code);
    if (result.kind === "ok") {
      setIntent(result.data);
      setUiState("waiting");
      return;
    }
    if (result.kind === "not_found") {
      setUiState("not_found");
      return;
    }
    if (result.kind === "not_payable") {
      // Order already left PENDING_PAYMENT before a QR was ever issued for
      // this visit (e.g. a stale/reopened link). EXPIRED still belongs on
      // this screen; anything else has moved on to /o/{code}.
      const status = await fetchOrderStatus(code);
      const row = status.kind === "ok" ? status.data[0] : undefined;
      if (row?.status === EXPIRED_STATUS) {
        setUiState("expired");
      } else if (row) {
        router.replace(`/o/${code}`);
      } else {
        setUiState("error");
      }
      return;
    }
    setUiState("error");
  }, [code, router]);

  // Initial issuance on landing at this screen. issueCharge is itself a
  // stable dependency (useCallback above), so this re-runs exactly when
  // `code` (or the router instance) changes, not on every render.
  React.useEffect(() => {
    if (!code) return;
    async function run() {
      await issueCharge();
    }
    void run();
  }, [code, issueCharge]);

  // 15-minute countdown sourced from intent.expiresAt every tick, never a
  // locally-decremented counter started at render. Gated on uiState via
  // the dependency array (not a ref read inside the interval) so the
  // effect itself only exists while the countdown is meaningful; it is
  // torn down and rebuilt on every waiting<->checking transition, which
  // happens rarely (only around a visibilitychange resolution).
  React.useEffect(() => {
    if (!intent || (uiState !== "waiting" && uiState !== "checking")) return;
    function tick() {
      const remaining = computeRemainingSeconds(intent!.expiresAt);
      setRemainingSeconds(remaining);
      if (remaining <= 0) setUiState("expired");
    }
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [intent, uiState]);

  // 3s poll while visible, plus an immediate re-check on visibilitychange
  // back to visible (the customer switching to their banking app and back
  // is the moment this matters most). Same dependency-gating as the
  // countdown effect above — only exists while uiState is waiting/checking.
  React.useEffect(() => {
    if (!intent || (uiState !== "waiting" && uiState !== "checking")) return;
    let cancelled = false;

    async function checkStatus() {
      const result = await fetchOrderStatus(code);
      if (cancelled || result.kind !== "ok") return;
      const status = result.data[0]?.status;
      if (!status) return;
      if (status === STILL_PAYABLE_STATUS) {
        // Functional updater: only resolves the transient "checking"
        // overlay back to "waiting", never disturbs any other phase this
        // callback might race against (e.g. it may resolve after the
        // countdown already moved to "expired").
        setUiState((prev) => (prev === "checking" ? "waiting" : prev));
        return;
      }
      if (status === EXPIRED_STATUS) {
        setUiState("expired");
        return;
      }
      router.replace(`/o/${code}`);
    }

    function poll() {
      if (document.visibilityState !== "visible") return;
      void checkStatus();
    }

    const id = window.setInterval(poll, 3000);

    function handleVisibility() {
      if (document.visibilityState !== "visible") return;
      setUiState((prev) => (prev === "waiting" ? "checking" : prev));
      void checkStatus();
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [intent, uiState, code, router]);

  // QR rendered client-side from the payload string. Cancelled-flag guard
  // matches StoreLinkQR.tsx's precedent (apps/console/.../link/StoreLinkQR.tsx).
  React.useEffect(() => {
    if (!intent) return;
    let cancelled = false;
    QRCode.toDataURL(intent.qrPayload, { errorCorrectionLevel: "M", margin: 2, width: 512 })
      .then((dataUrl) => {
        if (!cancelled) setQrDataUrl(dataUrl);
      })
      .catch((err) => {
        console.error("pay screen QR generation failed", err);
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [intent]);

  async function handleReissue() {
    setReissueBusy(true);
    setReissueFailed(false);
    const result = await createCharge(code);
    setReissueBusy(false);
    if (result.kind === "ok") {
      setQrDataUrl(null);
      setIntent(result.data);
      setUiState("waiting");
      return;
    }
    if (result.kind === "not_payable") {
      const status = await fetchOrderStatus(code);
      const row = status.kind === "ok" ? status.data[0] : undefined;
      if (row && row.status !== EXPIRED_STATUS) {
        router.replace(`/o/${code}`);
      }
      return;
    }
    setReissueFailed(true);
  }

  function renderBody() {
    if (uiState === "not_found") {
      return <EmptyState title={NOT_FOUND_TITLE} body={NOT_FOUND_BODY} />;
    }
    if (uiState === "error") {
      return <EmptyState title={ERROR_MESSAGE} body="" action={{ label: ERROR_RETRY_LABEL, onPress: () => void issueCharge() }} />;
    }
    if (uiState === "loading") {
      return (
        <Card>
          <div className="cw-paycard">
            <div className="cw-checking">
              <span className="spinner" aria-hidden="true" />
            </div>
          </div>
        </Card>
      );
    }
    if (uiState === "checking") {
      return (
        <Card>
          <div className="cw-paycard">
            <div className="cw-checking">
              <span className="spinner" aria-hidden="true" />
              <h3>{PAY_CHECKING_TITLE}</h3>
              <p className="note-plain">{PAY_CHECKING_BODY}</p>
            </div>
          </div>
        </Card>
      );
    }
    if (uiState === "expired") {
      return (
        <Card>
          <div className="cw-paycard">
            <div className="cw-expired">
              <h3>{PAY_EXPIRED_TITLE}</h3>
              <p className="note-plain">{PAY_EXPIRED_BODY}</p>
            </div>
            <Button variant="primary" wet loading={reissueBusy} onClick={() => void handleReissue()}>
              {PAY_REISSUE_LABEL}
            </Button>
            {reissueFailed ? <p className="err">{ERROR_MESSAGE}</p> : null}
          </div>
        </Card>
      );
    }
    // "waiting" -- intent is always set by the time uiState reaches
    // "waiting" (both are set together in the same async continuation).
    if (!intent) return null;
    return (
      <Card>
        <div className="cw-paycard">
          <p className="note-plain">{PAY_AMOUNT_LABEL}</p>
          <div className="cw-amount">
            <PublicMoneyValue value={intent.amountSatang} />
          </div>
          <div className="cw-qr">
            {qrDataUrl ? (
              <img src={qrDataUrl} alt={PAY_TITLE} />
            ) : (
              <span className="spinner" aria-hidden="true" />
            )}
          </div>
          <p className="cw-instr">{PAY_INSTRUCTION}</p>
          <div className="cw-codeline">
            {PAY_ORDER_CODE_LABEL} <b className="num" style={{ userSelect: "all" }}>{intent.orderCode}</b>
          </div>
          <div className="cw-count">
            <span className="dot" aria-hidden="true" />
            {PAY_WAITING_PREFIX}
            <b className="num">{formatCountdown(remainingSeconds)}</b>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="cw">
      <header className="cw-header">
        <Link className="back" href={`/s/${slug}/checkout`} aria-label={BACK_LABEL}>
          {BACK_ARROW}
        </Link>
        <span className="name">{PAY_TITLE}</span>
      </header>
      <div className="cw-body cw-pay">{renderBody()}</div>
    </div>
  );
}
