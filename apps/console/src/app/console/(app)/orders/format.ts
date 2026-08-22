// Extracted from PendingPaymentSection.tsx (WBS 5.6) so WBS 5.8's own inbox
// query/components share the exact same pickup-time formatting instead of a
// second copy drifting out of sync with it.
export function formatPickupTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
