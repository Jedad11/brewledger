// WBS 4.7 — client-side feature gate, reading tier from the session context
// (useMerchant(), MerchantProvider — resolved server-side once per request
// in (app)/layout.tsx, same posture as every other MerchantCtx read in this
// app; see lib/MerchantProvider.tsx's own header comment on why there is no
// client-side loading/error branch to get wrong here).
"use client";

import { useMerchant } from "./MerchantProvider";
import {
  isFeatureAvailable,
  resolveFeatureDenial,
  type FeatureFlag,
  type FeatureDenialReason,
} from "@brewledger/shared/dist/features";

export function useFeature(flag: FeatureFlag): boolean {
  const { subscriptionTier } = useMerchant();
  return isFeatureAvailable(subscriptionTier, flag);
}

/** null when the flag is available -- callers render the gated content in that case, never a blank/disabled fallback. */
export function useFeatureDenial(flag: FeatureFlag): FeatureDenialReason | null {
  const { subscriptionTier } = useMerchant();
  return resolveFeatureDenial(subscriptionTier, flag);
}

export type { FeatureFlag, FeatureDenialReason };
