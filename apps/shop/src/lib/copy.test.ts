// WBS 5.3 qa_engineer leg — the copy predicates the checkout screen's
// state_matrix.md entry depends on ("เหลือ N ที่ when ≤2 remain").
import { describe, expect, it } from "vitest";
import { checkoutSummaryLabel, remainingLabel } from "./copy";

describe("remainingLabel", () => {
  it("returns the soft-urgency label at exactly 2 remaining", () => {
    expect(remainingLabel(2)).toBe("เหลือ 2 ที่");
  });

  it("returns the soft-urgency label at 1 remaining", () => {
    expect(remainingLabel(1)).toBe("เหลือ 1 ที่");
  });

  it("returns null at 3 or more remaining — never exposes exact count as urgency above the threshold", () => {
    expect(remainingLabel(3)).toBeNull();
    expect(remainingLabel(10)).toBeNull();
  });

  it("returns the label even at 0 (the caller is responsible for omitting an already-full slot from the list at all)", () => {
    expect(remainingLabel(0)).toBe("เหลือ 0 ที่");
  });
});

describe("checkoutSummaryLabel", () => {
  it("no slot selected", () => {
    expect(checkoutSummaryLabel(null)).toBe("ยังไม่ได้เลือกเวลา");
  });

  it("a slot selected", () => {
    expect(checkoutSummaryLabel("08:15")).toBe("รับ 08:15 น.");
  });
});
