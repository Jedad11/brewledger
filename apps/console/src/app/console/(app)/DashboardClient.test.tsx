// WBS 7.1 Claude Code Prompt step 2, verbatim requirement: "Write a test
// that loads the dashboard for a store with zero bom_lines and asserts:
// revenue renders, order count renders, no error is thrown, and profit is
// '—' not '0'." This is the render half of that assertion (the data half
// is fetchDashboardSummary.test.ts) — DashboardView is the pure
// presentational component both DashboardClient (live) and page.tsx's own
// no-store fallback render, so testing it directly needs no Supabase mock
// at all, same renderToStaticMarkup convention packages/ui's own
// OrderCard.test.tsx/Toggle.test.tsx established (no interaction under
// test, only render output).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardView } from "./DashboardClient";
import type { DashboardSummary } from "./fetchDashboardSummary";
import { NO_COST_DATA_NOTE } from "./copy";

const ZERO_BOM_SUMMARY: DashboardSummary = {
  revenueSatang: 32400,
  profitSatang: null,
  expensesSatang: 8600,
  trackedItemCount: 0,
  totalItemCount: 12,
  orderCounts: { waiting: 2, preparing: 1, ready: 1 },
  upcomingSlots: [],
};

describe("DashboardView", () => {
  it("REQUIRED (RL-2): a store with zero bom_lines renders revenue and order count normally, throws nothing, and shows profit as — not 0", () => {
    let html = "";
    expect(() => {
      html = renderToStaticMarkup(<DashboardView summary={ZERO_BOM_SUMMARY} />);
    }).not.toThrow();

    // Revenue rendered: ฿324 (MetricCard renders integer baht, no decimals)
    expect(html).toContain("324");
    // Order counts rendered.
    expect(html).toContain(">2<");
    expect(html).toContain(">1<");
    // Profit is the unknown glyph, never the literal digit 0.
    expect(html).toContain("—");
    expect(html).not.toMatch(/money--profit[^>]*>[^<]*0/);
    // The neutral RL-2 disclosure note, verbatim, plain text (no icon/badge
    // markup in this component at all).
    expect(html).toContain(NO_COST_DATA_NOTE);
  });

  it("a store with SOME tracked lines shows the computed profit and the item-count disclosure, not the zero-cost note", () => {
    const partial: DashboardSummary = { ...ZERO_BOM_SUMMARY, profitSatang: 11800, trackedItemCount: 8 };
    const html = renderToStaticMarkup(<DashboardView summary={partial} />);

    // ฿118 (MetricCard renders integer baht, no decimals)
    expect(html).toContain("118");
    expect(html).not.toContain(NO_COST_DATA_NOTE);
    expect(html).toContain("คำนวณจาก 8 จาก 12 รายการที่มีข้อมูลต้นทุน");
  });

  it("a store with fully-tracked lines shows no untracked disclosure at all", () => {
    const fullyTracked: DashboardSummary = {
      ...ZERO_BOM_SUMMARY,
      profitSatang: 20000,
      trackedItemCount: 12,
      totalItemCount: 12,
    };
    const html = renderToStaticMarkup(<DashboardView summary={fullyTracked} />);

    expect(html).not.toContain(NO_COST_DATA_NOTE);
    expect(html).not.toContain("untracked-disclosure-dashboard");
  });
});
