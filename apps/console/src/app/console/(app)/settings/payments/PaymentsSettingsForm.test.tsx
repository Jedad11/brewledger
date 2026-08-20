// WBS 4.5 hotfix — component-level regression for PaymentsSettingsForm's
// `canConfirm` gate. redline_reviewer's audit found `canConfirm` was
// `normalized.ok` alone: a syntactically-valid PromptPay identifier could
// enable the "ฉันสแกนแล้วและยืนยันว่าชื่อผู้รับเงินคือฉัน" confirmation
// toggle even though the merchant had never actually seen a QR to scan —
// the entire point of this screen (RL-1's primary enforcement point: the
// merchant's own scan-and-check, not a claim in a form) requires a rendered
// QR to exist first. The fix adds `!!qrDataUrl` to the gate.
//
// No jsdom/@testing-library harness exists in this repo (see
// packages/ui/src/components/Toggle.test.tsx and
// .../menu/[id]/MenuItemEditorForm.test.tsx's own header comments) — same
// approach here: react-dom/server's renderToStaticMarkup, pure Node, no DOM,
// no effects. That happens to be exactly the right tool for this regression:
// `qrDataUrl` is only ever set inside a useEffect (QRCode.toDataURL is
// async), which renderToStaticMarkup never runs — so on ANY static render,
// qrDataUrl is always null, REGARDLESS of how valid the PromptPay identifier
// is. That makes this render the precise case the fix targets: a valid
// identifier, QR not yet rendered. Before the fix, the confirm toggle would
// render enabled here; after the fix, it must render disabled.
//
// next/navigation's useRouter is mocked (it throws outside a real Next.js
// request/render context, which this bare SSR render is not) — same idiom
// as MenuItemEditorForm.test.tsx. No other module is mocked for BEHAVIOR:
// normalisation (@brewledger/shared) and @brewledger/ui's Toggle both run
// for real, since the whole point is to prove the ACTUAL gating logic and
// the ACTUAL disabled attribute on the ACTUAL rendered
// <button role="switch">. "@/lib/supabase/server" and "@/lib/merchant" ARE
// mocked, but only because vitest here has no tsconfig-paths alias plugin
// (same gap actions.test.ts and MenuItemEditorForm.test.tsx's own header
// comments note) — the bare "@/..." specifiers actions.ts imports (pulled
// in transitively via PaymentsSettingsForm's `./actions` import) can't
// resolve at all otherwise. Neither module is ever reached by a static
// initial render (both are only called from inside handleSubmit), so an
// empty stub is enough; this file never asserts on their behavior.
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/merchant", () => ({ resolveMerchantCtx: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { PaymentsSettingsForm } = await import("./PaymentsSettingsForm");

const STORE_ID = "33333333-3333-4333-8333-333333333333";
const ONBOARDING = { store: true, menu: true };
const CONFIRM_LABEL = "ฉันสแกนแล้วและยืนยันว่าชื่อผู้รับเงินคือฉัน";

/** Isolates the confirm-toggle <button role="switch" ...> from the rest of
 * the page (the type-selector radios also use role="radio"/aria-checked, so
 * scoping by the toggle's unique aria-label avoids matching those instead). */
function extractConfirmToggleButton(html: string): string {
  const labelIdx = html.indexOf(`aria-label="${CONFIRM_LABEL}"`);
  expect(labelIdx).toBeGreaterThan(-1); // sanity: the toggle is actually on the page
  const buttonStart = html.lastIndexOf("<button", labelIdx);
  const buttonEnd = html.indexOf(">", labelIdx);
  return html.slice(buttonStart, buttonEnd + 1);
}

describe("PaymentsSettingsForm — canConfirm gate (WBS 4.5 hotfix)", () => {
  it(
    "a syntactically VALID, already-verified PromptPay identifier still renders the confirm " +
      "toggle DISABLED on initial render, because qrDataUrl has not resolved yet (useEffect " +
      "never runs in a static render) — this is the exact case the ok-alone gate used to miss",
    () => {
      const html = renderToStaticMarkup(
        <PaymentsSettingsForm
          storeId={STORE_ID}
          initial={{
            promptpayId: "0812345678",
            promptpayType: "msisdn",
            promptpayVerifiedAt: "2026-01-15T09:30:00.000Z",
          }}
          onboarding={ONBOARDING}
        />,
      );

      const toggleButton = extractConfirmToggleButton(html);
      expect(toggleButton).toMatch(/\bdisabled=""/);
    },
  );

  it("an empty/invalid identifier also renders the confirm toggle disabled (baseline — normalized.ok alone already false here)", () => {
    const html = renderToStaticMarkup(
      <PaymentsSettingsForm
        storeId={STORE_ID}
        initial={{ promptpayId: null, promptpayType: null, promptpayVerifiedAt: null }}
        onboarding={ONBOARDING}
      />,
    );

    const toggleButton = extractConfirmToggleButton(html);
    expect(toggleButton).toMatch(/\bdisabled=""/);
  });

  it("with no storeId (no store yet), the form renders the EmptyState instead — no confirm toggle on the page at all", () => {
    const html = renderToStaticMarkup(
      <PaymentsSettingsForm storeId={null} initial={{ promptpayId: null, promptpayType: null, promptpayVerifiedAt: null }} onboarding={ONBOARDING} />,
    );

    expect(html).not.toContain(`aria-label="${CONFIRM_LABEL}"`);
  });
});
