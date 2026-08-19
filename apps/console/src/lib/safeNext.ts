// WBS 4.1 — shared by proxy.ts (post-login redirect) and
// app/console/login/actions.ts (post-verify redirect). One implementation so
// the open-redirect guard on `?next=` can't drift out of sync between the
// two call sites again (redline_reviewer finding, 2026-08-19).
//
// Only ever redirect back into /console — never off-site, and never a
// protocol-relative "//evil.example" or "/\evil.example" that a manipulated
// ?next= could carry. `new URL(next, request.url)` resolves an absolute
// "https://evil.example" or a protocol-relative "//evil.example" to the
// attacker's own host regardless of the base, so `next` must be validated
// BEFORE it ever reaches `new URL(...)`, not after.
export function safeNext(next: string | null | undefined): string {
  if (
    next &&
    next.startsWith("/console") &&
    !next.startsWith("//") &&
    !next.startsWith("/\\")
  ) {
    return next;
  }
  return "/console";
}
