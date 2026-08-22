// @vitest-environment jsdom
//
// WBS 4.3 — regression coverage for the storeId session-tracking bug: a
// component reading `store?.id` straight from the (never-updating) `store`
// prop instead of tracking the id a successful save actually returned would
// send `storeId: null` on EVERY submit in a session, turning every repeat
// save into a duplicate INSERT instead of an UPDATE (see this directory's
// git history and StoreProfileForm.tsx's own header comment on `storeId`).
//
// This is not observable through renderToStaticMarkup, the convention used
// by MenuItemEditorForm.test.tsx / PaymentsSettingsForm.test.tsx / Toggle
// .test.tsx (see their header comments for why that convention exists at
// all) -- storeId never appears in rendered HTML here, it only flows into
// the payload built inside handleSubmit, and proving it survives a second
// submit in one mounted instance means actually dispatching two submit
// events on a live component and inspecting what each one sent. Hooks need
// a real dispatcher for that (React's event system + state updates across
// renders), which neither renderToStaticMarkup nor a bare function call can
// provide. This file therefore adds jsdom + @testing-library/react as
// devDependencies of apps/console (see apps/console/package.json), scoped
// to ONLY this test file via the `@vitest-environment jsdom` pragma above --
// no other test file's environment or the workspace default changes. This
// is new test infrastructure this repo didn't have before; flagged for
// engineer/redline_reviewer rather than added silently elsewhere.
//
// Getting this file running also required apps/console/vitest.config.ts
// (new, see its own header comment): a jsdom environment resolves bare
// "@/..." specifiers at transform time, before any vi.mock factory can
// intercept them, so the "mock the specifier, keep it real" trick the node-
// environment tests in this directory use for "@/lib/slug" doesn't work
// here without a real alias. Confirmed by reproducing the failure and
// bisecting it down to the `@vitest-environment jsdom` pragma alone.
//
// "./actions" is mocked wholesale (not just its "@/..." transitive imports,
// the way actions.test.ts / MenuItemEditorForm.test.tsx do it) because this
// file needs to control saveStoreProfile's resolved value AND its resolve
// timing per-test (the double-submit case below resolves it manually) --
// something a passthrough-mocked deep dependency can't give us.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { StoreProfileInput, SaveStoreProfileResult } from "./actions";

const mockSaveStoreProfile = vi.fn<(input: StoreProfileInput) => Promise<SaveStoreProfileResult>>();

vi.mock("./actions", () => ({
  saveStoreProfile: (input: StoreProfileInput) => mockSaveStoreProfile(input),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
// vitest here has no tsconfig-paths alias plugin (same gap actions.test.ts's
// own header comment notes) -- the bare "@/lib/slug" specifier
// StoreProfileForm.tsx imports directly can't resolve on its own. Same
// "mock the specifier, keep the real behavior" passthrough actions.test.ts
// uses: slugify/generateSlugBase run for real, this only routes the import.
vi.mock("@/lib/slug", async () => {
  const actual = await vi.importActual("../../../../../lib/slug");
  return actual;
});

const { StoreProfileForm } = await import("./StoreProfileForm");

afterEach(() => {
  cleanup();
  mockSaveStoreProfile.mockReset();
});

const NEW_STORE_ID = "33333333-3333-4333-8333-333333333333";
const EXISTING_STORE_ID = "44444444-4444-4444-8444-444444444444";

// payments: true so the "ไปตั้งค่าการรับเงิน" nudge never renders -- keeps
// every test's button/field query set identical regardless of scenario.
const ONBOARDING = { store: false, menu: false, payments: true };

function fillRequiredFields(overrides?: { name?: string; address?: string; opens?: string; closes?: string }) {
  fireEvent.change(screen.getByLabelText("ชื่อร้าน"), { target: { value: overrides?.name ?? "ร้านกาแฟ" } });
  fireEvent.change(screen.getByLabelText("ที่อยู่สำหรับรับสินค้า"), {
    target: { value: overrides?.address ?? "123 ถ.สุขุมวิท" },
  });
  fireEvent.change(screen.getByLabelText("เวลาเปิด"), { target: { value: overrides?.opens ?? "08:00" } });
  fireEvent.change(screen.getByLabelText("เวลาปิด"), { target: { value: overrides?.closes ?? "18:00" } });
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "บันทึก" }) as HTMLButtonElement;
}

describe("StoreProfileForm — storeId session-tracking regression (the actual bug)", () => {
  it(
    "brand-new merchant (store: null): first submit sends storeId: null (create path); a second submit " +
      "in the SAME mounted session -- no remount -- sends the id the first save returned, not null again",
    async () => {
      mockSaveStoreProfile.mockResolvedValueOnce({
        ok: true,
        store: { id: NEW_STORE_ID, slug: "ran-kafae" },
      });

      render(<StoreProfileForm store={null} onboarding={ONBOARDING} />);
      fillRequiredFields();
      fireEvent.click(submitButton());

      await waitFor(() => expect(mockSaveStoreProfile).toHaveBeenCalledTimes(1));
      expect(mockSaveStoreProfile.mock.calls[0][0].storeId).toBeNull();
      await screen.findByText("บันทึกแล้ว");

      // Second save, same component instance, different field values --
      // exactly the scenario the bug report describes ("saving the store
      // profile form a second time in the same session").
      mockSaveStoreProfile.mockResolvedValueOnce({
        ok: true,
        store: { id: NEW_STORE_ID, slug: "ran-kafae-2" },
      });
      fillRequiredFields({ name: "ร้านกาแฟ (แก้ไขชื่อ)" });
      fireEvent.click(submitButton());

      await waitFor(() => expect(mockSaveStoreProfile).toHaveBeenCalledTimes(2));
      const secondCallInput = mockSaveStoreProfile.mock.calls[1][0];
      expect(secondCallInput.storeId).toBe(NEW_STORE_ID);
      expect(secondCallInput.storeId).not.toBeNull(); // the exact assertion that would have failed pre-fix
      expect(secondCallInput.name).toBe("ร้านกาแฟ (แก้ไขชื่อ)");
    },
  );

  it("returning merchant (store prop already set): first submit immediately uses the real store id -- no special first-save behavior needed", async () => {
    mockSaveStoreProfile.mockResolvedValueOnce({
      ok: true,
      store: { id: EXISTING_STORE_ID, slug: "ran-derm" },
    });

    render(
      <StoreProfileForm
        store={{
          id: EXISTING_STORE_ID,
          name: "ร้านเดิม",
          pickup_address: "999 ถ.เดิม",
          opens_at: "07:00:00",
          closes_at: "17:00:00",
          slug: "ran-derm",
          is_published: false,
          promptpay_verified_at: null,
        }}
        onboarding={{ store: true, menu: false, payments: true }}
      />,
    );

    fireEvent.click(submitButton());

    await waitFor(() => expect(mockSaveStoreProfile).toHaveBeenCalledTimes(1));
    expect(mockSaveStoreProfile.mock.calls[0][0].storeId).toBe(EXISTING_STORE_ID);
  });
});

describe("StoreProfileForm — rapid re-click while a save is in flight", () => {
  it(
    "clicking the submit button again (and a third time) before the in-flight save resolves does not " +
      "produce a second saveStoreProfile call -- the disabled={!canSubmit || saving} guard holds",
    async () => {
      let resolveFirst!: (value: SaveStoreProfileResult) => void;
      mockSaveStoreProfile.mockImplementationOnce(
        () =>
          new Promise<SaveStoreProfileResult>((resolve) => {
            resolveFirst = resolve;
          }),
      );

      render(<StoreProfileForm store={null} onboarding={ONBOARDING} />);
      fillRequiredFields();

      const button = submitButton();
      fireEvent.click(button);

      // The synchronous portion of handleSubmit (up to `await
      // saveStoreProfile(...)`) has run by the time fireEvent.click
      // returns: setSaving(true) already committed, so this reflects
      // whether the DOM is ACTUALLY disabled at this point, not an
      // assumption about it. (No @testing-library/jest-dom in this repo,
      // so this reads the native `.disabled` property directly rather than
      // a `toBeDisabled()` custom matcher.)
      expect(button.disabled).toBe(true);

      fireEvent.click(button);
      fireEvent.click(button);

      resolveFirst({ ok: true, store: { id: NEW_STORE_ID, slug: "ran-kafae" } });
      await screen.findByText("บันทึกแล้ว");

      expect(mockSaveStoreProfile).toHaveBeenCalledTimes(1);
    },
  );
});
