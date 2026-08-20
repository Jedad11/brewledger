// WBS 4.7 — absolute rule #1: "A merchant on 'free' can complete the entire
// sell-and-get-paid loop." The WBS entry names the loop explicitly:
// pre-order/pickup, PromptPay payment, order queue and status management,
// cash sale entry, basic daily revenue total, menu management, store
// settings. None of those may ever be gated, on any tier, including free.
//
// No order/payment/queue/cash-sale Edge Function exists yet to drive this
// loop end-to-end over real HTTP (see CLAUDE.md's migration table -- WBS 5.x
// is unbuilt; only console-auth-request-otp and public-* exist under
// supabase/functions today). What DOES exist, and is the actual mechanism
// that would deny a free-tier merchant if WBS 4.7 were wired wrong, is:
//   1. packages/shared/src/features.ts's FEATURE_MATRIX / ALWAYS_AVAILABLE_FLAGS
//      / isFeatureAvailable / resolveFeatureDenial -- the single source of
//      truth consumed by both runtimes (features.ts's own header comment).
//   2. requireFeature(ctx, flag) in _shared/console/features.ts -- the ONLY
//      sanctioned way a console-* Edge Function handler checks a tier gate
//      (that file's own header comment); every future order/payment/queue
//      handler will call this, not hand-roll its own tier check.
// This test drives BOTH of those directly against a real free-tier
// ConsoleContext, which is exactly what "requireFeature/isFeatureAvailable
// never denies for a free-tier context" (this entry's own acceptance
// criterion) asks for. When WBS 5.x's real handlers exist, an actual HTTP
// integration test can be layered on top of this one -- this test does not
// become redundant then, because it is the one that pins the tier-gate
// LOGIC itself, independent of which handler happens to call it.
//
// Imports resolve via this package's own vitest.config.mts, which aliases
// both the Deno-only "npm:@supabase/supabase-js@2" specifier and
// "@brewledger/shared/features" (the specifier _shared/console/auth.ts and
// _shared/console/features.ts use, resolvable under Deno via
// supabase/functions/deno.json's import map but not under plain Node/Vite
// without this alias) -- see that config file's header comment. No
// production file is modified to make these imports work.
import { describe, expect, it } from "vitest";
import type { ConsoleContext } from "../_shared/console/auth.ts";
import { requireFeature, FeatureNotAvailableError } from "../_shared/console/features.ts";
import {
  ALWAYS_AVAILABLE_FLAGS,
  FEATURE_MATRIX,
  isFeatureAvailable,
  resolveFeatureDenial,
  type FeatureFlag,
} from "@brewledger/shared/features";

function freeCtx(): ConsoleContext {
  return {
    merchantId: "00000000-0000-0000-0000-0000000000ff",
    subscriptionTier: "free",
    storeIds: ["11111111-1111-4111-8111-111111111111"],
    // requireFeature never touches ctx.supabase -- it only reads
    // ctx.subscriptionTier. A real SupabaseClient is deliberately not
    // constructed here, same idiom as console_auth_scoping.test.ts's
    // fakeCtx().
    supabase: {} as ConsoleContext["supabase"],
  };
}

// The exact set the WBS 4.7 entry names, spelled out here (not just "some
// non-empty array") so a future edit that silently drops one of these flags
// from ALWAYS_AVAILABLE_FLAGS -- e.g. by tightening its minTier or flipping
// comingSoon: true by mistake -- fails this test with a clear diff, not by
// coincidence.
const EXPECTED_SELL_AND_GET_PAID_LOOP_FLAGS: readonly FeatureFlag[] = [
  "preorder_pickup",
  "promptpay_payment",
  "order_queue",
  "cash_sale",
  "daily_revenue_total",
  "menu_management",
  "store_settings",
];

// Flags the WBS entry explicitly gates above free (starter/growth/scale) --
// used below to prove ALWAYS_AVAILABLE_FLAGS hasn't been polluted with a
// flag that should NOT be free, which would make the "never denies" tests
// pass for the wrong reason.
const KNOWN_GATED_FLAGS: readonly FeatureFlag[] = [
  "unit_costing",
  "cost_drift_alerts",
  "ingredient_stock_tracking",
  "cashflow_forecast",
  "ai_advisor",
  "multi_branch",
  "tax_suite",
  "priority_support",
];

describe("WBS 4.7 — free tier: the entire sell-and-get-paid loop, with no gate ever hit", () => {
  it("ALWAYS_AVAILABLE_FLAGS is exactly the WBS-named loop -- no more, no fewer, order-independent", () => {
    expect([...ALWAYS_AVAILABLE_FLAGS].sort()).toEqual([...EXPECTED_SELL_AND_GET_PAID_LOOP_FLAGS].sort());
  });

  it("sanity: KNOWN_GATED_FLAGS and EXPECTED_SELL_AND_GET_PAID_LOOP_FLAGS are disjoint and together cover every flag in FEATURE_MATRIX (so the two lists below aren't silently stale against a newly added flag)", () => {
    const allFlags = Object.keys(FEATURE_MATRIX).sort();
    const union = [...EXPECTED_SELL_AND_GET_PAID_LOOP_FLAGS, ...KNOWN_GATED_FLAGS].sort();
    expect(union).toEqual(allFlags);
  });

  it.each(EXPECTED_SELL_AND_GET_PAID_LOOP_FLAGS)("isFeatureAvailable('free', %s) is true", (flag) => {
    expect(isFeatureAvailable("free", flag)).toBe(true);
  });

  it.each(EXPECTED_SELL_AND_GET_PAID_LOOP_FLAGS)("resolveFeatureDenial('free', %s) is null (no denial reason at all)", (flag) => {
    expect(resolveFeatureDenial("free", flag)).toBeNull();
  });

  it.each(EXPECTED_SELL_AND_GET_PAID_LOOP_FLAGS)("requireFeature(freeCtx, %s) does not throw", (flag) => {
    expect(() => requireFeature(freeCtx(), flag)).not.toThrow();
  });

  it(
    "runs the full loop as a single free-tier merchant session, checking every step in the WBS-listed " +
      "order, and asserts NO gate is hit at any point (the integration-shaped assertion this entry's " +
      "Claude Code Prompt asks for, at the level a tier gate can actually intercept)",
    () => {
      const ctx = freeCtx();
      const denialsHit: string[] = [];

      // The order a merchant actually walks the loop: set up the store and
      // menu first, then take and fulfil an order, then look at today's
      // takings.
      const loopSteps: FeatureFlag[] = [
        "store_settings",
        "menu_management",
        "preorder_pickup",
        "promptpay_payment",
        "order_queue",
        "cash_sale",
        "daily_revenue_total",
      ];

      for (const flag of loopSteps) {
        try {
          requireFeature(ctx, flag);
        } catch (err) {
          if (err instanceof FeatureNotAvailableError) {
            denialsHit.push(`${flag}: ${err.reason.code} (requires ${err.reason.requiredTier})`);
          } else {
            throw err;
          }
        }
      }

      expect(denialsHit).toEqual([]);
    },
  );

  it.each(KNOWN_GATED_FLAGS)(
    "control case -- a flag the WBS explicitly gates above free (%s) DOES deny on the free tier, proving the loop assertions above aren't vacuously true because requireFeature never denies anything",
    (flag) => {
      expect(isFeatureAvailable("free", flag)).toBe(false);
      expect(() => requireFeature(freeCtx(), flag)).toThrow(FeatureNotAvailableError);
    },
  );
});
