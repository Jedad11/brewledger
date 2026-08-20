// Deny-by-default, non-optional by construction: a console-* function is
// required to obtain its request context by calling withConsoleAuth below.
// See docs/api/surfaces_design.md §5.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { SubscriptionTier } from "@brewledger/shared/features";
import { FeatureNotAvailableError } from "./features.ts";

export interface ConsoleContext {
  merchantId: string;
  subscriptionTier: SubscriptionTier; // WBS 4.7 — read by requireFeature(ctx, flag), features.ts
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
    .select("id, subscription_tier")
    .eq("auth_user_id", userData.user.id)
    .single();
  if (merchantErr || !merchant) return null;

  return {
    merchantId: merchant.id,
    // subscription_tier has a NOT NULL default of 'free' with a check
    // constraint over the four-tier set (migration 0002) -- safe cast, no
    // runtime fallback duplicating that constraint here.
    subscriptionTier: merchant.subscription_tier as SubscriptionTier,
    // auth_store_ids() is `returns setof uuid` -- a scalar set-returning
    // function -- so PostgREST (and supabase-js .rpc()) returns a plain
    // array of UUID strings, not an array of { auth_store_ids: string }
    // row objects. No .map needed; only a type-narrowing cast for the
    // untyped RPC return.
    storeIds: (storeIds ?? []) as string[],
    supabase,
  };
}

/**
 * Thrown by assertOwnedStore below. A distinct class (not a bare Error) so
 * withConsoleAuth can catch exactly this failure mode and turn it into a
 * 403 -- any other error a handler throws is a real bug and must not be
 * silently reshaped into an auth response.
 */
export class ForbiddenStoreError extends Error {
  constructor(storeId: string) {
    super(`store ${storeId} is not owned by the requesting merchant`);
    this.name = "ForbiddenStoreError";
  }
}

/**
 * THE CENTRAL RULE (WBS 4.2): no console handler may accept a store_id from
 * client input (body or query) and trust it. Every handler that reads a
 * store_id off the request must call this before using it. Scoping every
 * query through ctx.supabase (RLS-enforced) already stops a cross-tenant
 * READ from returning rows, but a handler that echoes the client's store_id
 * back verbatim -- into a filter, an insert, a log line -- without this
 * check would still confirm-by-side-channel that the id exists and is
 * merchant-owned or not. Never substitute ctx.storeIds[0] silently on a
 * mismatch: that would hide a genuine attack (or a genuine bug) behind a
 * response that looks like success.
 */
export function assertOwnedStore(ctx: ConsoleContext, storeId: string): void {
  if (!ctx.storeIds.includes(storeId)) {
    throw new ForbiddenStoreError(storeId);
  }
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
 *
 * Also the sanctioned catch point for assertOwnedStore: a handler calls
 * assertOwnedStore(ctx, storeId) and lets ForbiddenStoreError propagate --
 * it does not need its own try/catch to get the 403-empty-body behavior,
 * same "hard to get wrong" posture as the 401 path above.
 */
export function withConsoleAuth(
  handler: (req: Request, ctx: ConsoleContext) => Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const ctx = await verifyConsoleRequest(req);
    if (!ctx) {
      return new Response(null, { status: 401 }); // no body -- no detail leaked
    }
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ForbiddenStoreError) {
        return new Response(null, { status: 403 }); // no body -- no detail leaked
      }
      if (err instanceof FeatureNotAvailableError) {
        // Unlike the 401/403 paths above, a body IS returned here: the WBS
        // 4.7 prompt requires "a machine-readable reason" so the console
        // client can render the correct upgrade-benefit copy rather than a
        // generic failure. Nothing in `reason` is secret (it's derived
        // entirely from FEATURE_MATRIX + the caller's own tier).
        return new Response(JSON.stringify({ error: "feature_not_available", reason: err.reason }), {
          status: 402,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw err;
    }
  };
}
