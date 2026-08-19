import * as React from "react";

export interface UntrackedDisclosureProps {
  trackedCount: number;
  totalCount: number;
  /**
   * Satang. `undefined` = the whole figure doesn't apply for this variant;
   * `null` = present but the underlying revenue figure is itself unknown;
   * a genuine 0 renders as ฿0.00, not as unknown. Distinct from MoneyValue's
   * plain `number | null` because "absent" and "unknown" are semantically
   * different here (dashboard never supplies it; dish variant may).
   */
  untrackedRevenue?: number | null;
  variant: "dashboard" | "pnl" | "dish";
}

function formatBahtPlain(satang: number): string {
  return (satang / 100).toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

// Flat grey text on all three variants — deliberately not MoneyValue with a
// role, RL-3's instruction that an unknown-cost surface must never look
// alarming (no amber, no icon, no badge).
export function UntrackedDisclosure({
  trackedCount,
  totalCount,
  untrackedRevenue,
  variant,
}: UntrackedDisclosureProps) {
  const untrackedCount = totalCount - trackedCount;

  if (variant === "dashboard") {
    if (trackedCount <= 0 || untrackedCount <= 0) return null;
    return (
      <p className="note-plain bl-untracked-disclosure" data-testid="untracked-disclosure-dashboard">
        คำนวณจาก {trackedCount} จาก {totalCount} รายการที่มีข้อมูลต้นทุน
      </p>
    );
  }

  if (variant === "pnl") {
    if (untrackedCount <= 0) return null;
    if (trackedCount <= 0) {
      return (
        <p className="note-plain bl-untracked-disclosure" data-testid="untracked-disclosure-pnl-all">
          ยอดขายและค่าใช้จ่ายแสดงตามจริง ส่วนกำไรสุทธิจึงยังคำนวณไม่ได้
        </p>
      );
    }
    return (
      <p className="note-plain bl-untracked-disclosure" data-testid="untracked-disclosure-pnl-partial">
        หมายเหตุ: {untrackedCount} จาก {totalCount} รายการยังไม่มีข้อมูลต้นทุน
        {typeof untrackedRevenue === "number"
          ? ` (คิดเป็นยอดขาย ${formatBahtPlain(untrackedRevenue)} บาท)`
          : ""}{" "}
        กำไรที่แสดงจึงคำนวณจากรายการที่มีข้อมูลเท่านั้น
      </p>
    );
  }

  // dish
  if (untrackedCount <= 0) return null;
  return (
    <p className="note-plain bl-untracked-disclosure" data-testid="untracked-disclosure-dish">
      ยังไม่มีข้อมูลต้นทุน ({untrackedCount} รายการ)
    </p>
  );
}
