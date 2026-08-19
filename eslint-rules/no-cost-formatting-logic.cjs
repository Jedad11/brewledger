"use strict";

// RL-3 backstop for packages/ui (WBS 2.2). Modeled directly on
// no-db-row-spread.cjs's structure and its honesty about scope: this is
// defence in depth, not a soundness proof. packages/ui is imported by
// apps/shop (unauthenticated) — a formatting component should only ever
// *render* a cost/margin/profit figure it was handed as a prop, never
// *derive* one. Deriving one here would mean packages/ui silently grows
// cost-shaped business logic that apps/shop's bundle would then ship,
// regardless of whether apps/shop's own data-fetching ever populates the
// inputs (the RL-3 acceptance line: "packages/ui contains no cost, margin,
// or profit formatting logic beyond MoneyValue's null handling").
//
// Scope, honestly: this flags (a) binary arithmetic (-, *, /) where an
// operand identifier matches /cost|margin|profit/i, and (b) declaring or
// assigning to a local/prop identifier named like a cost figure
// (marginPercent, profitSatang, totalCost, ...) — a naming-convention
// check, not sound, but cheap and catches the common case. It does not
// understand data flow across function boundaries and will miss a
// deliberately obfuscated case (renaming the identifier, doing the
// arithmetic in a differently-named helper). The primary guarantee remains
// the component prop contracts themselves (docs/ui/design_system_port_design.md
// §2) plus code review.

const MESSAGE_ARITHMETIC =
  "RL-3 violation: packages/ui must not derive a cost/margin/profit figure — only render one it was handed as a prop. See WBS 2.2.";
const MESSAGE_IDENTIFIER =
  "RL-3 violation: a cost/margin/profit-shaped identifier in packages/ui suggests this component is computing a financial figure, not just rendering one. See WBS 2.2.";

const COST_WORD = /cost|margin|profit/i;
const ARITHMETIC_OPERATORS = new Set(["-", "*", "/"]);

function isCostLike(node) {
  if (!node) return false;
  if (node.type === "Identifier") return COST_WORD.test(node.name);
  if (node.type === "MemberExpression" && node.property.type === "Identifier") {
    return COST_WORD.test(node.property.name);
  }
  return false;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow cost/margin/profit arithmetic or cost-shaped identifiers inside packages/ui components (RL-3), except the two files sanctioned to implement MoneyValue's null-handling.",
    },
    messages: {
      arithmetic: MESSAGE_ARITHMETIC,
      identifier: MESSAGE_IDENTIFIER,
    },
    schema: [],
  },
  create(context) {
    return {
      BinaryExpression(node) {
        if (!ARITHMETIC_OPERATORS.has(node.operator)) return;
        if (isCostLike(node.left) || isCostLike(node.right)) {
          context.report({ node, messageId: "arithmetic" });
        }
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && COST_WORD.test(node.id.name)) {
          context.report({ node: node.id, messageId: "identifier" });
        }
      },
    };
  },
};
