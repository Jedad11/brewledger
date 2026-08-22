// WBS 7.7 redline-fix regression -- recharts can hand the tooltip a payload
// entry whose object exists but whose `value` is undefined (the RL-2
// untracked-month case, mapped from null in fetchMonthlyTrend). The bug:
// checking truthiness of the entry object instead of its value produced
// "฿NaN" instead of "--" for exactly the case this screen exists to
// disclose honestly. See tooltipMoneyText in RevenueProfitChart.tsx.
import { describe, expect, it } from "vitest";
import { tooltipMoneyText } from "./RevenueProfitChart";

describe("tooltipMoneyText", () => {
  it("REGRESSION: an entry object present but with value undefined (RL-2 unknown-cost month) renders em dash, never NaN", () => {
    expect(tooltipMoneyText({ value: undefined })).toBe("—");
  });

  it("a missing payload entry entirely also renders em dash", () => {
    expect(tooltipMoneyText(undefined)).toBe("—");
  });

  it("a known value formats as baht, including exact zero (0 satang is a real known value, not unknown)", () => {
    expect(tooltipMoneyText({ value: 0 })).toBe("฿0");
  });

  it("a known positive value formats as baht", () => {
    expect(tooltipMoneyText({ value: 123456 })).toBe("฿1,235");
  });
});
