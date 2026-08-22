"use client";

// WBS 5.10 — "ค้นหาออเดอร์ /track" (docs/design/state_matrix.md, section
// added for this entry — see gaps.md's GAP-8). Ported from
// design/customer-web.js's scFind() (lines 123-128).
//
// Security property, not a UX nicety (WBS 5.10's own Claude Code Prompt
// §3): a phone number alone must never return an order. The submit button
// stays disabled until BOTH fields are non-empty, so there is no code path
// in this component that can call fetchOrderLookup with only one of the
// two filled in — and public_order_lookup itself (packages/db/migrations/
// 0021_rls.sql, 0037_normalize_order_lookup_phone.sql) requires an exact
// match on both columns regardless, so this is belt-and-braces, not the
// only enforcement point.
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Button } from "@brewledger/ui";
import { fetchOrderLookup } from "@/lib/publicApi";
import {
  FIND_ORDER_LABEL,
  TRACK_INTRO,
  CUSTOMER_PHONE_LABEL,
  CUSTOMER_PHONE_PLACEHOLDER,
  TRACK_CODE_LABEL,
  TRACK_CODE_PLACEHOLDER,
  TRACK_SUBMIT_LABEL,
  TRACK_NOT_FOUND_ERROR,
  TRACK_RATE_LIMITED_ERROR,
  ERROR_MESSAGE,
} from "@/lib/copy";

export default function TrackOrderPage() {
  const router = useRouter();
  const [phone, setPhone] = React.useState("");
  const [orderCode, setOrderCode] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [errorText, setErrorText] = React.useState<string | null>(null);

  const canSubmit = phone.trim().length > 0 && orderCode.trim().length > 0 && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorText(null);

    const result = await fetchOrderLookup(phone.trim(), orderCode.trim());
    setSubmitting(false);

    if (result.kind === "rate_limited") {
      setErrorText(TRACK_RATE_LIMITED_ERROR);
      return;
    }
    if (result.kind === "error") {
      setErrorText(ERROR_MESSAGE);
      return;
    }
    if (result.data.length === 0) {
      setErrorText(TRACK_NOT_FOUND_ERROR);
      return;
    }
    router.push(`/o/${encodeURIComponent(result.data[0].orderCode)}`);
  }

  return (
    <div className="cw">
      <header className="cw-header">
        <span className="name">{FIND_ORDER_LABEL}</span>
      </header>
      <div className="cw-body">
        <Card>
          <form onSubmit={(e) => void handleSubmit(e)}>
            <p className="note-plain">{TRACK_INTRO}</p>
            <div style={{ marginTop: "1.6rem" }}>
              <Input
                label={CUSTOMER_PHONE_LABEL}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={CUSTOMER_PHONE_PLACEHOLDER}
                inputMode="tel"
              />
            </div>
            <div style={{ marginTop: "1.6rem" }}>
              <Input
                label={TRACK_CODE_LABEL}
                value={orderCode}
                onChange={(e) => setOrderCode(e.target.value)}
                placeholder={TRACK_CODE_PLACEHOLDER}
                error={errorText ?? undefined}
              />
            </div>
            <div style={{ marginTop: "2rem" }}>
              <Button type="submit" variant="primary" wet loading={submitting} disabled={!canSubmit}>
                {TRACK_SUBMIT_LABEL}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
