// Edge Functions are a third, separate lint root from the root
// eslint.config.mjs's apps/shop <-> apps/console boundary — this config
// enforces the disjoint public-* / console-* scopes designed in
// docs/api/surfaces_design.md §1. Deno lint runs separately in CI for
// Deno-specific concerns; this ESLint pass is the RL-3 boundary check only.
import importPlugin from "eslint-plugin-import";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";
import localRules from "../../eslint-rules/index.cjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

const importResolverSettings = {
  "import/resolver": {
    node: { extensions: [".js", ".ts"] },
  },
};

export default [
  {
    ignores: ["**/node_modules/**"],
  },
  {
    files: ["supabase/functions/public-*/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: rootDir,
      },
    },
    plugins: { import: importPlugin, local: localRules },
    settings: importResolverSettings,
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./supabase/functions/public-*/**",
              from: "./supabase/functions/_shared/console",
              message: "public-* may never import _shared/console/ — RL-3, WBS 3.7.",
            },
          ],
        },
      ],
      "local/no-db-row-spread": "error",
    },
  },
  {
    files: ["supabase/functions/console-*/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: { import: importPlugin },
    settings: importResolverSettings,
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./supabase/functions/console-*/**",
              from: "./supabase/functions/_shared/public",
              message: "console-* may never import _shared/public/ — keep the scopes disjoint, WBS 3.7.",
            },
          ],
        },
      ],
    },
  },
];
