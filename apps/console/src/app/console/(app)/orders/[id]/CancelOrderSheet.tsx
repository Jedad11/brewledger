"use client";

// WBS 5.11 — cancel-reason picker + confirm sheet, two dismissible steps
// per interaction_spec.md:18 ("reason picker → confirm sheet → refund
// state. Two steps, both dismissible."). Markup/CSS classes mirror
// design/owner-console.js's own cancelSheet() inside the same
// .oc-scrim/.oc-sheet wrapper QuickSaleOptionSheet.tsx already uses (WBS
// 5.12) — not a new sheet primitive, the established pattern for this
// console.
import * as React from "react";
import {
  CANCEL_REASONS,
  CANCEL_REASON_SHEET_TITLE,
  CANCEL_REASON_NEXT_LABEL,
  CANCEL_REASON_CLOSE_LABEL,
  CANCEL_CONFIRM_TITLE,
  CANCEL_CONFIRM_REFUND_NOTE,
  CANCEL_CONFIRM_YES,
  CANCEL_CONFIRM_NO,
  cancelReasonLabel,
  cancelConfirmOrderLine,
  type CancelReasonCode,
} from "../copy";

export interface CancelOrderSheetProps {
  orderCode: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: (reason: CancelReasonCode) => void;
}

export function CancelOrderSheet({ orderCode, busy, onClose, onConfirm }: CancelOrderSheetProps) {
  const [reason, setReason] = React.useState<CancelReasonCode | null>(null);
  const [step, setStep] = React.useState<"reason" | "confirm">("reason");

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <>
      <div className="oc-scrim" onClick={onClose} data-testid="cancel-sheet-scrim" />
      {step === "reason" ? (
        <div className="oc-sheet" role="dialog" aria-modal="true" aria-label={CANCEL_REASON_SHEET_TITLE}>
          <h3>{CANCEL_REASON_SHEET_TITLE}</h3>
          <div className="oc-reasons">
            {CANCEL_REASONS.map((r) => (
              <button
                key={r.code}
                type="button"
                className={`cw-opt${reason === r.code ? " is-on" : ""}`}
                aria-pressed={reason === r.code}
                onClick={() => setReason(r.code)}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`btn btn--danger btn--wet${reason ? "" : " is-disabled"}`}
            disabled={!reason}
            onClick={() => setStep("confirm")}
          >
            {CANCEL_REASON_NEXT_LABEL}
          </button>
          <button type="button" className="btn btn--quiet" onClick={onClose}>
            {CANCEL_REASON_CLOSE_LABEL}
          </button>
        </div>
      ) : (
        <div className="oc-sheet" role="dialog" aria-modal="true" aria-label={CANCEL_CONFIRM_TITLE}>
          <h3>{CANCEL_CONFIRM_TITLE}</h3>
          <p className="note-plain">
            {cancelConfirmOrderLine(orderCode, cancelReasonLabel(reason as CancelReasonCode))}
            <br />
            {CANCEL_CONFIRM_REFUND_NOTE}
          </p>
          <button
            type="button"
            className="btn btn--danger btn--wet"
            disabled={busy}
            onClick={() => reason && onConfirm(reason)}
          >
            {CANCEL_CONFIRM_YES}
          </button>
          <button type="button" className="btn btn--quiet" disabled={busy} onClick={onClose}>
            {CANCEL_CONFIRM_NO}
          </button>
        </div>
      )}
    </>
  );
}
