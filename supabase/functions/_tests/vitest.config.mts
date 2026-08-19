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
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "npm:@supabase/supabase-js@2": "@supabase/supabase-js",
    },
  },
});
