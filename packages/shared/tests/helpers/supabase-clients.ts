// WBS 3.8 QA test helper — real Supabase clients (anon, service_role, and a
// per-fixture "authenticated" client carrying a locally-minted JWT) against
// the LOCAL Docker stack only. Copy of
// packages/db/tests/helpers/supabase-clients.ts's approach (see that file's
// header for the full "why a minted JWT, not a real OTP sign-in" reasoning
// — local phone-OTP has no SMS provider configured, so minting is the only
// way to produce a second/third `authenticated` session locally).
//
// These are NOT secrets — the well-known `supabase start` demo keys, same
// values documented at
// https://supabase.com/docs/guides/local-development/cli/config. Never
// point these at brewledger-dev/brewledger-prod.
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

export const LOCAL_JWT_SECRET =
  process.env.TEST_SUPABASE_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

export function mintAuthenticatedJwt(authUserId: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "authenticated",
    role: "authenticated",
    sub: authUserId,
    iss: "supabase-demo",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
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

export function authenticatedClient(authUserId: string): SupabaseClient {
  const jwt = mintAuthenticatedJwt(authUserId);
  return createClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

export async function isApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_API_URL}/rest/v1/`, {
      headers: { apikey: LOCAL_ANON_KEY },
    });
    return res.status < 500 || res.status === 404;
  } catch {
    return false;
  }
}
