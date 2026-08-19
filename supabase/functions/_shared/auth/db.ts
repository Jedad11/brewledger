// Shared by auth-* functions only (currently just console-auth-request-otp).
// Not a public-* or console-* surface (WBS 4.1 §1) — auth_attempts has zero
// RLS policies (packages/db/migrations/0024_auth_attempts.sql), so every
// read/write here must go through service_role.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function createAuthServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
