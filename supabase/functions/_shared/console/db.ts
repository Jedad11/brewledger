// Imported ONLY by console-* functions. Never import _shared/public/ here.
// This is a plain anon-key client factory, distinct from auth.ts's
// per-request authenticated client (which carries the caller's own JWT).
// Kept separate because a future console-* function may legitimately need
// an unauthenticated-context client (e.g. before the guard runs) without
// reaching for service_role.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function createConsoleClient(authHeader?: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    authHeader
      ? { global: { headers: { Authorization: authHeader } } }
      : undefined,
  );
}
