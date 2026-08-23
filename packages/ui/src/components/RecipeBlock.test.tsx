// WBS 6.7 — string audit for RecipeBlock itself, across every state this
// component can render (collapsed, suggested, dismissed/blank-start, and
// editing). Extends the audit WBS 4.4 started in
// apps/console/.../menu/[id]/MenuItemEditorForm.test.tsx rather than
// duplicating a second scan mechanism -- same FORBIDDEN_PHRASES list,
// same renderToStaticMarkup approach (no jsdom/@testing-library in this
// package, see Toggle.test.tsx's own header comment for why).
//
// This file's own render calls pass `defaultOpen` (a test-only prop, see
// RecipeBlock.tsx's own comment on it) to reach the open-state content at
// all -- there is no simulated click available here.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RecipeBlock, type RecipeRow, type RecipeIngredientOption } from "./RecipeBlock";
import { FORBIDDEN_PHRASES } from "../../../../scripts/scan-forbidden-copy.mjs";

const INGREDIENTS: RecipeIngredientOption[] = [
  { id: "coffee", name: "เมล็ดกาแฟคั่ว", baseUnit: "g" },
  { id: "milk", name: "นมสด", baseUnit: "ml" },
];

const SUGGESTION: RecipeRow[] = [
  { ingredientId: "coffee", ingredientName: "เมล็ดกาแฟคั่ว", quantity: 18, unit: "กรัม" },
  { ingredientId: "", ingredientName: "นมสด", quantity: 200, unit: "มล." },
];

const EDITING_RECIPE: RecipeRow[] = [
  { ingredientId: "coffee", ingredientName: "เมล็ดกาแฟคั่ว", quantity: 18, unit: "กรัม" },
  { ingredientId: "", ingredientName: "", quantity: null, unit: "" },
];

async function noop() {
  return null;
}

function expectNoForbiddenPhrase(html: string) {
  for (const phrase of FORBIDDEN_PHRASES) {
    expect(html).not.toContain(phrase);
  }
}

describe("RecipeBlock — collapsed (default, no prop forces it open)", () => {
  it("renders nothing of the body regardless of what suggestion/recipe data is fed in", () => {
    const html = renderToStaticMarkup(
      <RecipeBlock
        itemName="ลาเต้เย็น"
        recipe={null}
        suggestion={SUGGESTION}
        ingredientOptions={INGREDIENTS}
        onUse={() => {}}
        onChange={() => {}}
        onDismiss={() => {}}
        onCreateIngredient={noop}
      />,
    );
    expect(html).toContain("สูตร (ใส่ทีหลังได้)");
    expect(html).toMatch(/aria-expanded="false"/);
    expect(html).not.toContain("oc-recbody");
    expectNoForbiddenPhrase(html);
  });
});

describe("RecipeBlock — suggested (WBS 6.7)", () => {
  it("shows the exact suggestion/accept copy, an 'ไม่ใช้สูตรนี้' dismiss control, and no forbidden phrase", () => {
    const html = renderToStaticMarkup(
      <RecipeBlock
        itemName="ลาเต้เย็น"
        recipe={null}
        suggestion={SUGGESTION}
        ingredientOptions={INGREDIENTS}
        onUse={() => {}}
        onChange={() => {}}
        onDismiss={() => {}}
        onCreateIngredient={noop}
        defaultOpen
      />,
    );
    expect(html).toContain("มีสูตรมาตรฐานสำหรับรายการนี้อยู่แล้ว ใช้แล้วปรับตัวเลขให้ตรงกับร้านคุณได้เลย");
    expect(html).toContain("ใช้สูตรนี้แล้วแก้ได้");
    expect(html).toContain("ไม่ใช้สูตรนี้");
    expectNoForbiddenPhrase(html);
  });

  it("with no suggestion (or after dismissal, which the caller models as suggestion=null), shows only the neutral blank-start copy", () => {
    const html = renderToStaticMarkup(
      <RecipeBlock
        itemName="เครื่องดื่มไม่ทราบชื่อ"
        recipe={null}
        suggestion={null}
        ingredientOptions={INGREDIENTS}
        onUse={() => {}}
        onChange={() => {}}
        onDismiss={() => {}}
        onCreateIngredient={noop}
        defaultOpen
      />,
    );
    expect(html).toContain("เริ่มจากบรรทัดว่างแล้วใส่วัตถุดิบทีละอย่าง");
    expect(html).toContain("เริ่มใส่สูตรเอง");
    expect(html).not.toContain("ใช้สูตรนี้แล้วแก้ได้");
    expect(html).not.toContain("ไม่ใช้สูตรนี้");
    expectNoForbiddenPhrase(html);
  });
});

describe("RecipeBlock — editing (WBS 6.7 ingredient picker)", () => {
  it("renders an ingredient <select> per row (not a freeform text input), a remove control, and an inline-create option, with no forbidden phrase", () => {
    const html = renderToStaticMarkup(
      <RecipeBlock
        itemName="ลาเต้เย็น"
        recipe={EDITING_RECIPE}
        suggestion={null}
        ingredientOptions={INGREDIENTS}
        onUse={() => {}}
        onChange={() => {}}
        onDismiss={() => {}}
        onCreateIngredient={noop}
        defaultOpen
      />,
    );
    expect(html).toContain("<select");
    expect(html).toContain("+ สร้างวัตถุดิบใหม่");
    expect(html).toContain(">ลบ<");
    expect(html).toContain("เพิ่มวัตถุดิบ");
    // No cost/margin figure is ever rendered by this component itself (RL-3,
    // no-cost-formatting-logic.cjs) -- it has no such prop to render.
    expect(html).not.toMatch(/฿|MoneyValue|money--/);
    expectNoForbiddenPhrase(html);
  });

  it("carries no required/error/valid/missing/incomplete-shaped attribute anywhere in the editing table", () => {
    const html = renderToStaticMarkup(
      <RecipeBlock
        itemName="ลาเต้เย็น"
        recipe={EDITING_RECIPE}
        suggestion={null}
        ingredientOptions={INGREDIENTS}
        onUse={() => {}}
        onChange={() => {}}
        onDismiss={() => {}}
        onCreateIngredient={noop}
        defaultOpen
      />,
    );
    expect(html).not.toMatch(/required|invalid|is-error|missing|incomplete/i);
  });
});
