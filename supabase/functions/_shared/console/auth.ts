// Deny-by-default, non-optional by construction: a console-* function is
// required to obtain its request context by calling withConsoleAuth below.
// See docs/api/surfaces_design.md §5.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface ConsoleContext {
  merchantId: string;
  storeIds: string[];
  supabase: SupabaseClient; // authenticated-role client, RLS applies as this user
}

/**
 * Verifies the request's Supabase JWT (Authorization: Bearer <token>),
 * resolves auth.uid() to a merchants row, and returns the merchant's id
 * plus every store_id they own (via the same auth_store_ids() the RLS
 * layer uses — one source of truth for "which stores does this user own",
 * not a second hand-rolled query that could drift from the RLS definition).
 *
 * Returns `null` on ANY failure (missing header, invalid/expired JWT, no
 * matching merchants row) -- the caller (withConsoleAuth below) is
 * responsible for turning that into a 401 with no body detail. This
 * function itself never throws and never leaks WHY verification failed.
 */
export async function verifyConsoleRequest(req: Request): Promise<ConsoleContext | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!, // NEVER service_role here — this
    { global: { headers: { Authorization: authHeader } } },
    // client authenticates AS the caller; RLS on every subsequent query
    // enforces store scoping independently of this function's own logic.
  );

  const { data: userData, error } = await supabase.auth.getUser();
  if (error || !userData.user) return null;

  const { data: storeIds, error: storeErr } = await supabase.rpc("auth_store_ids");
  if (storeErr) return null;

  const { data: merchant, error: merchantErr } = await supabase
    .from("merchants")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .single();
  if (merchantErr || !merchant) return null;

  return {
    merchantId: merchant.id,
    storeIds: (storeIds ?? []).map((row: { auth_store_ids: string }) => row.auth_store_ids),
    supabase,
  };
}

/**
 * Handler-factory: the ONLY sanctioned way to define a console-* Edge
 * Function handler. `handler` cannot be written without accepting a
 * ConsoleContext parameter -- there is no code path to a console-* response
 * body that does not pass through verifyConsoleRequest first. A function
 * file that calls Deno.serve(rawHandler) directly instead of going through
 * this factory is the review-blocking violation to look for; there is no
 * lint rule for it (a runtime code-shape check has diminishing returns
 * versus review), so it is called out explicitly here as a manual review
 * item for redline_reviewer.
 */
export function withConsoleAuth(
  handler: (req: Request, ctx: ConsoleContext) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const ctx = await verifyConsoleRequest(req);
    if (!ctx) {
      return new Response(null, { status: 401 }); // no body -- no detail leaked
    }
    return handler(req, ctx);
  };
}
