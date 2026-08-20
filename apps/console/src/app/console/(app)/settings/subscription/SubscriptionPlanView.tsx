"use client";

import { useMerchant } from "@/lib/MerchantProvider";
import { Card } from "@brewledger/ui";
import {
  FEATURE_ROWS,
  isFeatureAvailable,
  type SubscriptionTier,
} from "@brewledger/shared/dist/features";
import {
  CURRENT_PLAN_PREFIX,
  ALWAYS_AVAILABLE_NOTE,
  TIER_LABEL_TH,
  GROUP_HEADING_TH,
  UPGRADE_BENEFIT_TH,
  COMING_SOON_TAG,
  INCLUDED_TAG,
  FEATURE_LABEL_TH,
} from "./copy";

// WBS 4.7 — /console/settings/subscription. Copy: docs/design/state_matrix.md
// "แผนการใช้งาน" section (added in this change; no prototype screen exists
// for this route, same posture as WBS 4.6's own StoreLinkQR.tsx). Grouped by
// unlock tier rather than a tiers-by-features grid: 4 columns x 15 rows does
// not read at 375px, and grouping is what actually answers "what does
// upgrading get me," the WBS's own framing for this screen.
//
// RL-2: this component never reads or renders anything derived from
// bom_lines -- every row's included/locked state comes from
// isFeatureAvailable(tier, flag), a pure tier comparison. See
// packages/shared/src/features.ts's own header comment.
const GROUP_ORDER: SubscriptionTier[] = ["free", "starter", "growth", "scale"];

export function SubscriptionPlanView() {
  const { subscriptionTier } = useMerchant();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <p className="text-sm text-ink-muted">{CURRENT_PLAN_PREFIX}</p>
        <p className="font-serif text-2xl font-bold leading-[1.35] text-ink">
          {TIER_LABEL_TH[subscriptionTier]}
        </p>
        <p className="mt-2 text-sm leading-[1.5] text-ink-muted">{ALWAYS_AVAILABLE_NOTE}</p>
      </Card>

      {GROUP_ORDER.map((groupTier) => {
        const rows = FEATURE_ROWS.filter((row) => row.minTier === groupTier);
        if (rows.length === 0) return null;
        const benefit = UPGRADE_BENEFIT_TH[groupTier];

        return (
          <Card key={groupTier}>
            <h2 className="mb-3 font-serif text-lg font-bold leading-[1.35] text-ink">
              {GROUP_HEADING_TH[groupTier]}
            </h2>
            <ul className="flex flex-col gap-2">
              {rows.map((row) => {
                const available = isFeatureAvailable(subscriptionTier, row.flag);
                const tag = row.comingSoon ? COMING_SOON_TAG : available ? INCLUDED_TAG : TIER_LABEL_TH[groupTier];
                return (
                  <li
                    key={row.flag}
                    className="flex min-h-11 items-center justify-between gap-3 text-sm leading-[1.5] text-ink"
                  >
                    <span>{FEATURE_LABEL_TH[row.flag]}</span>
                    <span className="rounded-full border border-ink-muted/30 px-2 py-1 text-xs text-ink-muted">
                      {tag}
                    </span>
                  </li>
                );
              })}
            </ul>
            {benefit ? (
              <p className="mt-3 text-sm leading-[1.5] text-ink-muted">{benefit}</p>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
