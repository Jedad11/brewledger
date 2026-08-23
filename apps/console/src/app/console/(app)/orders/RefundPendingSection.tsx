"use client";

// WBS 5.11 — "รอคืนเงิน". Placed below the working queue, above completed
// orders (there is no completed-orders list on this page today, so this
// renders last) -- persists until every entry is resolved: never collapses
// by default, never ages out, no dismiss/ignore control. The only way a row
// leaves this list is a successful โอนคืนแล้ว tap. Same client-side-removal
// pattern as PendingPaymentSection.tsx (WBS 5.6): the server write already
// succeeded before a row is removed, so removal here is confirmation, not
// speculation.
import * as React from "react";
import { Card, StatusButton, MoneyValue, EmptyState } from "@brewledger/ui";
import { resolveRefund } from "./actions";
import {
  REFUND_SECTION_TITLE,
  REFUND_SECTION_EMPTY,
  REFUND_HELPER_LINE,
  REFUND_RESOLVE_LABEL,
  REFUND_COPY_PHONE_LABEL,
  REFUND_COPY_SUCCESS,
  REFUND_COPY_FAILED,
  refundOutstandingDays,
} from "./copy";
import type { RefundPendingOrder } from "./fetchRefundPending";

function PhoneCopyButton({ phone }: { phone: string }) {
  const [status, setStatus] = React.useState<"idle" | "success" | "error">("idle");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(phone);
      setStatus("success");
    } catch (err) {
      console.error("copy refund customer phone failed", err);
      setStatus("error");
    }
    window.setTimeout(() => setStatus("idle"), 2500);
  }

  return (
    <div className="flex items-center gap-2">
      <b className="num">{phone}</b>
      <button type="button" className="btn btn--outline" onClick={() => void handleCopy()}>
        {status === "success" ? REFUND_COPY_SUCCESS : REFUND_COPY_PHONE_LABEL}
      </button>
      {status === "error" ? (
        <p role="alert" className="err">
          {REFUND_COPY_FAILED}
        </p>
      ) : null}
    </div>
  );
}

function RefundPendingCard({
  order,
  onResolved,
}: {
  order: RefundPendingOrder;
  onResolved: (orderId: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleResolve() {
    setError(null);
    setBusy(true);
    const result = await resolveRefund(order.id);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    onResolved(order.id);
  }

  return (
    <Card>
      <div className="flex flex-col gap-2" data-testid="refund-pending-card">
        <MoneyValue value={order.totalSatang} role="revenue" size="lg" />
        {order.customerPhone ? <PhoneCopyButton phone={order.customerPhone} /> : null}
        <p className="note-plain">{order.customerName}</p>
        <p className="num oc-code">{order.orderCode}</p>
        <p className="note-plain">{refundOutstandingDays(order.daysOutstanding)}</p>
        <p className="note-plain">{REFUND_HELPER_LINE}</p>

        {error ? (
          <p role="alert" className="err">
            {error}
          </p>
        ) : null}

        <StatusButton label={REFUND_RESOLVE_LABEL} onPress={handleResolve} minHeight={56} optimistic={true} disabled={busy} />
      </div>
    </Card>
  );
}

export function RefundPendingSection({ orders }: { orders: RefundPendingOrder[] }) {
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
    <section data-testid="refund-pending-section" className="flex flex-col gap-3">
      <h2 className="font-serif text-2xl font-bold leading-[1.35] text-ink">{REFUND_SECTION_TITLE}</h2>
      {visible.length === 0 ? (
        <EmptyState title={REFUND_SECTION_EMPTY} body="" />
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((order) => (
            <RefundPendingCard key={order.id} order={order} onResolved={markResolved} />
          ))}
        </div>
      )}
    </section>
  );
}
