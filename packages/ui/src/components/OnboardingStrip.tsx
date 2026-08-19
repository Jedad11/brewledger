import * as React from "react";

export type OnboardingStepId = "store" | "menu" | "payments";

export interface OnboardingStep {
  id: OnboardingStepId;
  done: boolean;
}

const STEP_LABEL_TH: Record<OnboardingStepId, string> = {
  store: "ข้อมูลร้าน",
  menu: "เมนูอย่างน้อย 1 รายการ",
  payments: "เชื่อมช่องทางรับเงิน",
};

/**
 * RL-2: a merchant can sell without ever entering a recipe. This strip must
 * never present "add a recipe" as an onboarding step alongside store/menu/
 * payments — doing so would frame the recipe as required setup, itself a
 * soft violation of "no screen may nag" even without a hard block. The
 * fixed 3-tuple (not `OnboardingStep[]`) makes a 4th step, of any kind, a
 * type error — not just a recipe step specifically. If a legitimate 4th
 * onboarding step is ever needed, this type must change deliberately with
 * RL-2 sign-off, not silently grow via a general array.
 */
export interface OnboardingStripProps {
  steps: readonly [
    OnboardingStep & { id: "store" },
    OnboardingStep & { id: "menu" },
    OnboardingStep & { id: "payments" },
  ];
}

export function OnboardingStrip({ steps }: OnboardingStripProps) {
  if (steps.every((s) => s.done)) return null;

  return (
    <div className="oc-strip" data-testid="onboarding-strip">
      {steps.map((step) => (
        <div className={`oc-step${step.done ? " is-done" : ""}`} key={step.id}>
          <span className="oc-stepdot">{step.done ? "✓" : STEP_INDEX[step.id]}</span>
          {STEP_LABEL_TH[step.id]}
        </div>
      ))}
    </div>
  );
}

const STEP_INDEX: Record<OnboardingStepId, number> = { store: 1, menu: 2, payments: 3 };
