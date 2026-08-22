// WBS 5.8 — "new since last look" is a cursor comparison, not a per-order
// flag: an order is unseen iff it arrived (COALESCE(payment_confirmed_at,
// created_at), see fetchWorkingQueue.ts) after stores.orders_last_seen_at.
// A null cursor (a store that has never tapped "รับทราบ") means everything
// currently in the queue counts as unseen — the natural state for a
// merchant's very first orders.
export function isUnseen(arrivedAt: string, lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return true;
  // NOT a bare string comparison: lib/merchant.ts's lexicographic trick for
  // created_at ordering only holds when both strings share ONE ISO-8601
  // serialization. Here they don't — arrivedAt comes from PostgREST
  // (typically microsecond precision, "+00:00" offset) while lastSeenAt is
  // set optimistically in InboxClient's handleAck() via `new Date()
  // .toISOString()` (millisecond precision, "Z" suffix). 'Z' (0x5A) sorts
  // after digits and '+' (0x2B), so a millisecond-precision "...Z" cursor
  // can lexicographically outrank a same-instant-or-later "...+00:00"
  // arrival, silently misclassifying it as already-seen. Comparing epoch
  // millis parses both formats correctly regardless of precision/suffix.
  return new Date(arrivedAt).getTime() > new Date(lastSeenAt).getTime();
}
