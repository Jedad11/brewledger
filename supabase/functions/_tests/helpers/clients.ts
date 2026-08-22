// WBS 3.7 qa_engineer leg — real Supabase clients + the local Edge Functions
// gateway URL, targeting the LOCAL Docker stack only. Deliberately a
// near-duplicate of packages/db/tests/helpers/supabase-clients.ts rather
// than an import from it: this package tests a different layer (the
// Functions HTTP surface, not PostgREST directly) and is kept dependency-free
// of @brewledger/db so it can run standalone. The key values below are the
// well-known local Supabase CLI demo keys (same ones `supabase start` prints
// for every local project) — never point these at brewledger-dev/-prod.
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

// The local GoTrue signing secret ("supabase start"'s own printed
// JWT_SECRET). Same rationale as packages/db/tests/helpers/supabase-clients.ts:
// this stack has no local SMS provider, so a real signInWithOtp session
// can't be obtained; minting a JWT with this well-known local secret is the
// only way to produce a `sub`/`role` claim pair withConsoleAuth's
// supabase.auth.getUser() will actually accept.
const LOCAL_JWT_SECRET =
  process.env.TEST_SUPABASE_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/** Mints a real HS256 JWT. Signs with the local GoTrue secret unless `secret` is overridden (used to mint a deliberately-forged/wrongly-signed token). */
export function mintAuthenticatedJwt(
  authUserId: string,
  opts?: { expired?: boolean; secret?: string },
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "authenticated",
    role: "authenticated",
    sub: authUserId,
    iss: "supabase-demo",
    iat: nowSeconds - (opts?.expired ? 7200 : 0),
    exp: nowSeconds + (opts?.expired ? -3600 : 3600),
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", opts?.secret ?? LOCAL_JWT_SECRET)
    .update(signingInput)
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

export function functionUrl(name: string): string {
  return `${LOCAL_API_URL}/functions/v1/${name}`;
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

/**
 * Checks whether `supabase functions serve` is actually up and serving the
 * named function, distinct from the API gateway being reachable at all —
 * `supabase start` alone does NOT serve Edge Functions locally; that needs
 * a separate `supabase functions serve` process (see this repo's
 * `pnpm functions:serve`, run here with `--no-verify-jwt` so requests with
 * no/invalid Authorization header reach our own withConsoleAuth guard
 * instead of being rejected by the platform's own JWT gate first).
 *
 * Deliberately does NOT treat an HTTP 5xx response as "unreachable" — a
 * function that boots but then fails (e.g. a Deno BOOT_ERROR from a bad
 * import) still answers the OPTIONS request with a real response, just a
 * 5xx one. Callers that skip their assertions on `false` here rely on that:
 * "unreachable" must mean "the process never answered" (connection
 * refused/timed out — the local stack genuinely isn't running, a legitimate
 * skip), never "answered, but broken" (a real regression that should fail
 * the test, not silently skip it — see public_snapshots.test.ts's own
 * per-function gating for exactly the incident this distinction exists to
 * catch).
 */
export async function isFunctionReachable(name: string): Promise<boolean> {
  try {
    await fetch(functionUrl(name), {
      method: "OPTIONS",
      headers: { apikey: LOCAL_ANON_KEY },
    });
    return true;
  } catch {
    return false;
  }
}

// A UUID looks like 8-4-4-4-12 hex. Timestamps we care about are ISO 8601
// with a timezone offset (`...Z` or `+HH:MM`). Both vary run to run (random
// gen_random_uuid() ids, "now"-relative fixture timestamps), so committed
// snapshot fixtures store a stable placeholder in their place and every
// live response is normalized the same way before comparison. This keeps
// the snapshot a genuine field-shape/value check — an added, removed, or
// renamed field still fails the comparison — without pinning to values that
// can never be reproduced deterministically.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function normalizeForSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForSnapshot);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = normalizeForSnapshot(v);
    }
    return out;
  }
  if (typeof value === "string") {
    if (UUID_RE.test(value)) return "<uuid>";
    if (TIMESTAMPTZ_RE.test(value)) return "<timestamptz>";
  }
  return value;
}
