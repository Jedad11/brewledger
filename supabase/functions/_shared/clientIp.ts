// Best-effort caller IP extraction for a rate-limit bucket key. Ported from
// console-auth-request-otp/index.ts's own extractClientIp/looksLikeIp — see
// that file's header comment for the full investigation (Kong appends
// exactly one hop, which is its own internal Docker-network address, not
// the real caller; the first x-forwarded-for entry is the only position
// that varies per caller for realistic traffic). Duplicated rather than
// imported across the auth/public boundary: this file lives at the shared
// root, not under _shared/auth/, precisely so a second public-* rate limiter
// (WBS 5.10) doesn't need to reach into a directory scoped "auth-* functions
// only" for a concern that isn't auth-specific.
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/;

function looksLikeIp(value: string): boolean {
  if (IPV4_RE.test(value)) return value.split(".").every((octet) => Number(octet) <= 255);
  return IPV6_RE.test(value);
}

export function extractClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first && looksLikeIp(first)) return first;
  }
  const xRealIp = headers.get("x-real-ip")?.trim();
  if (xRealIp && looksLikeIp(xRealIp)) return xRealIp;
  return "unknown";
}
