"use client";

import { useMerchant } from "@/lib/MerchantProvider";
import { Button, Card } from "@brewledger/ui";
import {
  ALWAYS_AVAILABLE_NOTE,
  CURRENT_PLAN_LABEL,
  CURRENT_PLAN_TAG,
  FEE_STATEMENT_TH,
  PLAN_DISPLAY,
  PLAN_ORDER,
  SELECT_PLAN_LABEL,
  UPGRADE_CARD_HEADING,
  UPGRADE_ROWS,
} from "./copy";

// WBS 4.7 — /console/settings/subscription. Card-based design per explicit
// product-owner override (2026-08-23), reproducing design/console-setup.js's
// scPlan() structure: current-plan card, then a 4-card .oc-plans grid, then
// an upgrade-benefit checklist card. See copy.ts's header comment for why
// this replaces the earlier feature-matrix-table build.
//
// RL-2: nothing on this screen reads or renders anything derived from
// bom_lines; plan selection is a pure tier comparison against
// subscriptionTier, never a recipe-completeness check.
//
// No self-serve upgrade action exists yet (no Edge Function / Server Action
// backs a tier change) — the non-current-plan buttons render per the
// prototype's markup but are not wired to a handler, same posture as the
// prior build, which had no plan-selection affordance at all.
export function SubscriptionPlanView() {
  const { subscriptionTier } = useMerchant();
  const current = PLAN_DISPLAY[subscriptionTier];

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <p className="note-plain">{CURRENT_PLAN_LABEL}</p>
        <h3>
          {current.name} · {current.price}
        </h3>
        <p className="note-plain">{ALWAYS_AVAILABLE_NOTE}</p>
        <p className="note-plain">{FEE_STATEMENT_TH}</p>
      </Card>

      <div className="oc-plans">
        {PLAN_ORDER.map((tier) => {
          const plan = PLAN_DISPLAY[tier];
          const isCurrent = tier === subscriptionTier;
          return (
            <div key={tier} className={`card oc-plan${isCurrent ? " is-cur" : ""}`}>
              <b>{plan.name}</b>
              <div className="oc-planprice">{plan.price}</div>
              <p className="note-plain">{plan.description}</p>
              {isCurrent ? (
                <span className="st st--making">{CURRENT_PLAN_TAG}</span>
              ) : (
                <Button variant="outline" type="button">
                  {SELECT_PLAN_LABEL}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <Card>
        <h3>{UPGRADE_CARD_HEADING}</h3>
        <div className="oc-rows">
          {UPGRADE_ROWS.map((row) => (
            <div key={row} className="oc-row" style={{ gridTemplateColumns: "auto 1fr" }}>
              <span className="oc-tick">✓</span>
              <span>{row}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
