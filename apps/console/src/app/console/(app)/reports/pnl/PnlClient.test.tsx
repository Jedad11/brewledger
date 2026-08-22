// WBS 7.5 qa_engineer leg — render half of the RL-2 disclosure requirement.
// fetchPnlDay.test.ts covers the data layer; this file covers what the
// screen actually renders, same renderToStaticMarkup convention as WBS
// 7.1's own DashboardClient.test.tsx (no interaction under test, only
// output — PnlView is the pure presentational half of PnlClient.tsx).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PnlView } from "./PnlClient";
import type { PnlDay } from "./fetchPnlDay";

const BASE: PnlDay = {
  businessDate: "2026-08-20",
  grossRevenueSatang: 32400,
  totalCogsSatang: null,
  otherExpenseSatang: 800,
  netProfitSatang: null,
  orderCount: 12,
  trackedItemCount: 0,
  totalItemCount: 12,
  untrackedRevenueSatang: 32400,
  source: "live",
};

describe("PnlView", () => {
  it("REQUIRED (RL-2): an all-untracked day renders net profit as — never 0, with the all-untracked disclosure block", () => {
    let html = "";
    expect(() => {
      html = renderToStaticMarkup(<PnlView day={BASE} />);
    }).not.toThrow();

    expect(html).toContain("324.00"); // revenue rendered normally
    expect(html).toContain("8.00"); // other-expense rendered normally
    // Net profit renders the unknown glyph, never a literal 0.
    expect(html).not.toMatch(/money--profit[^>]*>[^<]*0/);
    expect(html).toContain("—");
    expect(html).toContain('data-testid="untracked-disclosure-pnl-all"');
  });

  it("a partially-tracked day shows the tracked-only profit AND the disclosure block with count and revenue share", () => {
    const partial: PnlDay = {
      ...BASE,
      totalCogsSatang: 3000,
      netProfitSatang: 4200,
      trackedItemCount: 8,
      totalItemCount: 12,
      untrackedRevenueSatang: 54000, // ฿540, matches the WBS's own worked example
    };
    const html = renderToStaticMarkup(<PnlView day={partial} />);

    expect(html).toContain("42.00"); // net profit rendered, not "—"
    expect(html).toContain('data-testid="untracked-disclosure-pnl-partial"');
    expect(html).toContain("4 จาก 12 รายการยังไม่มีข้อมูลต้นทุน"); // 12 - 8 = 4 untracked
    expect(html).toContain("540 บาท");
    expect(html).not.toContain('data-testid="untracked-disclosure-pnl-all"');
  });

  it("a fully-tracked day renders no disclosure block at all", () => {
    const fullyTracked: PnlDay = {
      ...BASE,
      totalCogsSatang: 12000,
      netProfitSatang: 19600,
      trackedItemCount: 12,
      totalItemCount: 12,
      untrackedRevenueSatang: 0,
    };
    const html = renderToStaticMarkup(<PnlView day={fullyTracked} />);

    expect(html).toContain("196.00");
    expect(html).not.toContain("bl-untracked-disclosure");
    expect(html).not.toContain('data-testid="untracked-disclosure-pnl-partial"');
    expect(html).not.toContain('data-testid="untracked-disclosure-pnl-all"');
  });

  it("no gateway fee row is ever rendered (WBS 4.8 supersedes the prototype's fee line)", () => {
    const html = renderToStaticMarkup(<PnlView day={BASE} />);
    expect(html).not.toContain("ค่าธรรมเนียม");
  });
});
