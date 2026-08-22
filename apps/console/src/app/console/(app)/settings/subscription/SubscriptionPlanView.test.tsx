// WBS 4.7 testing block — SubscriptionPlanView + copy.ts, covering the
// 5203d22 redesign (feature-matrix table -> 4-card pricing grid, prototype's
// console-setup.js scPlan() structure). merchants.subscription_tier is
// unchanged (free/starter/growth/scale); only the display layer moved.
//
// No jsdom/@testing-library harness needed here (same posture as
// PaymentsSettingsForm.test.tsx / MenuItemEditorForm.test.tsx's own header
// comments): react-dom/server's renderToStaticMarkup, pure Node, no DOM, no
// effects. SubscriptionPlanView reads subscriptionTier synchronously from
// useMerchant() (a plain React context, no client-side fetch/effect), so a
// static render already reflects the real, final markup for a given tier --
// there is no loading/hydration state to miss by not mounting into jsdom.
//
// "@" now resolves to apps/console/src via vitest.config.ts's alias (see
// that file's header comment), so SubscriptionPlanView's own
// "@/lib/MerchantProvider" import needs no vi.mock workaround here -- we use
// the REAL MerchantProvider to supply a real React context, which is exactly
// what proves useMerchant() picks up subscriptionTier correctly per tier.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { FORBIDDEN_PHRASES } from "../../../../../../../../scripts/scan-forbidden-copy.mjs";
import { MerchantProvider } from "@/lib/MerchantProvider";
import { SubscriptionPlanView } from "./SubscriptionPlanView";
import {
  ALWAYS_AVAILABLE_NOTE,
  CURRENT_PLAN_TAG,
  FEE_STATEMENT_TH,
  PLAN_DISPLAY,
  PLAN_ORDER,
  SELECT_PLAN_LABEL,
} from "./copy";
import type { SubscriptionTier } from "@brewledger/shared/dist/merchant";
import type { MerchantCtx } from "@brewledger/shared/dist/merchant";

const ALL_TIERS: SubscriptionTier[] = ["free", "starter", "growth", "scale"];

function ctxFor(tier: SubscriptionTier): MerchantCtx {
  return {
    merchantId: "11111111-1111-4111-8111-111111111111",
    subscriptionTier: tier,
    storeIds: ["22222222-2222-4222-8222-222222222222"],
    stores: [],
  };
}

function renderForTier(tier: SubscriptionTier): string {
  return renderToStaticMarkup(
    <MerchantProvider merchant={ctxFor(tier)}>
      <SubscriptionPlanView />
    </MerchantProvider>,
  );
}

// --- 1 & 2: per-tier rendering correctness + exact mapping table -----------

describe("SubscriptionPlanView — per-tier rendering (WBS 4.7)", () => {
  it.each(ALL_TIERS)("tier=%s: current-plan card shows the correct display name + price", (tier) => {
    const html = renderForTier(tier);
    const { name, price } = PLAN_DISPLAY[tier];
    expect(html).toContain(name);
    expect(html).toContain(price);
  });

  it.each(ALL_TIERS)(
    "tier=%s: exactly one of the 4 grid cards is tagged current (%s); the other 3 show the select button",
    (tier) => {
      const html = renderForTier(tier);

      const currentTagCount = html.split(CURRENT_PLAN_TAG).length - 1;
      // CURRENT_PLAN_TAG also appears once in the top current-plan card's own
      // ALWAYS_AVAILABLE_NOTE/FEE_STATEMENT_TH? No -- those strings are
      // distinct constants, so every occurrence of the literal tag text in
      // the page comes from the grid's <span class="st st--making">. Assert
      // there is exactly one such tag on the whole page.
      expect(currentTagCount).toBe(1);

      const selectButtonCount = html.split(SELECT_PLAN_LABEL).length - 1;
      expect(selectButtonCount).toBe(3);
    },
  );

  it("tier->display mapping is exhaustive and exact for all 4 internal tiers (direct assertion, not visual)", () => {
    expect(PLAN_DISPLAY.free).toMatchObject({ name: "ทดลองใช้", price: "฿0" });
    expect(PLAN_DISPLAY.starter).toMatchObject({ name: "เริ่มต้น", price: "฿199/เดือน" });
    expect(PLAN_DISPLAY.growth).toMatchObject({ name: "ร้านประจำ", price: "฿449/เดือน" });
    expect(PLAN_DISPLAY.scale).toMatchObject({ name: "หลายสาขา", price: "฿990/เดือน" });
    // Exhaustiveness: exactly these 4 keys, nothing more/less.
    expect(Object.keys(PLAN_DISPLAY).sort()).toEqual(["free", "growth", "scale", "starter"]);
    expect(PLAN_ORDER.slice().sort()).toEqual(["free", "growth", "scale", "starter"]);
  });
});

// --- 3: RL-1/RL-2 sentences render verbatim on EVERY tier ------------------

describe("SubscriptionPlanView — RL-1/RL-2 absolute-guarantee sentences (WBS 4.7)", () => {
  it.each(ALL_TIERS)(
    "tier=%s: RL-2 always-available sentence and RL-1 no-fee sentence both render verbatim",
    (tier) => {
      const html = renderForTier(tier);
      expect(html).toContain(ALWAYS_AVAILABLE_NOTE);
      expect(html).toContain(FEE_STATEMENT_TH);
    },
  );
});

// --- 4: RL-2 forbidden-phrase scan, including a hypothetical unknown tier --

describe("SubscriptionPlanView — RL-2 forbidden-phrase scan (WBS 4.7)", () => {
  it.each(ALL_TIERS)("tier=%s: no forbidden nag phrase appears anywhere in the rendered output", (tier) => {
    const html = renderForTier(tier);
    for (const phrase of FORBIDDEN_PHRASES) {
      expect(html).not.toContain(phrase);
    }
  });

  it(
    "a tier value outside the known union (fallback/unmapped path) throws rather than rendering silently-wrong " +
      "copy -- PLAN_DISPLAY has no fallback entry, so PLAN_DISPLAY[unknownTier] is undefined and " +
      "`current.name`/`current.price` throw a TypeError. This is a real finding: an unrecognised " +
      "subscription_tier value crashes this screen instead of degrading gracefully. subscriptionTier is a DB " +
      "enum column (migration 0002) so an out-of-union runtime value would require a schema drift, but the " +
      "component itself has no defensive fallback for that case.",
    () => {
      const unknownTier = "enterprise" as unknown as SubscriptionTier;
      expect(() => renderForTier(unknownTier)).toThrow();
    },
  );
});

// --- 5: no bom_lines reference in the unlock condition (AST scan) ----------
//
// packages/shared/src/features.rl2.test.ts already owns the general
// "no feature flag's unlock condition references bom_lines" check for
// FEATURE_MATRIX itself. This screen doesn't call isFeatureAvailable/
// resolveFeatureDenial at all -- its only "unlock condition" is
// `tier === subscriptionTier` for the current-plan tag, a pure tier
// comparison -- but WBS 4.7's acceptance criteria calls out this exact test
// for the file that changed, so it's asserted directly against
// SubscriptionPlanView.tsx and copy.ts here too, same AST-based method as
// features.rl2.test.ts (comments legitimately discuss bom_lines by name to
// document the guarantee; only real syntax-tree identifiers/string literals
// must be clean).
function findBomLinesReferences(sourceFile: ts.SourceFile): string[] {
  const offenders: string[] = [];
  const BOM_LINES_PATTERN = /bom_lines/i;

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && BOM_LINES_PATTERN.test(node.text)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      offenders.push(`identifier "${node.text}" at line ${line + 1}`);
    }
    if (ts.isStringLiteralLike(node) && BOM_LINES_PATTERN.test(node.text)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      offenders.push(`string literal "${node.text}" at line ${line + 1}`);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return offenders;
}

describe("SubscriptionPlanView + copy — RL-2: no unlock condition references bom_lines (WBS 4.7)", () => {
  const VIEW_PATH = join(__dirname, "SubscriptionPlanView.tsx");
  const COPY_PATH = join(__dirname, "copy.ts");

  it("sanity: SubscriptionPlanView.tsx's own comments DO mention bom_lines by name (proves the scan below excludes comments, not an empty file)", () => {
    const source = readFileSync(VIEW_PATH, "utf8");
    expect(source).toMatch(/bom_lines/);
  });

  it("no identifier or string literal in the real syntax tree of SubscriptionPlanView.tsx references bom_lines", () => {
    const source = readFileSync(VIEW_PATH, "utf8");
    const sourceFile = ts.createSourceFile(VIEW_PATH, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect(findBomLinesReferences(sourceFile)).toEqual([]);
  });

  it("no identifier or string literal in the real syntax tree of copy.ts references bom_lines", () => {
    const source = readFileSync(COPY_PATH, "utf8");
    const sourceFile = ts.createSourceFile(COPY_PATH, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(findBomLinesReferences(sourceFile)).toEqual([]);
  });
});

// --- 6: the "เลือกแพ็กเกจนี้" buttons are genuinely inert, not broken -------

describe("SubscriptionPlanView — unwired select-plan buttons are inert, not broken (WBS 4.7)", () => {
  it("the component source has no onClick/formAction anywhere near the select button (nothing to silently misfire)", () => {
    const source = readFileSync(join(__dirname, "SubscriptionPlanView.tsx"), "utf8");
    expect(source).not.toMatch(/onClick/);
    expect(source).not.toMatch(/formAction/);
    // No <form> wraps the grid, so type="button" can't even trigger an
    // accidental submit -- but the button's own type is asserted explicitly
    // too, since a stray type="submit" would be the classic way this class
    // of bug hides.
    expect(source).toMatch(/<Button variant="outline" type="button">/);
  });

  it("rendered select-plan button carries no onClick/href/form-submitting attribute in its HTML", () => {
    // free tier: 3 of the 4 cards render the select button.
    const html = renderForTier("free");
    const btnStart = html.indexOf(`>${SELECT_PLAN_LABEL}<`);
    expect(btnStart).toBeGreaterThan(-1);
    const tagStart = html.lastIndexOf("<button", btnStart);
    const tagEnd = html.indexOf(">", tagStart);
    const buttonTag = html.slice(tagStart, tagEnd + 1);

    expect(buttonTag).not.toMatch(/onclick/i);
    expect(buttonTag).not.toMatch(/\bhref=/);
    expect(buttonTag).not.toContain('type="submit"');
    expect(buttonTag).not.toContain("disabled");
  });
});
