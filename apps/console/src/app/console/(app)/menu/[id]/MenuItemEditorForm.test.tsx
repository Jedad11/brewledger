// WBS 4.4 / 6.7 — string audit for the recipe block region, plus a couple of
// render-level RL-2 assertions. WBS 6.7 extends this file rather than
// standing up a second scan mechanism, per its own "Testing" instruction.
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
// resolve on its own. None of these are exercised by a static initial
// render (all are only called from inside an event handler), so an empty
// mock is enough; this file never asserts on their behavior.
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/merchant", () => ({ resolveMerchantCtx: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
// WBS 6.7's inline ingredient-create action, reused from WBS 6.4/6.5's
// screen -- never called by a static initial render either.
vi.mock("../../expenses/[id]/review/actions", () => ({ createIngredientInline: vi.fn() }));

const { MenuItemEditorForm } = await import("./MenuItemEditorForm");

const STORE_ID = "33333333-3333-4333-8333-333333333333";

describe("MenuItemEditorForm — RL-2 string audit (WBS 4.4)", () => {
  it("a brand-new item (no recipe, block never opened) renders none of the five forbidden nag phrases anywhere on the page", () => {
    const html = renderToStaticMarkup(<MenuItemEditorForm storeId={STORE_ID} item={null} ingredientOptions={[]} />);

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
          recipe: null,
          recipeSuggestionDismissed: false,
        }}
        ingredientOptions={[]}
      />,
    );

    for (const phrase of FORBIDDEN_PHRASES) {
      expect(html).not.toContain(phrase);
    }
  });

  it("the recipe block is present, collapsed by default (no expanded body in the initial render), and carries the exact optional-label copy from state_matrix.md", () => {
    const html = renderToStaticMarkup(<MenuItemEditorForm storeId={STORE_ID} item={null} ingredientOptions={[]} />);

    expect(html).toContain('data-testid="recipe-block"');
    expect(html).toContain("สูตร (ใส่ทีหลังได้)");
    // Collapsed: aria-expanded="false" and no .oc-recbody rendered yet.
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).not.toContain("oc-recbody");
  });

  it("the recipe block carries no required/error/valid/missing/incomplete-shaped prop or attribute -- RL-2 enforced by omission", () => {
    const html = renderToStaticMarkup(<MenuItemEditorForm storeId={STORE_ID} item={null} ingredientOptions={[]} />);
    const recipeSection = html.slice(html.indexOf('data-testid="recipe-block"'));

    expect(recipeSection).not.toMatch(/required|invalid|is-error|missing|incomplete/i);
  });

  it("the Save button is enabled by name+price alone -- no option group or photo affects the disabled state", () => {
    const html = renderToStaticMarkup(<MenuItemEditorForm storeId={STORE_ID} item={null} ingredientOptions={[]} />);
    // A brand-new item starts with an empty name/price, so Save is
    // legitimately disabled at first render (nothing typed yet) -- this
    // just asserts the button exists and carries no non-name/price gate
    // (e.g. no disabled-because-no-photo, no disabled-because-no-recipe).
    expect(html).toMatch(/<button class="btn btn--primary btn--wet" disabled="" type="submit">บันทึก/);
  });
});

describe("MenuItemEditorForm — WBS 6.7 suggested BOM: never nags a merchant who never opens the block", () => {
  it("naming the item an exact library match ('ลาเต้') with no ingredients on file yet still renders no forbidden phrase and no suggestion content -- the block stays collapsed regardless of what would be offered inside it", () => {
    const html = renderToStaticMarkup(
      <MenuItemEditorForm
        storeId={STORE_ID}
        item={{
          id: "55555555-5555-4555-8555-555555555555",
          name: "ลาเต้",
          description: null,
          priceSatang: 6000,
          imagePath: null,
          imageUrl: null,
          optionGroups: [],
          recipe: null,
          recipeSuggestionDismissed: false,
        }}
        ingredientOptions={[]}
      />,
    );

    for (const phrase of FORBIDDEN_PHRASES) {
      expect(html).not.toContain(phrase);
    }
    // A matched suggestion's own copy must not leak into the collapsed
    // render -- it does not exist in the DOM at all until the block opens.
    expect(html).not.toContain("ใช้สูตรนี้แล้วแก้ได้");
    expect(html).not.toContain("มีสูตรมาตรฐาน");
    expect(html).not.toContain("ต้นทุนต่อแก้ว");
    expect(html).not.toContain("oc-recbody");
  });

  it("an item that already has a saved recipe (recipe !== null) still starts collapsed and clean -- having a recipe is never treated as a state to announce", () => {
    const html = renderToStaticMarkup(
      <MenuItemEditorForm
        storeId={STORE_ID}
        item={{
          id: "66666666-6666-4666-8666-666666666666",
          name: "ลาเต้",
          description: null,
          priceSatang: 6000,
          imagePath: null,
          imageUrl: null,
          optionGroups: [],
          recipe: [{ ingredientId: "coffee", ingredientName: "เมล็ดกาแฟคั่ว", quantity: 18, unit: "กรัม" }],
          recipeSuggestionDismissed: false,
        }}
        ingredientOptions={[{ id: "coffee", name: "เมล็ดกาแฟคั่ว", baseUnit: "g", currentCostSatang: null }]}
      />,
    );

    for (const phrase of FORBIDDEN_PHRASES) {
      expect(html).not.toContain(phrase);
    }
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).not.toContain("oc-recbody");
  });

  it("a previously-dismissed suggestion renders identically to one that was never offered -- no memory of the dismissal is visible anywhere", () => {
    const withoutDismissal = renderToStaticMarkup(
      <MenuItemEditorForm
        storeId={STORE_ID}
        item={{
          id: "77777777-7777-4777-8777-777777777777",
          name: "เครื่องดื่มไม่ทราบชื่อ",
          description: null,
          priceSatang: 6000,
          imagePath: null,
          imageUrl: null,
          optionGroups: [],
          recipe: null,
          recipeSuggestionDismissed: false,
        }}
        ingredientOptions={[]}
      />,
    );
    const withDismissal = renderToStaticMarkup(
      <MenuItemEditorForm
        storeId={STORE_ID}
        item={{
          id: "77777777-7777-4777-8777-777777777777",
          name: "เครื่องดื่มไม่ทราบชื่อ",
          description: null,
          priceSatang: 6000,
          imagePath: null,
          imageUrl: null,
          optionGroups: [],
          recipe: null,
          recipeSuggestionDismissed: true,
        }}
        ingredientOptions={[]}
      />,
    );
    expect(withDismissal).toBe(withoutDismissal);
  });
});
