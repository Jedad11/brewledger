// WBS 4.7 — RL-2 static guard: "No gate can be satisfied only by entering a
// BOM." Every feature flag's unlock condition in features.ts must be a pure
// tier comparison against merchants.subscription_tier -- never a check
// against bom_lines (or any recipe/ingredient-shaped input). This is the
// exact automated check features.ts's own header comment (rule #2) names by
// file: "See features.rl2.test.ts (qa_engineer) for the automated check."
//
// AST-based, not a raw text grep: features.ts's own header/inline comments
// legitimately discuss "bom_lines" BY NAME, repeatedly, to document this
// very rule (see the sanity test below). A plain string search over the
// full file text would false-positive on that prose -- it would be
// checking the file's explanation of the constraint, not the constraint
// itself. Parsing with the TypeScript compiler API and walking only real
// syntax nodes checks what actually matters: comments are trivia attached
// to tokens, never visited by ts.forEachChild, so only identifiers and
// string literals that are actually PART OF THE CODE (FEATURE_MATRIX,
// isFeatureAvailable, resolveFeatureDenial, etc.) are scanned.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import * as features from "./features";

// __dirname (not import.meta.url) to match this monorepo's existing
// static-scan test convention (packages/db/tests/rl1_no_gateway_sdk_imports
// .test.ts) and to stay compatible with this package's tsconfig.tests.json,
// which does not enable a --module target import.meta is allowed under.
const FEATURES_SOURCE_PATH = join(__dirname, "features.ts");
const FEATURES_SOURCE = readFileSync(FEATURES_SOURCE_PATH, "utf8");

/** Every real syntax-tree identifier and string literal in features.ts whose
 * text contains "bom_lines" (case-insensitive, so a hypothetical `Bom_Lines`
 * or `BOM_LINES` rename can't slip past a case-sensitive check either). */
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

describe("WBS 4.7 — RL-2: no feature flag's unlock condition references bom_lines", () => {
  it(
    "sanity: features.ts's own comments DO mention bom_lines by name (proves the AST scan below is " +
      "actually excluding comments, not just scanning an empty or irrelevant file)",
    () => {
      expect(FEATURES_SOURCE).toMatch(/bom_lines/);
    },
  );

  it("no identifier or string literal in the real syntax tree (comments excluded) references bom_lines anywhere in features.ts", () => {
    const sourceFile = ts.createSourceFile(FEATURES_SOURCE_PATH, FEATURES_SOURCE, ts.ScriptTarget.Latest, true);

    const offenders = findBomLinesReferences(sourceFile);

    expect(offenders).toEqual([]);
  });

  it(
    "isFeatureAvailable and resolveFeatureDenial each take exactly two arguments (tier, flag) -- no hidden " +
      "third argument through which a BOM/recipe-shaped input could smuggle a gate condition in at the call site",
    () => {
      expect(features.isFeatureAvailable.length).toBe(2);
      expect(features.resolveFeatureDenial.length).toBe(2);
    },
  );

  it("every entry in FEATURE_MATRIX has exactly the two documented keys (minTier, comingSoon) -- no extra field a BOM check could hide behind", () => {
    for (const [flag, def] of Object.entries(features.FEATURE_MATRIX)) {
      expect(Object.keys(def).sort()).toEqual(["comingSoon", "minTier"]);
      expect(typeof def.minTier).toBe("string");
      expect(typeof def.comingSoon).toBe("boolean");
      // Guards against a future "minTier: undefined, requiresBom: true"-style
      // regression being silently accepted by a looser assertion above.
      expect(flag.length).toBeGreaterThan(0);
    }
  });
});
