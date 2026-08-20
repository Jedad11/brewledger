// WBS 4.2 qa_engineer leg — test-infra-only Vitest config for this package.
//
// _shared/console/auth.ts (the module console_auth_scoping.test.ts needs to
// import directly, for a unit-level test of assertOwnedStore/
// ForbiddenStoreError independent of the HTTP roundtrip) is written for the
// Deno Edge Runtime and imports its Supabase client via the Deno-only
// "npm:@supabase/supabase-js@2" specifier. Plain Node/Vite module resolution
// does not understand that specifier ("Cannot find package
// 'npm:@supabase/supabase-js@2'"). Rather than touch the production file (out
// of scope for qa_engineer — see CLAUDE.md's agent ownership table) or
// reimplement/mock its logic (banned by this project's own testing rules),
// this alias rewrites that one import specifier to the identical npm package
// this test package already depends on. It changes nothing about what code
// runs — the same @supabase/supabase-js — it only tells Node's resolver
// where to find it.
//
// WBS 4.7 added a second import of this same shape: _shared/console/auth.ts
// (transitively, via _shared/console/features.ts) now imports
// "@brewledger/shared/features". That specifier resolves under the Deno Edge
// Runtime via supabase/functions/deno.json's own import map
// ("@brewledger/shared/features": "../../packages/shared/src/features.ts"),
// but @brewledger/shared's package.json exports only "." (./dist/index.js),
// not a "./features" subpath, so plain Node/Vite resolution fails the same
// way the npm: specifier above did ("Cannot find package
// '@brewledger/shared/features'"). Same fix, same rationale: alias the one
// specifier to the real TS source (mirroring deno.json's own mapping,
// adjusted for this file's one-directory-deeper location) rather than touch
// _shared/console/auth.ts or add an exports subpath to packages/shared's
// package.json (either would be a production-code change, out of scope for
// qa_engineer).
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "npm:@supabase/supabase-js@2": "@supabase/supabase-js",
      "@brewledger/shared/features": new URL("../../../packages/shared/src/features.ts", import.meta.url).pathname,
    },
  },
});
