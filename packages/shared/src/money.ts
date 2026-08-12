// Satang <-> THB helpers. All money in Brew Ledger is stored as an integer
// number of satang (1 THB = 100 satang) — never a float, on either surface.

export function satangToThb(satang: number): number {
  return satang / 100;
}

export function thbToSatang(thb: number): number {
  return Math.round(thb * 100);
}

// THB with a thousands separator and two decimals — the display rule from
// the style guide (WBS 2.5).
export function formatSatangAsThb(satang: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(satangToThb(satang));
}
