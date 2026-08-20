"use strict";

// RL-1 backstop for WBS 5.5. Modeled on no-cost-formatting-logic.cjs's
// structure and honesty about scope. There is exactly one place in this
// codebase permitted to build an EMVCo/PromptPay payload:
// packages/shared/src/promptpay/ (buildPromptPayPayload, generate.ts). If
// a second implementation grows anywhere else, it is either dead code
// duplicating the tested one, or -- worse -- a second, untested path that
// could encode the wrong payee. Money in this system moves on the strength
// of that one function; RL-1's "the payee is always the merchant's own
// alias" guarantee is only as good as there being one place that decides
// what the payee is.
//
// Scope, honestly: this flags (a) any call to a function literally named
// `generatePayload` (the promptpay-qr package's export), (b) any import
// specifier equal to or containing "promptpay-qr", and (c) any local
// function declaration/expression whose name matches /build.*promptpay.*payload/i
// or /emvco/i. It does not trace data flow, so a deliberately obfuscated
// reimplementation (renamed import, hand-rolled TLV encoding under an
// unrelated name) would not be caught here -- same caveat
// no-cost-formatting-logic.cjs states for its own naming-convention check.
// The primary guarantee remains packages/shared/src/promptpay/'s own
// conformance suite plus code review.

const MESSAGE =
  "RL-1 violation: EMVCo/PromptPay payload construction may only happen in " +
  "packages/shared/src/promptpay/ — see buildPromptPayPayload (WBS 5.5). " +
  "A second payload-building path is either dead code or an untested one " +
  "that could send money to the wrong payee.";

const PROMPTPAY_QR_SPECIFIER = /promptpay-qr/;
const SUSPECT_FUNCTION_NAME = /build.*promptpay.*payload/i;
const EMVCO_NAME = /emvco/i;

function isSuspectName(name) {
  return !!name && (SUSPECT_FUNCTION_NAME.test(name) || EMVCO_NAME.test(name));
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow EMVCo/PromptPay payload construction outside packages/shared/src/promptpay/ (RL-1). See WBS 5.5.",
    },
    messages: { violation: MESSAGE },
    schema: [],
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        if (PROMPTPAY_QR_SPECIFIER.test(node.source.value)) {
          context.report({ node, messageId: "violation" });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "Identifier" && callee.name === "generatePayload") {
          context.report({ node, messageId: "violation" });
        }
      },
      "FunctionDeclaration"(node) {
        if (node.id && isSuspectName(node.id.name)) {
          context.report({ node, messageId: "violation" });
        }
      },
      "VariableDeclarator"(node) {
        const isFunctionValue =
          node.init && (node.init.type === "FunctionExpression" || node.init.type === "ArrowFunctionExpression");
        if (isFunctionValue && node.id.type === "Identifier" && isSuspectName(node.id.name)) {
          context.report({ node: node.id, messageId: "violation" });
        }
      },
    };
  },
};
