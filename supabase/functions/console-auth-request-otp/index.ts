// WBS 4.1 — the ONLY sanctioned way apps/console requests an OTP. Fronts
// supabase.auth.signInWithOtp with the two rate-limit checks Supabase's own
// project-wide hourly SMS cap (config.toml [auth.rate_limit].sms_sent) does
// not give: a per-phone-number bucket and a per-IP bucket. Both are enforced
// here, in this one function, because this is the only point in the request
// path that sees the caller's phone number, the caller's real IP, AND runs
// before Supabase Auth's own (Vonage-backed) phone provider ever sends
// anything — see docs/ops/auth.md for the live provider config.
//
// Actual SMS delivery is Supabase Auth's native phone provider (Vonage,
// dashboard-configured) — this function does not send SMS itself, it only
// gates and forwards to signInWithOtp.
import { createClient } from "npm:@supabase/supabase-js@2";
import { createAuthServiceClient } from "../_shared/auth/db.ts";
import { checkAndRecordRateLimit } from "../_shared/auth/rateLimit.ts";

const GENERIC_ERROR = "ส่งรหัสไม่สำเร็จ ลองใหม่อีกครั้ง";
// +66 followed by exactly 9 digits — matches the E.164 shape the login
// page's client-side normalisation step produces. Reject anything else
// before it ever reaches GoTrue or counts against a rate limit.
const E164_TH_PHONE = /^\+66\d{9}$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// IP resolution for the per-IP rate-limit bucket below (redline_reviewer
// finding, 2026-08-19: `.split(",")[0]` trusted whichever value arrived
// leftmost in x-forwarded-for, which is the CALLER'S OWN value whenever they
// send one — this function is public, gated only by the anon key that ships
// in the browser bundle, so anyone can POST directly and set that header to
// anything).
//
// Taking the LAST entry instead (the standard "reverse proxies append,
// don't replace" reading — RFC 7239, and the convention nginx/HAProxy/
// ALB/Cloudflare all follow) was tried first and then DISPROVEN by an actual
// test against this stack, not by inspection: two requests sent with
// `x-forwarded-for: 1.1.1.1` and `x-forwarded-for: 2.2.2.2` both arrived at
// this function as "<value>, 192.168.65.1" — Kong (Supabase's own API
// gateway, in front of every Edge Function call including on the hosted
// platform, not just local dev) appends ONE more hop, but that hop is
// Kong's own view of its upstream peer inside the Docker/container network,
// a FIXED address, not the internet-facing client. Taking the last entry
// therefore collapsed every distinct caller into one shared ip_hash bucket —
// confirmed via `select ip_hash, count(*) from auth_attempts group by
// ip_hash`, which showed 20 rows under one hash after only two different
// spoofed inputs. That is worse than the original bug: instead of being
// spoofable, the bucket became a no-op that rate-limits every merchant
// together after 20 total requests/hour platform-wide.
//
// Deno.serve's own connInfo/remoteAddr was ruled out too, for the same
// underlying reason — independent reports against Supabase's platform (e.g.
// github.com/orgs/supabase/discussions/7884) show it resolves to Kong's/
// Supabase's own internal address, not the caller's, because the gateway
// terminates the TCP connection in front of the function.
//
// Net finding: there is no position in this header, and no alternate
// platform API, that reliably carries the real origin client IP into a
// Supabase Edge Function today (checked: supabase.com/docs/guides/functions/
// architecture and .../functions/auth-headers document a gateway in front of
// every function but not this). This is a genuine platform limitation, not
// something fixable by header-parsing cleverness alone. Reverted to the
// FIRST entry — the only position that actually varies per caller for
// realistic (non-adversarial) traffic, since it is whatever the ORIGINAL
// caller sent before Kong ever touches the header — with two changes from
// the original code: (1) the extracted value must look like a real IPv4/
// IPv6 address, so a caller can't defeat bucketing-by-shape with arbitrary
// junk or an injected extra comma; (2) this is now documented, not implied,
// as a best-effort/coarse signal that a caller with direct API access (i.e.
// anyone with the public anon key) can still spoof by rotating fake IP
// strings — the real backstop against that is the phone_hash bucket (5/
// hour), which this signal is a secondary, not primary, defense alongside.
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+:[0-9a-fA-F:]*$/;

function looksLikeIp(value: string): boolean {
  if (IPV4_RE.test(value)) return value.split(".").every((octet) => Number(octet) <= 255);
  return IPV6_RE.test(value);
}

function extractClientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first && looksLikeIp(first)) return first;
  }
  const xRealIp = headers.get("x-real-ip")?.trim();
  if (xRealIp && looksLikeIp(xRealIp)) return xRealIp;
  return "unknown";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  let body: { phone?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }

  if (typeof body.phone !== "string" || !E164_TH_PHONE.test(body.phone)) {
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }
  const phone = body.phone;

  const ip = extractClientIp(req.headers);

  const serviceClient = createAuthServiceClient();
  try {
    // Phone bucket first: an over-limit IP shouldn't also need to burn a
    // phone-bucket check that will just be discarded, but the real reason
    // for the order is that a single phone number probed from many
    // different IPs is the more realistic abuse shape for a login endpoint,
    // so it's checked first.
    const phoneCheck = await checkAndRecordRateLimit(serviceClient, "phone_hash", phone, 5);
    if (!phoneCheck.allowed) {
      return jsonResponse({ error: GENERIC_ERROR }, 429);
    }
    const ipCheck = await checkAndRecordRateLimit(serviceClient, "ip_hash", ip, 20);
    if (!ipCheck.allowed) {
      return jsonResponse({ error: GENERIC_ERROR }, 429);
    }
  } catch {
    return jsonResponse({ error: GENERIC_ERROR }, 500);
  }

  const anonClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { error } = await anonClient.auth.signInWithOtp({ phone });
  if (error) {
    // Same generic message regardless of cause -- do not let GoTrue's own
    // error text (which can differ for malformed vs. rejected numbers)
    // leak through and become a registered-number oracle.
    return jsonResponse({ error: GENERIC_ERROR }, 400);
  }

  return jsonResponse({ ok: true });
});
