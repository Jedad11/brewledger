// WBS 4.2 — cross-cutting shape for "who is signed in and which stores do
// they own", shared between the Edge Function guard's ConsoleContext
// (supabase/functions/_shared/console/auth.ts) and apps/console's own
// server-resolved session context (apps/console/src/lib/merchant.ts). Lives
// here, not in apps/console, because it's a plain type with no console-only
// business logic -- packages/shared is the isomorphic home for exactly this
// kind of value.
import type { SubscriptionTier } from "./features";
export type { SubscriptionTier };
//
// Deliberately has no `absorbGatewayFee` field -- see
// docs/api/surfaces_design.md §5 and ConsoleContext's own header comment.
// `absorbGatewayFee` was a Prisma-model leftover from the withdrawn
// gateway-fee plan (ADR-008 replaced it with direct merchant-owned
// PromptPay); there is no absorb_gateway_fee column in the real schema.
//
// `subscriptionTier` WAS added (WBS 4.7) -- unlike absorbGatewayFee, it maps
// to a real column (`merchants.subscription_tier`, migration 0002) and is
// exactly the value useFeature() needs from "the session context" per the
// WBS 4.7 Claude Code Prompt. See apps/console/src/lib/features.ts.
export interface MerchantStoreSummary {
  id: string;
  slug: string;
  name: string;
  isPublished: boolean;
}

export interface MerchantCtx {
  merchantId: string;
  subscriptionTier: SubscriptionTier;
  storeIds: string[];
  stores: MerchantStoreSummary[];
}
