// WBS 3.6 QA test helper — real Supabase clients (anon, service_role, and a
// per-fixture "authenticated" client carrying a locally-minted JWT) against
// the LOCAL Docker stack only.
//
// These are NOT secrets: the local Supabase CLI (`supabase start`) always
// prints and uses this exact ANON_KEY/SERVICE_ROLE_KEY/JWT_SECRET triple for
// every project unless someone has gone out of their way to override them in
// supabase/config.toml (this project hasn't — see `[auth] jwt_expiry` and
// the absence of a custom `jwt_secret`/signing-key path there). They are the
// same well-known demo values documented at
// https://supabase.com/docs/guides/local-development/cli/config and printed
// verbatim by `supabase start` in this repo. Never point these at
// `brewledger-dev`/`brewledger-prod` — there is no flag here that could do
// that, mirroring tests/helpers/db.ts's LOCAL_DB_URL guardrail.
//
// Override any of the three via env vars if your local stack's ports/keys
// genuinely differ (e.g. a non-default `supabase/config.toml`).
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

export const LOCAL_API_URL =
  process.env.TEST_SUPABASE_URL ?? "http://127.0.0.1:54321";

export const LOCAL_ANON_KEY =
  process.env.TEST_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

export const LOCAL_SERVICE_ROLE_KEY =
  process.env.TEST_SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// The local GoTrue signing secret ("supabase start"'s own JWT_SECRET
// output). Local phone-OTP sign-in is actually disabled in this stack (no
// SMS provider configured — `supabase start` prints "WARN: no SMS provider
// is enabled. Disabling phone login"), so a real signInWithOtp/
// signInWithPassword flow isn't available here at all. Minting a JWT with
// this secret is the only way to produce a `sub`/`role` claim pair that
// `auth.uid()` and PostgREST's role-switch will actually evaluate for a
// second, third, ... test merchant — not a workaround, the only viable path
// given phone-OTP-only auth is configured with no local SMS provider.
export const LOCAL_JWT_SECRET =
  process.env.TEST_SUPABASE_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/**
 * Mints a real HS256 JWT signed with the local GoTrue secret, carrying the
 * same `sub`/`role`/`aud` claim shape GoTrue itself would issue for a
 * confirmed `authenticated` session. This is what makes `auth.uid()`
 * (Postgres) and PostgREST's `SET ROLE authenticated` actually fire for the
 * given `authUserId` — RLS policies evaluate this JWT exactly as they would
 * a real session, because the signature is valid against the same secret
 * Postgres/GoTrue trusts locally.
 */
export function mintAuthenticatedJwt(authUserId: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "authenticated",
    role: "authenticated",
    sub: authUserId,
    iss: "supabase-demo",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60, // 1 hour — ample for a single test run
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", LOCAL_JWT_SECRET)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

export function anonClient(): SupabaseClient {
  return createClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function serviceClient(): SupabaseClient {
  return createClient(LOCAL_API_URL, LOCAL_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A client that presents as `authenticated` with the given merchant's uid. */
export function authenticatedClient(authUserId: string): SupabaseClient {
  const jwt = mintAuthenticatedJwt(authUserId);
  return createClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

/**
 * Checks whether the local PostgREST/GoTrue API is reachable (distinct from
 * `helpers/db.ts`'s `isReachable`, which only checks raw Postgres — the RLS
 * suite goes through the HTTP API, which is a separate container that can be
 * up or down independently of Postgres itself).
 */
export async function isApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_API_URL}/rest/v1/`, {
      headers: { apikey: LOCAL_ANON_KEY },
    });
    // Any HTTP response (even 4xx from PostgREST's root) proves the API
    // container is up; only a network-level failure should count as down.
    return res.status < 500 || res.status === 404;
  } catch {
    return false;
  }
}
