// Root-level lint pass: enforces the RL-3 import boundary (WBS 3.1).
// apps/console lints itself with its own config.
// apps/api (NestJS) was removed in WBS 3.7 — its only endpoint (a health
// check wired to Prisma) had no target in the Edge Function/worker split.
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
import { fileURLToPath } from "node:url";
import localRules from "./eslint-rules/index.cjs";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

const importResolverSettings = {
  // eslint-plugin-import's default node resolver only tries .js/.json —
  // without this, every .ts import silently fails to resolve and the
  // zone check below never fires.
  "import/resolver": {
    node: { extensions: [".js", ".jsx", ".ts", ".tsx", ".d.ts"] },
  },
};

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
    settings: importResolverSettings,
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
              from: "./packages/costing",
              message:
                "apps/shop (Customer Web) may never import packages/costing — cost, margin and BOM logic is merchant-only. RL-3.",
            },
            {
              target: "./apps/shop",
              from: "./packages/db",
              message:
                "apps/shop (Customer Web) may never import packages/db directly — it must go through the allow-listed /api/public/* endpoints. RL-3.",
            },
            {
              target: "./apps/shop",
              from: "./packages/shared/src/supabase/admin.ts",
              message:
                "apps/shop (Customer Web) may never import the service_role admin client — it has zero legitimate server-side use here; that's Edge Function / worker territory. RL-3, WBS 3.2.",
            },
          ],
        },
      ],
    },
  },
  {
    // Anti-spread backstop (WBS 3.7, docs/api/surfaces_design.md §4) — a
    // separate block because it needs type-checked parserOptions.project,
    // which the plain import-boundary rule above does not. apps/shop has no
    // tsconfig yet (not scaffolded), so this glob matches nothing today and
    // activates automatically once the workspace exists, same as the zones
    // above.
    files: ["apps/shop/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: true,
        tsconfigRootDir: rootDir,
      },
    },
    plugins: { local: localRules },
    rules: {
      "local/no-db-row-spread": "error",
    },
  },
  {
    // apps/console is server-authenticated (phone OTP) and will eventually
    // have a legitimate route-handler use for the admin client. It has no
    // established client/server directory split yet (single server component
    // at apps/console/src/app/page.tsx) — so for now this bans the admin
    // import repo-wide from apps/console too, matching apps/shop's zone.
    // Revisit once console has a real client-component convention to scope
    // the ban to (WBS 3.2 follow-up).
    files: ["apps/console/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { import: importPlugin },
    settings: importResolverSettings,
    rules: {
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./apps/console",
              from: "./packages/shared/src/supabase/admin.ts",
              message:
                "apps/console has no established client/server split yet — the service_role admin client is banned repo-wide here for now. See eslint.config.mjs comment and WBS 3.2.",
            },
          ],
        },
      ],
    },
  },
];
