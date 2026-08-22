// @vitest-environment jsdom
//
// WBS 5.9 — Order Status Update (Merchant Actions), Testing note items 2
// and 3:
//   (2) "a failed transition rolls back the optimistic state" — on failure
//       the badge must revert to the REAL (unchanged) status visibly, with
//       a persistent Thai error message next to that card — never silently,
//       never stuck showing the optimistic (wrong) state.
//   (3) "bulk partial failure is reported per order, honestly" — naming
//       which orders failed, not a generic "some failed" message, and not
//       reported as one atomic all-or-nothing transaction (a partial
//       success must keep the successful orders' optimistic state and only
//       roll back the failed ones).
//
// Same jsdom + @testing-library/react precedent StoreProfileForm.test.tsx
// established for this app (see its own header comment for why a jsdom
// environment is required here and not the renderToStaticMarkup convention
// most of this repo's component tests use): this needs a live dispatcher —
// a tap, an async Server Action round trip, then a second render reflecting
// either the reconciled or the rolled-back state — which
// renderToStaticMarkup cannot produce.
//
// `useOrdersFeed` is mocked to just return whatever `initialOrders` this
// test passes in verbatim (its own realtime/poll/merge behaviour is
// useOrdersFeed.test.ts's job, not this file's) — this lets each test here
// control exactly what "the real order row" looks like without a fake
// Supabase client's channel/postgres_changes plumbing. `./actions` is
// mocked wholesale so advanceOrder/bulkMarkReady's resolution value (and,
// for the "still optimistic before the request resolves" case, its
// resolution TIMING) is fully controlled — the Edge Function contract
// those two functions bridge to is exercised for real over `fetch` in
// actions.test.ts (this same change) instead.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { WorkingOrder } from "./fetchWorkingQueue";
import type { AdvanceOrderResult, BulkMarkReadyResult } from "./actions";

const mockAdvanceOrder = vi.fn<(orderId: string, to: "PREPARING" | "READY" | "COLLECTED") => Promise<AdvanceOrderResult>>();
const mockBulkMarkReady = vi.fn<(orderIds: string[]) => Promise<BulkMarkReadyResult>>();
const mockMarkOrdersSeen = vi.fn().mockResolvedValue({ ok: true });
const mockSetNotifySoundMuted = vi.fn().mockResolvedValue({ ok: true });

vi.mock("./actions", () => ({
  advanceOrder: (orderId: string, to: "PREPARING" | "READY" | "COLLECTED") => mockAdvanceOrder(orderId, to),
  bulkMarkReady: (orderIds: string[]) => mockBulkMarkReady(orderIds),
  markOrdersSeen: () => mockMarkOrdersSeen(),
  setNotifySoundMuted: (muted: boolean) => mockSetNotifySoundMuted(muted),
}));

vi.mock("./useOrdersFeed", () => ({
  useOrdersFeed: (_supabase: unknown, _storeId: string, initialOrders: WorkingOrder[]) => initialOrders,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { InboxClient } from "./InboxClient";
import { ADVANCE_STALE, BULK_READY_LABEL, BULK_READY_TOTAL_FAILURE } from "./copy";

function makeOrder(overrides: Partial<WorkingOrder> = {}): WorkingOrder {
  return {
    id: "order-1",
    code: "Q00001",
    status: "ACCEPTED",
    customerName: "คุณทดสอบ",
    pickupSlotId: "slot-1",
    pickupTime: "10:30",
    totalSatang: 6000,
    cups: 1,
    items: [],
    arrivedAt: "2026-08-22T02:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WBS 5.9 — InboxClient: a failed single-order transition rolls back visibly with a Thai explanation", () => {
  it("REQUIRED: on failure, the card's badge reverts to the ORIGINAL status (not stuck showing the optimistic one) and a persistent Thai error message appears next to that card", async () => {
    let resolveAdvance!: (r: AdvanceOrderResult) => void;
    mockAdvanceOrder.mockReturnValue(new Promise((resolve) => (resolveAdvance = resolve)));

    render(
      <InboxClient
        storeId="store-1"
        initialOrders={[makeOrder({ status: "ACCEPTED" })]}
        initialLastSeenAt={new Date().toISOString()}
        initialMuted={false}
      />,
    );

    const advanceButton = screen.getByTestId("order-card-advance");
    expect(advanceButton.textContent).toBe("เริ่มทำ");
    fireEvent.click(advanceButton);

    // Optimistic: the badge already shows "making" (พร้อมรับ's own status
    // label is "กำลังทำ") before the request resolves — proves the tap
    // applies the new state immediately, per this entry's own acceptance
    // ("the merchant taps and looks away, a spinner they never see is
    // useless"). getByTestId itself throws if the element isn't present,
    // so a successful call is the presence assertion (no @testing-library/
    // jest-dom in this repo — see StoreProfileForm.test.tsx's own note).
    await waitFor(() => {
      screen.getByTestId("order-status-badge-making");
    });
    expect(screen.queryByTestId("order-card-error")).toBeNull();

    // Now the request comes back rejected — a real, expected state conflict
    // (WBS 5.9's own ADVANCE_STALE copy), not a generic crash message.
    resolveAdvance({ ok: false, error: ADVANCE_STALE });

    await waitFor(() => {
      expect(screen.getByTestId("order-card-error").textContent).toBe(ADVANCE_STALE);
    });
    // Rolled back: the ORIGINAL status badge (accepted) is back, the
    // optimistic "making" badge is gone — not left stuck on the wrong state.
    screen.getByTestId("order-status-badge-accepted");
    expect(screen.queryByTestId("order-status-badge-making")).toBeNull();

    // Not a vanishing toast: the message is still there after a tick with
    // nothing else happening (interaction_spec.md line 13's own
    // "a persistent inline message", not a toast that disappears while the
    // merchant has already looked away).
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByTestId("order-card-error").textContent).toBe(ADVANCE_STALE);
  });

  it("a SUCCESSFUL transition leaves the optimistic status in place and shows no error", async () => {
    mockAdvanceOrder.mockResolvedValue({ ok: true, already: false });

    render(
      <InboxClient
        storeId="store-1"
        initialOrders={[makeOrder({ status: "ACCEPTED" })]}
        initialLastSeenAt={new Date().toISOString()}
        initialMuted={false}
      />,
    );

    fireEvent.click(screen.getByTestId("order-card-advance"));

    await waitFor(() => {
      screen.getByTestId("order-status-badge-making");
    });
    expect(screen.queryByTestId("order-card-error")).toBeNull();
  });

  it("a stale error from a PREVIOUS tap is cleared the moment a new tap starts", async () => {
    mockAdvanceOrder.mockResolvedValueOnce({ ok: false, error: ADVANCE_STALE });

    render(
      <InboxClient
        storeId="store-1"
        initialOrders={[makeOrder({ status: "ACCEPTED" })]}
        initialLastSeenAt={new Date().toISOString()}
        initialMuted={false}
      />,
    );

    fireEvent.click(screen.getByTestId("order-card-advance"));
    await waitFor(() => screen.getByTestId("order-card-error"));

    let resolveSecond!: (r: AdvanceOrderResult) => void;
    mockAdvanceOrder.mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));
    fireEvent.click(screen.getByTestId("order-card-advance"));

    await waitFor(() => expect(screen.queryByTestId("order-card-error")).toBeNull());
    resolveSecond({ ok: true, already: false });
  });
});

describe("WBS 5.9 — InboxClient: bulk 'ทำเสร็จทั้งช่วงเวลานี้' partial failure is reported per order, honestly", () => {
  it("REQUIRED: a partial failure names the specific failed order code(s) — not a generic 'some failed' message — and is NOT reported as atomic (the succeeded order's optimistic state survives)", async () => {
    const orders = [
      makeOrder({ id: "order-a", code: "Q0000A", status: "ACCEPTED", pickupTime: "10:30", pickupSlotId: "slot-1" }),
      makeOrder({ id: "order-b", code: "Q0000B", status: "PREPARING", pickupTime: "10:30", pickupSlotId: "slot-1" }),
    ];
    mockBulkMarkReady.mockResolvedValue({
      ok: true,
      results: [
        { orderId: "order-a", ok: true },
        { orderId: "order-b", ok: false },
      ],
    });

    render(
      <InboxClient storeId="store-1" initialOrders={orders} initialLastSeenAt={new Date().toISOString()} initialMuted={false} />,
    );

    fireEvent.click(screen.getByTestId("bulk-ready-button"));

    const resultEl = await screen.findByTestId("bulk-ready-result");
    // Names the failing order's own code, not a generic "บางรายการไม่สำเร็จ".
    expect(resultEl.textContent).toContain("Q0000B");
    expect(resultEl.textContent).not.toContain(BULK_READY_TOTAL_FAILURE);
    expect(resultEl.textContent).toMatch(/สำเร็จ 1/); // one order succeeded

    // Not atomic: order A (succeeded) keeps its optimistic "ready" badge;
    // order B (failed) rolled back to its real "making" (PREPARING) badge.
    // Each order's card is looked up independently since data-testid values
    // repeat per order.
    const cards = screen.getAllByTestId("order-card");
    const cardA = cards.find((c) => within(c).queryByText("Q0000A"));
    const cardB = cards.find((c) => within(c).queryByText("Q0000B"));
    expect(cardA).toBeDefined();
    expect(cardB).toBeDefined();
    within(cardA!).getByTestId("order-status-badge-ready");
    within(cardB!).getByTestId("order-status-badge-making");
  });

  it("bulk button label is the exact WBS copy, and a TOTAL failure (request itself failed) shows the distinct total-failure message, not the per-order one", async () => {
    const orders = [makeOrder({ id: "order-a", code: "Q0000A", status: "ACCEPTED", pickupSlotId: "slot-1" })];
    mockBulkMarkReady.mockResolvedValue({ ok: false, error: BULK_READY_TOTAL_FAILURE });

    render(
      <InboxClient storeId="store-1" initialOrders={orders} initialLastSeenAt={new Date().toISOString()} initialMuted={false} />,
    );

    const bulkButton = screen.getByTestId("bulk-ready-button");
    expect(bulkButton.textContent).toBe(BULK_READY_LABEL);
    fireEvent.click(bulkButton);

    const resultEl = await screen.findByTestId("bulk-ready-result");
    expect(resultEl.textContent).toBe(BULK_READY_TOTAL_FAILURE);

    // Total failure rolls back EVERY optimistic status in the group.
    screen.getByTestId("order-status-badge-accepted");
  });

  it("no bulk button renders for a group with zero ACCEPTED/PREPARING orders (nothing eligible)", () => {
    const orders = [makeOrder({ id: "order-a", code: "Q0000A", status: "READY", pickupSlotId: "slot-1" })];
    render(
      <InboxClient storeId="store-1" initialOrders={orders} initialLastSeenAt={new Date().toISOString()} initialMuted={false} />,
    );
    expect(screen.queryByTestId("bulk-ready-button")).toBeNull();
  });
});
