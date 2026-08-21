"use client";

// WBS 5.6 — "รอยืนยันการชำระเงิน". Field priority, controls, and the
// two-step reject confirmation all come from docs/design/state_matrix.md's
// own "ออเดอร์ /console/orders" section (added in the same change as this
// file) -- see that file for why each choice is not invented here.
import * as React from "react";
import { Card, Button, StatusButton, MoneyValue, EmptyState } from "@brewledger/ui";
import { confirmPayment, rejectPayment } from "./actions";
import {
  PENDING_SECTION_TITLE,
  PENDING_EMPTY,
  CONFIRM_LABEL,
  REJECT_LABEL,
  REJECT_CONFIRM_PROMPT,
  REJECT_CONFIRM_YES,
  REJECT_CONFIRM_CANCEL,
  EXPIRES_IN_PREFIX,
  EXPIRED_LABEL,
} from "./copy";

export interface PendingOrder {
  id: string;
  orderCode: string;
  customerName: string;
  totalSatang: number;
  pickupSlotStart: string | null;
  expiresAt: string | null;
}

function formatPickupTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

function formatCountdown(expiresAt: string | null, nowMs: number): string {
  if (!expiresAt) return EXPIRED_LABEL;
  const remainingMs = new Date(expiresAt).getTime() - nowMs;
  if (remainingMs <= 0) return EXPIRED_LABEL;
  const totalSeconds = Math.floor(remainingMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${EXPIRES_IN_PREFIX} ${mm}:${ss}`;
}

function PendingCard({ order, onResolved }: { order: PendingOrder; onResolved: (orderId: string) => void }) {
  const [nowMs, setNowMs] = React.useState(() => Date.now());
  const [busy, setBusy] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const expired = formatCountdown(order.expiresAt, nowMs) === EXPIRED_LABEL;
  const pickupTime = formatPickupTime(order.pickupSlotStart);

  async function handleConfirm() {
    setError(null);
    // Optimistic per interaction_spec.md's general convention: the control
    // goes inert THE INSTANT it's tapped (StatusButton's own optimistic:true
    // contract), before the network round-trip resolves. The card itself
    // leaves the list only on a confirmed success, not before -- removing it
    // immediately and rolling back on failure would hide this exact card's
    // own error message the instant it appears, the opposite of "persistent
    // inline message, never a vanishing toast".
    setBusy(true);
    const result = await confirmPayment(order.id);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    onResolved(order.id);
  }

  async function handleReject() {
    setError(null);
    setBusy(true);
    const result = await rejectPayment(order.id);
    if (!result.ok) {
      setBusy(false);
      setRejecting(false);
      setError(result.error);
      return;
    }
    onResolved(order.id);
  }

  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid="pending-payment-card">
        <MoneyValue value={order.totalSatang} role="revenue" size="lg" />
        <p className="note-plain">{order.customerName}</p>
        <p className="num oc-code">{order.orderCode}</p>
        {pickupTime ? <p className="note-plain">รับ {pickupTime} น.</p> : null}
        <p className="note-plain" aria-live="polite">
          {formatCountdown(order.expiresAt, nowMs)}
        </p>

        {error ? (
          <p role="alert" className="err">
            {error}
          </p>
        ) : null}

        <StatusButton
          label={CONFIRM_LABEL}
          onPress={handleConfirm}
          minHeight={56}
          optimistic={true}
          disabled={busy || expired}
        />

        {rejecting ? (
          <div className="flex flex-col gap-2">
            <p className="note-plain">{REJECT_CONFIRM_PROMPT}</p>
            <div className="flex gap-2">
              <Button type="button" variant="danger" onClick={handleReject} disabled={busy}>
                {REJECT_CONFIRM_YES}
              </Button>
              <Button type="button" variant="quiet" onClick={() => setRejecting(false)} disabled={busy}>
                {REJECT_CONFIRM_CANCEL}
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="danger" onClick={() => setRejecting(true)} disabled={busy}>
            {REJECT_LABEL}
          </Button>
        )}
      </div>
    </Card>
  );
}

export function PendingPaymentSection({ orders }: { orders: PendingOrder[] }) {
  const [resolvedIds, setResolvedIds] = React.useState<Set<string>>(new Set());

  const visible = orders.filter((order) => !resolvedIds.has(order.id));

  function markResolved(orderId: string) {
    setResolvedIds((prev) => {
      const next = new Set(prev);
      next.add(orderId);
      return next;
    });
  }

  return (
    <section data-testid="pending-payment-section" className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-bold leading-[1.35] text-ink">{PENDING_SECTION_TITLE}</h2>
      {visible.length === 0 ? (
        <EmptyState title={PENDING_EMPTY} body="" />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((order) => (
            <PendingCard key={order.id} order={order} onResolved={markResolved} />
          ))}
        </div>
      )}
    </section>
  );
}
