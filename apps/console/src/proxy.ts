// WBS 4.1 — deny-by-default route guard for the Owner Console.
//
// Named proxy.ts, not middleware.ts: this Next.js install (16.3.0) has
// deprecated the middleware.js file convention in favour of proxy.js — same
// behaviour, renamed file and export (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md
// and apps/console/AGENTS.md's instruction to heed deprecation notices). The
// WBS 4.1 dictionary entry still says "apps/console/middleware.ts" because it
// predates this Next.js version; that filename would still load today under
// a deprecation warning, but there is no reason to ship on a path Next.js
// itself says is going away.
//
// Exactly one route is carved out as public: /console/login. Everything else
// under /console requires a valid session. This is deliberately NOT an
// allow-list of protected routes — a new page added under /console later is
// protected automatically, with no proxy change required, because the
// default here is deny.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/safeNext";

const PUBLIC_CONSOLE_ROUTES = ["/console/login"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Matches lib/supabase/server.ts — @supabase/ssr defaults cookies to
      // httpOnly: false, and WBS 4.1 requires an httpOnly session cookie.
      // This is the refresh path (getUser() below rotates the token on an
      // expiring session), so it must set the same flag or a refreshed
      // cookie would silently downgrade to non-httpOnly.
      cookieOptions: { httpOnly: true },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() (not getSession()) — it round-trips to GoTrue to validate the
  // token instead of only decoding the local cookie, so a revoked or
  // tampered session is caught here rather than trusted through.
  //
  // A cleanly expired-but-well-formed JWT resolves normally here (user:
  // null, no throw). But a cookie that isn't decodable at all as
  // @supabase/ssr's session format (corruption, a hand edit, a future
  // cookie-format change) throws instead of resolving — caught here so
  // every failure mode collapses to the same deny-by-default outcome
  // (redirect to /console/login) rather than an unhandled 500.
  //
  // ONE retry on a THROWN failure only -- reproduced live: Supabase's own
  // Auth Logs showed every /user request in a login<->console flip-flop
  // window returning 200 (GoTrue itself never rejected the token), so the
  // proxy's own network call to GoTrue must have been failing transiently
  // BEFORE reaching GoTrue (timeout/connection reset from Vercel's edge
  // runtime), landing here as a caught exception, not as a genuine
  // resolved-null session. A clean resolved null (real logout/expiry, no
  // throw) is never retried -- retrying that would just mask the deny
  // decision, not fix a flake.
  let user = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const {
        data: { user: resolvedUser },
      } = await supabase.auth.getUser();
      user = resolvedUser;
      break;
    } catch {
      if (attempt === 1) user = null;
    }
  }

  const isPublicRoute = PUBLIC_CONSOLE_ROUTES.includes(request.nextUrl.pathname);

  // Both redirect branches below build a NEW NextResponse rather than
  // returning `response` directly -- but `response` may already carry a
  // Set-Cookie for a session getUser() just refreshed (setAll() above writes
  // into `response`, not into the request). Forwarding those cookies onto
  // the redirect is required, not cosmetic: skipping it leaves the browser
  // holding the OLD refresh token while GoTrue has already rotated to a new
  // one server-side, so the very next request's refresh attempt fails,
  // user resolves to null, and this proxy bounces to /console/login --
  // whose own next-request re-evaluation can then see a still-valid access
  // token on that request and bounce straight back, alternating forever.
  // This was reproduced live: Network tab showed console(307)<->login(307)
  // repeating every ~100-150ms until Chrome's own navigation throttling
  // kicked in.
  function redirectPreservingRefreshedCookies(url: URL): NextResponse {
    const redirectResponse = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }
    return redirectResponse;
  }

  if (!user && !isPublicRoute) {
    const loginUrl = new URL("/console/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return redirectPreservingRefreshedCookies(loginUrl);
  }

  if (user && request.nextUrl.pathname === "/console/login") {
    // WBS 4.1 fix (redline_reviewer, 2026-08-19) — `next` was previously
    // passed unvalidated into `new URL(next, request.url)`. An absolute
    // "https://evil.example" or protocol-relative "//evil.example" resolves
    // to the attacker's own host regardless of `request.url`'s base,
    // bouncing an already-authenticated merchant off-site with no login
    // page ever shown. safeNext() rejects anything that doesn't stay under
    // /console before it ever reaches `new URL(...)`.
    return redirectPreservingRefreshedCookies(
      new URL(safeNext(request.nextUrl.searchParams.get("next")), request.url),
    );
  }

  return response;
}

export const config = {
  matcher: ["/console/:path*"],
};
