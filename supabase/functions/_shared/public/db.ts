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
// before anything reaches the response. Every other public-* READ uses
// createPublicClient() above.
//
// public-create-order (WBS 5.4) is the first public-* function needing this
// for a WRITE, not a read: checkout_create_order is itself service_role-only
// (same posture as reserve_pickup_slot/release_pickup_slot, WBS 5.3) because
// it reserves a slot, snapshots cost, and writes orders/order_items/
// order_item_options in one transaction — none of which the anon key's RLS
// policies grant. The RPC call itself still goes through this same
// createServiceRoleClient(), not a third client type.
export function createServiceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
