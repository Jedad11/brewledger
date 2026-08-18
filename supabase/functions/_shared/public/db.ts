// Imported ONLY by public-* functions. Never import _shared/console/ here.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export function createPublicClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
}

// public-menu's menu_categories read is the one documented exception (WBS
// 3.7 design §1) — menu_categories has zero anon RLS policy, so that one
// query runs as service_role, then narrows through toPublicMenuCategory
// before anything reaches the response. Every other public-* read uses
// createPublicClient() above.
export function createServiceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
