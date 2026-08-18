"use strict";

// RL-3 backstop. See docs/api/surfaces_design.md §4 for the honest scope of
// this rule: it catches a spread/Object.assign/structuredClone on a value
// whose type is EITHER (a) a type alias imported from
// packages/db/src/types.ts, or (b) a local type alias whose name matches
// /Row$/ — the generated-types naming convention this codebase's Row/Insert/
// Update shapes already follow. It does not attempt full structural
// subtyping against every table's Row shape; that would require checking
// every spread in the codebase against 18 known shapes and would still miss
// a deliberately obfuscated case. This is defence in depth, not a soundness
// proof — the primary guarantee remains the hand-written builders in
// packages/shared/src/serializers/public.ts plus code review.

const { ESLintUtils } = require("@typescript-eslint/utils");

const MESSAGE = "RL-3 violation: build public DTOs field by field. See WBS 3.7.";
const DB_TYPES_PATH = /packages[\\/]db[\\/]src[\\/]types\.ts$/;
const ROW_SUFFIX = /Row$/;

const createRule = ESLintUtils.RuleCreator(
  () => "https://github.com/brewledger/brewledger/blob/main/docs/api/surfaces_design.md#4",
);

function isRowType(type) {
  if (!type) return false;

  const aliasSymbol = type.aliasSymbol;
  if (aliasSymbol) {
    if (ROW_SUFFIX.test(aliasSymbol.name)) return true;
    const decl = aliasSymbol.declarations && aliasSymbol.declarations[0];
    if (decl) {
      const fileName = decl.getSourceFile().fileName;
      if (DB_TYPES_PATH.test(fileName)) return true;
    }
  }

  const symbol = type.symbol || type.getSymbol?.();
  if (symbol) {
    if (ROW_SUFFIX.test(symbol.name)) return true;
    const decl = symbol.declarations && symbol.declarations[0];
    if (decl) {
      const fileName = decl.getSourceFile().fileName;
      if (DB_TYPES_PATH.test(fileName)) return true;
    }
  }

  return false;
}

module.exports = createRule({
  name: "no-db-row-spread",
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow spreading, Object.assign-ing, or structuredClone-ing a DB row type into a public DTO.",
    },
    messages: {
      rowSpread: MESSAGE,
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = ESLintUtils.getParserServices(context);
    const checker = services.program.getTypeChecker();

    function checkNode(node) {
      const tsNode = services.esTreeNodeToTSNodeMap.get(node);
      const type = checker.getTypeAtLocation(tsNode);
      if (isRowType(type)) {
        context.report({ node, messageId: "rowSpread" });
      }
    }

    return {
      "ObjectExpression > SpreadElement"(node) {
        checkNode(node.argument);
      },
      "CallExpression"(node) {
        const callee = node.callee;
        const isObjectAssign =
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "Object" &&
          callee.property.type === "Identifier" &&
          callee.property.name === "assign";
        const isStructuredClone =
          callee.type === "Identifier" && callee.name === "structuredClone";

        if (!isObjectAssign && !isStructuredClone) return;

        for (const arg of node.arguments) {
          if (arg.type === "SpreadElement") continue;
          checkNode(arg);
        }
      },
    };
  },
});
