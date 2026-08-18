// service_role client — bypasses Row Level Security entirely. RL-3.
//
// Must never be imported from apps/shop (Customer Web, public/unauthenticated)
// and, until apps/console has an established client/server directory split,
// must not be imported from apps/console either. Legitimate callers today are
// Supabase Edge Functions and the Render worker — see eslint.config.mjs.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

if (typeof (globalThis as { window?: unknown }).window !== "undefined") {
  throw new Error(
    "RL-3: service_role client imported into a browser bundle. See WBS 3.2.",
  );
}

// TODO: packages/db/src/types.ts now exists (WBS 3.5), but packages/db still
// depends on @prisma/client (Node-only). Wire this to the real Database type
// via a type-only subpath export from packages/db once that package no
// longer pulls Prisma into anything a browser bundle could reach — don't
// add a runtime dependency on packages/db to this file in the meantime.
type Database = Record<string, unknown>;

export function createAdminClient(
  supabaseUrl: string,
  serviceRoleKey: string,
): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
