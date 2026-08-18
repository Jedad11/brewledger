import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// TODO(WBS 3.5): replace with generated packages/db/src/types.ts once it exists.
type Database = Record<string, unknown>;

export function createBrowserClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
): SupabaseClient<Database> {
  return createClient<Database>(supabaseUrl, supabaseAnonKey);
}
