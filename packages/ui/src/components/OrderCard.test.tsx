// WBS 5.9 — Order Status Update (Merchant Actions), Testing note item 1:
// "illegal transitions are not offered in the UI at all" — only the single
// valid next action renders as a button (e.g. an ACCEPTED order shows only
// "เริ่มทำ", never "พร้อมรับ"/"รับแล้ว"; a terminal order shows no advance
// button at all).
//
// OrderCard.tsx's own NEXT_ACTION_LABEL map (this same file) is the single
// structural gate: it has entries for exactly three of the eight
// OrderStatus values (accepted/making/ready), so `nextActionLabel` is
// undefined for every other status regardless of what props a caller
// passes — this is the guarantee proven here, deliberately including the
// adversarial case of a caller passing onAdvance + showNextAction=true for
// a terminal status anyway (a future regression at a CALL SITE, e.g.
// InboxClient wiring onAdvance for every status without checking, must
// still not produce a button — the gate lives in the component, not in
// caller discipline).
//
// Same convention as Toggle.test.tsx (this package's first test file, see
// its own header comment for the full rationale): renderToStaticMarkup
// (pure Node, react-dom/server) rather than a jsdom + @testing-library
// environment, since packages/ui has neither as a dependency and a plain
// string-presence/absence check over static markup is sufficient to prove
// "this exact button text is/isn't in the output" — no interaction is
// under test here, only render output.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderCard, NEXT_ACTION_LABEL, type OrderSummary } from "./OrderCard";
import type { OrderStatus } from "../types";

const ADVANCE_TESTID = "order-card-advance";

const BASE_ORDER: Omit<OrderSummary, "status"> = {
  id: "order-1",
  code: "Q00001",
  itemsSummary: "1 แก้ว",
  pickupTime: "10:30",
  totalSatang: 6000,
  cups: 1,
};

function renderCard(status: OrderStatus, opts?: { onAdvance?: boolean; showNextAction?: boolean }) {
  const order: OrderSummary = { ...BASE_ORDER, status };
  return renderToStaticMarkup(
    <OrderCard
      order={order}
      variant="inbox"
      showNextAction={opts?.showNextAction ?? true}
      unseen={false}
      onAdvance={opts?.onAdvance === false ? undefined : () => undefined}
    />,
  );
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Extracts the advance button's own inner text, scoped to that ONE
 * element — not a bare substring check over the whole card. Two of the
 * three NEXT_ACTION_LABEL strings happen to be byte-identical to a
 * DIFFERENT status's OrderStatusBadge label ("พร้อมรับ" is both the
 * making->ready button AND the "ready" badge text; "รับแล้ว" is both the
 * ready->collected button AND the "collected" badge text — see
 * OrderDetailClient.tsx's own comment on this exact coincidence), so a
 * whole-markup substring check would false-negative on the very statuses
 * that MUST correctly show no button at all.
 */
function advanceButtonText(html: string): string | null {
  const match = html.match(/data-testid="order-card-advance"[^>]*>([^<]*)</);
  return match ? match[1] : null;
}

describe("WBS 5.9 — OrderCard: exactly one valid forward action, never an illegal one", () => {
  const FORWARD_CASES: Array<{ status: OrderStatus; expectedLabel: string }> = [
    { status: "accepted", expectedLabel: "เริ่มทำ" },
    { status: "making", expectedLabel: "พร้อมรับ" },
    { status: "ready", expectedLabel: "รับแล้ว" },
  ];

  for (const { status, expectedLabel } of FORWARD_CASES) {
    it(`status="${status}" renders ONLY "${expectedLabel}" as the advance button — never the other two action labels`, () => {
      const html = renderCard(status);
      // Exactly one advance-button element in the markup.
      expect(countOccurrences(html, `data-testid="${ADVANCE_TESTID}"`)).toBe(1);
      // Its own text is the ONE correct verb for this status — scoped to
      // the button element itself, not a whole-markup substring check (see
      // advanceButtonText's own comment on why that would false-negative
      // for "ready"/"collected", whose badge label text collides with a
      // DIFFERENT status's button label).
      expect(advanceButtonText(html)).toBe(expectedLabel);
    });
  }

  const TERMINAL_CASES: OrderStatus[] = ["unpaid", "collected", "cancelled", "refunded", "expired"];

  for (const status of TERMINAL_CASES) {
    it(`status="${status}" (terminal / not-yet-actionable) renders NO advance button at all, even though onAdvance and showNextAction are both supplied`, () => {
      const html = renderCard(status, { onAdvance: true, showNextAction: true });
      expect(html).not.toContain(`data-testid="${ADVANCE_TESTID}"`);
      expect(advanceButtonText(html)).toBeNull();
    });
  }

  it("an actionable status (accepted) STILL renders no button when showNextAction=false", () => {
    const html = renderCard("accepted", { showNextAction: false });
    expect(html).not.toContain(`data-testid="${ADVANCE_TESTID}"`);
  });

  it("an actionable status (accepted) STILL renders no button when onAdvance is omitted", () => {
    const html = renderCard("accepted", { onAdvance: false });
    expect(html).not.toContain(`data-testid="${ADVANCE_TESTID}"`);
  });

  it("NEXT_ACTION_LABEL itself has entries for exactly the three forward-transition statuses — the structural source of the gate above", () => {
    const keysWithLabels = (Object.keys(NEXT_ACTION_LABEL) as OrderStatus[]).sort();
    expect(keysWithLabels).toEqual(["accepted", "making", "ready"]);
  });
});
