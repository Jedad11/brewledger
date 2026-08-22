import path from "node:path";
import { defineConfig } from "vitest/config";

// This app has no vitest.config.ts until now (see the header comments on
// actions.test.ts / MenuItemEditorForm.test.tsx / PaymentsSettingsForm.test.tsx,
// all of which work around the absence of a tsconfig-paths alias plugin by
// mocking every bare "@/..." specifier they touch, even when they want the
// real implementation -- `vi.mock("@/lib/slug", async () => vi.importActual(
// "../../../../../lib/slug"))`). That workaround is enough for the default
// "node" test environment, where an unresolved bare specifier is deferred to
// runtime (Vitest's mock registry gets a chance to intercept it before
// Node's own resolver ever sees it) -- but it does NOT work under a jsdom
// (or any browser-like) environment: Vite's import-analysis pass there needs
// every specifier to resolve to a real URL up front, before any mock
// factory runs, so an alias-less "@/..." import is a hard transform-time
// error regardless of vi.mock. StoreProfileForm.test.tsx is this app's first
// jsdom-environment test (added alongside jsdom + @testing-library/react as
// devDependencies, see apps/console/package.json) and hit exactly this --
// confirmed by reproducing the failure with a minimal repro file and
// removing/re-adding the `@vitest-environment jsdom` pragma. This alias
// mirrors tsconfig.json's own `"paths": { "@/*": ["./src/*"] } and is the
// standard fix (equivalent to what vite-tsconfig-paths would infer), scoped
// to path resolution only -- it changes nothing about how any existing test
// runs (mocked specifiers still take priority at runtime regardless of
// whether they're also resolvable), it only makes bare "@/..." specifiers
// resolvable at all for a jsdom-environment file that needs it.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
