// WBS 4.1 — server-side Supabase client (Server Components, Server Actions).
// Reads/writes the same httpOnly session cookie set produced in proxy.ts.
//
// cookieOptions.httpOnly: true is explicit because @supabase/ssr's own
// DEFAULT_COOKIE_OPTIONS ships httpOnly: false (it's a dual-purpose default
// meant to also work for browser-client flows) — the WBS 4.1 acceptance
// criterion is an httpOnly session cookie, so this app never relies on that
// default. verifyOtp in actions.ts is the one place the session cookie is
// actually created; it always goes through this client, never the browser
// one in lib/supabase/client.ts, so the Set-Cookie header (and therefore
// HttpOnly) genuinely comes from the server.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { httpOnly: true },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          // A Server Component can't set cookies — this throws when called
          // from one. It's a no-op here on purpose: middleware.ts is what
          // actually persists refreshed session cookies on every request;
          // this catch just keeps a Server Component call site from crashing.
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — session refresh already
            // happens in middleware.ts, so nothing is lost here.
          }
        },
      },
    },
  );
}
