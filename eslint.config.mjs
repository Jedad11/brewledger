// Root-level lint pass: enforces the RL-3 import boundary (WBS 3.1).
// apps/console and apps/api lint themselves with their own configs
// (`pnpm --filter <app> lint`); this config only checks cross-app imports.
//
// The rule: apps/shop (Customer Web, public/unauthenticated) may never import
// apps/console (Owner Console) or packages/db (Prisma client + cost/margin
// schema). A bundle that cannot import the DB or the merchant UI cannot leak
// merchant-only data — this is the primary structural enforcement of RL-3.
//
// apps/shop does not exist yet (front-end work not started). The zones below
// are pre-declared so the rule activates automatically the moment that
// workspace is scaffolded — until then this config has nothing to check.
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/*.d.ts",
    ],
  },
  {
    files: ["apps/shop/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { import: importPlugin },
    settings: {
      // eslint-plugin-import's default node resolver only tries .js/.json —
      // without this, every .ts import silently fails to resolve and the
      // zone check below never fires.
      "import/resolver": {
        node: { extensions: [".js", ".jsx", ".ts", ".tsx", ".d.ts"] },
      },
    },
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./apps/shop",
              from: "./apps/console",
              message:
                "apps/shop (Customer Web) may never import apps/console (Owner Console) — RL-3.",
            },
            {
              target: "./apps/shop",
              from: "./packages/db",
              message:
                "apps/shop (Customer Web) may never import packages/db directly — it must go through the allow-listed /api/public/* endpoints. RL-3.",
            },
          ],
        },
      ],
    },
  },
];
