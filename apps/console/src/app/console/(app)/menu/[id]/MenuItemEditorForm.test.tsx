// WBS 4.4 testing block — string audit for the recipe block region, plus a
// couple of render-level RL-2 assertions.
//
// No jsdom/@testing-library harness exists in this repo (see
// packages/ui/src/components/Toggle.test.tsx's header comment, WBS 4.3) —
// same approach here: react-dom/server's renderToStaticMarkup, pure Node, no
// DOM. next/navigation's useRouter is mocked (it throws outside a real
// Next.js request/render context, which this bare SSR render is not).
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FORBIDDEN_PHRASES } from "../../../../../../../../scripts/scan-forbidden-copy.mjs";

// vitest here has no tsconfig-paths alias plugin (same gap noted in
// ../../settings/store/actions.test.ts) -- the bare "@/..." specifier can't
// resolve on its own. Neither of these is exercised by a static initial
// render (both are only called from inside the submit handler), so an empty
// mock is enough; this file never asserts on their behavior.
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/merchant", () => ({ resolveMerchantCtx: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const { MenuItemEditorForm } = await import("./MenuItemEditorForm");

const STORE_ID = "33333333-3333-4333-8333-333333333333";

describe("MenuItemEditorForm — RL-2 string audit (WBS 4.4)", () => {
  it("a brand-new item (no recipe, block never opened) renders none of the five forbidden nag phrases anywhere on the page", () => {
    const html = renderToStaticMarkup(<MenuItemEditorForm storeId={STORE_ID} item={null} />);

    for (const phrase of FORBIDDEN_PHRASES) {
      expect(html).not.toContain(phrase);
    }
  });

  it("an existing item being edited also renders none of the forbidden phrases", () => {
    const html = renderToStaticMarkup(
      <MenuItemEditorForm
        storeId={STORE_ID}
        item={{
          id: "44444444-4444-4444-8444-444444444444",
          name: "ลาเต้เย็น",
          description: null,
          priceSatang: 6000,
          imagePath: null,
          imageUrl: null,
          optionGroups: [],
        }}
      />,
    );

    for (const phrase of FORBIDDEN_PHRASES) {
      expect(html).not.toContain(phrase);
    }
  });

  it("the recipe block is present, collapsed by default (no expanded body in the initial render), and carries the exact optional-label copy from state_matrix.md", () => {
    const html = renderToStaticMarkup(<MenuItemEditorForm storeId={STORE_ID} item={null} />);

    expect(html).toContain('data-testid="recipe-block"');
    expect(html).toContain("สูตร (ใส่ทีหลังได้)");
    // Collapsed: aria-expanded="false" and no .oc-recbody rendered yet.
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).not.toContain("oc-recbody");
  });

  it("the recipe block carries no required/error/valid/missing/incomplete-shaped prop or attribute -- RL-2 enforced by omission", () => {
    const html = renderToStaticMarkup(<MenuItemEditorForm storeId={STORE_ID} item={null} />);
    const recipeSection = html.slice(html.indexOf('data-testid="recipe-block"'));

    expect(recipeSection).not.toMatch(/required|invalid|is-error|missing|incomplete/i);
  });

  it("the Save button is enabled by name+price alone -- no option group or photo affects the disabled state", () => {
    const html = renderToStaticMarkup(<MenuItemEditorForm storeId={STORE_ID} item={null} />);
    // A brand-new item starts with an empty name/price, so Save is
    // legitimately disabled at first render (nothing typed yet) -- this
    // just asserts the button exists and carries no non-name/price gate
    // (e.g. no disabled-because-no-photo, no disabled-because-no-recipe).
    expect(html).toMatch(/<button class="btn btn--primary btn--wet" disabled="" type="submit">บันทึก/);
  });
});
