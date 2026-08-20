// WBS 4.7 — server-side feature gate for console-* Edge Functions.
// `requireFeature` is the ONLY sanctioned way a handler checks a tier gate:
// it throws FeatureNotAvailableError, which withConsoleAuth's catch block
// (auth.ts) turns into a 402 with the machine-readable `reason` attached --
// same "hard to get wrong" posture as assertOwnedStore/ForbiddenStoreError
// for the 403 path. A handler never constructs a 402 Response by hand.
import { resolveFeatureDenial, type FeatureDenialReason, type FeatureFlag } from "@brewledger/shared/features";
import type { ConsoleContext } from "./auth.ts";

export class FeatureNotAvailableError extends Error {
  constructor(public readonly reason: FeatureDenialReason) {
    super(`feature "${reason.flag}" not available on tier "${reason.currentTier}" (${reason.code})`);
    this.name = "FeatureNotAvailableError";
  }
}

export function requireFeature(ctx: ConsoleContext, flag: FeatureFlag): void {
  const denial = resolveFeatureDenial(ctx.subscriptionTier, flag);
  if (denial) {
    throw new FeatureNotAvailableError(denial);
  }
}
