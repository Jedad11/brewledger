// WBS 4.1 — browser-side Supabase client for any future authenticated
// console client component. Uses @supabase/ssr specifically so a session
// lives in cookies the middleware (proxy.ts) can also read, not
// localStorage — a plain @supabase/supabase-js client (like
// packages/shared's createBrowserClient, built for the unauthenticated
// apps/shop surface) would be invisible to proxy.ts's server-side session
// check.
//
// NOT used to call signInWithOtp/verifyOtp: @supabase/ssr's browser client
// writes cookies via document.cookie, which cannot set HttpOnly (only a
// server Set-Cookie header can) — see lib/supabase/server.ts and
// login/actions.ts for why session establishment stays server-side.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
