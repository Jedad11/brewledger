import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// TODO: packages/db/src/types.ts now exists (WBS 3.5), but packages/db still
// depends on @prisma/client (Node-only). This file ships in the browser
// bundle (apps/shop) — wire the real Database type via a type-only subpath
// export from packages/db once that package no longer pulls Prisma into
// anything a browser bundle could reach.
type Database = Record<string, unknown>;

export function createBrowserClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, supabaseAnonKey);
}
