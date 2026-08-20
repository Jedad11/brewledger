// WBS 4.7 — single source of truth for subscription-tier feature gating.
// Consumed by BOTH apps/console (useFeature, apps/console/src/lib/features.ts)
// and supabase/functions/console-* (requireFeature,
// supabase/functions/_shared/console/features.ts) so the two runtimes can
// never disagree on what a tier unlocks.
//
// RL-2 (No forced BOM): this file's unlock condition for every flag is a
// tier comparison against merchants.subscription_tier ONLY. Nothing here
// reads or references bom_lines, and nothing ever will — a feature gate
// must never become a second, coercive path to "enter a recipe to unlock
// this." See features.rl2.test.ts (qa_engineer) for the automated check.
//
// Two absolute rules from the WBS entry, both encoded structurally below
// rather than left to convention:
//   1. Every flag a free-tier merchant needs to sell and get paid
//      (ordering, PromptPay payment, order/status management, cash sale,
//      basic revenue, menu, store settings) has minTier: "free" and
//      comingSoon: false — isFeatureAvailable("free", flag) is true for
//      every one of them by construction.
//   2. growth/scale features are Phase 2 product, not built yet — they
//      carry comingSoon: true and are UNAVAILABLE on every tier including
//      a merchant nominally already on growth/scale, until the underlying
//      feature ships and this file is edited to flip the flag.
export type SubscriptionTier = "free" | "starter" | "growth" | "scale";

const TIER_ORDER: readonly SubscriptionTier[] = ["free", "starter", "growth", "scale"];

export type FeatureFlag =
  // Always available on every tier including free — never gate these.
  | "preorder_pickup"
  | "promptpay_payment"
  | "order_queue"
  | "cash_sale"
  | "daily_revenue_total"
  | "menu_management"
  | "store_settings"
  // starter adds
  | "unit_costing"
  | "cost_drift_alerts"
  | "ingredient_stock_tracking"
  // growth adds — Phase 2, not built, always "coming soon"
  | "cashflow_forecast"
  | "ai_advisor"
  // scale adds — Phase 2, not built, always "coming soon"
  | "multi_branch"
  | "tax_suite"
  | "priority_support";

interface FeatureDef {
  minTier: SubscriptionTier;
  comingSoon: boolean;
}

export const FEATURE_MATRIX: Readonly<Record<FeatureFlag, FeatureDef>> = {
  preorder_pickup: { minTier: "free", comingSoon: false },
  promptpay_payment: { minTier: "free", comingSoon: false },
  order_queue: { minTier: "free", comingSoon: false },
  cash_sale: { minTier: "free", comingSoon: false },
  daily_revenue_total: { minTier: "free", comingSoon: false },
  menu_management: { minTier: "free", comingSoon: false },
  store_settings: { minTier: "free", comingSoon: false },

  unit_costing: { minTier: "starter", comingSoon: false },
  cost_drift_alerts: { minTier: "starter", comingSoon: false },
  ingredient_stock_tracking: { minTier: "starter", comingSoon: false },

  cashflow_forecast: { minTier: "growth", comingSoon: true },
  ai_advisor: { minTier: "growth", comingSoon: true },

  multi_branch: { minTier: "scale", comingSoon: true },
  tax_suite: { minTier: "scale", comingSoon: true },
  priority_support: { minTier: "scale", comingSoon: true },
};

// The exact flag set the free tier must never gate (WBS 4.7 absolute rule
// #1) — exported as data, not just enforced by convention, so a test can
// assert isFeatureAvailable("free", flag) for each one without hand-copying
// this list a second time.
export const ALWAYS_AVAILABLE_FLAGS: readonly FeatureFlag[] = (
  Object.keys(FEATURE_MATRIX) as FeatureFlag[]
).filter((flag) => FEATURE_MATRIX[flag].minTier === "free" && !FEATURE_MATRIX[flag].comingSoon);

export function isFeatureAvailable(tier: SubscriptionTier, flag: FeatureFlag): boolean {
  const def = FEATURE_MATRIX[flag];
  if (def.comingSoon) return false;
  return TIER_ORDER.indexOf(tier) >= TIER_ORDER.indexOf(def.minTier);
}

export type FeatureDenialCode = "tier_too_low" | "coming_soon";

export interface FeatureDenialReason {
  flag: FeatureFlag;
  code: FeatureDenialCode;
  currentTier: SubscriptionTier;
  requiredTier: SubscriptionTier;
}

/** Returns null when the flag is available; otherwise a machine-readable reason. */
export function resolveFeatureDenial(
  tier: SubscriptionTier,
  flag: FeatureFlag,
): FeatureDenialReason | null {
  if (isFeatureAvailable(tier, flag)) return null;
  const def = FEATURE_MATRIX[flag];
  return {
    flag,
    code: def.comingSoon ? "coming_soon" : "tier_too_low",
    currentTier: tier,
    requiredTier: def.minTier,
  };
}

export interface TierFeatureRow {
  flag: FeatureFlag;
  minTier: SubscriptionTier;
  comingSoon: boolean;
}

/** Flat list form of FEATURE_MATRIX, ordered by tier then declaration order — for rendering a comparison table. */
export const FEATURE_ROWS: readonly TierFeatureRow[] = (Object.keys(FEATURE_MATRIX) as FeatureFlag[]).map(
  (flag) => ({ flag, ...FEATURE_MATRIX[flag] }),
);
