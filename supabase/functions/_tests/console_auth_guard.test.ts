// WBS 3.7 §7 test contract — "Auth guard 401 test" for
// supabase/functions/_shared/console/auth.ts's withConsoleAuth /
// verifyConsoleRequest.
//
// No real console-* function exists yet (see this repo's own
// supabase/functions/qa-console-auth-probe/index.ts header comment) — the
// design doc anticipates exactly this and sanctions a synthetic handler in
// the interim. That probe function wraps withConsoleAuth with zero business
// logic and echoes only `ctx.merchantId` on success, so this file exercises
// the REAL guard, over REAL HTTP, through the REAL Edge Runtime — not a
// mock of verifyConsoleRequest's internals.
//
// Requires `supabase functions serve --no-verify-jwt --import-map
// supabase/functions/deno.json` (the plain `pnpm functions:serve` script
// omits --no-verify-jwt, which would make the platform's own JWT gate
// reject no-header/malformed-JWT requests before our own guard ever runs —
// exactly the case this suite needs to reach). SKIPS (not passes) if the
// probe function isn't reachable.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  functionUrl,
  isFunctionReachable,
  LOCAL_ANON_KEY,
  mintAuthenticatedJwt,
  serviceClient,
} from "./helpers/clients";
import { createWellFormedAuthUserFixture, type AuthUserFixture } from "./helpers/auth-user-fixture";

const PROBE_URL = functionUrl("qa-console-auth-probe");

let ready = false;
let demoAuthUserId: string | undefined;
let wellFormedFixture: AuthUserFixture | undefined;

beforeAll(async () => {
  const reachable = await isFunctionReachable("qa-console-auth-probe");
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[console_auth_guard.test.ts] SKIPPING — the local Edge Functions " +
        "server isn't serving qa-console-auth-probe. Run `supabase " +
        "start`, `supabase db reset`, then `supabase functions serve " +
        "--no-verify-jwt --import-map supabase/functions/deno.json`. This " +
        "is a SKIP, not a pass.\n",
    );
    return;
  }
  ready = true;

  const service = serviceClient();
  const { data: merchant, error } = await service.from("merchants").select("auth_user_id").limit(1).single();
  if (error || !merchant) {
    throw new Error(
      `[console_auth_guard.test.ts] no seeded merchant found — has \`supabase db reset\` run? ${error?.message ?? ""}`,
    );
  }
  demoAuthUserId = merchant.auth_user_id as string;

  // Positive-path fixture — see helpers/auth-user-fixture.ts's header for
  // why the seeded demo merchant can't be reused here (a genuine
  // packages/db/seed.sql gap: GoTrue's /auth/v1/user 500s on that row).
  wellFormedFixture = await createWellFormedAuthUserFixture();
});

afterAll(async () => {
  if (wellFormedFixture) await wellFormedFixture.cleanup();
});

async function callProbe(headers: Record<string, string>): Promise<{ status: number; bodyText: string }> {
  const res = await fetch(PROBE_URL, { headers: { apikey: LOCAL_ANON_KEY, ...headers } });
  const bodyText = await res.text();
  return { status: res.status, bodyText };
}

describe("withConsoleAuth — no Authorization header", () => {
  it("returns 401 with a completely empty body", async () => {
    if (!ready) return;
    const { status, bodyText } = await callProbe({});
    expect(status).toBe(401);
    expect(bodyText).toBe("");
  });
});

describe("withConsoleAuth — malformed JWT", () => {
  it("returns 401 with a completely empty body for a garbage bearer token", async () => {
    if (!ready) return;
    const { status, bodyText } = await callProbe({ Authorization: "Bearer not-a-real-jwt" });
    expect(status).toBe(401);
    expect(bodyText).toBe("");
  });

  it("returns 401 with a completely empty body for a well-formed-but-wrongly-signed JWT", async () => {
    if (!ready) return;
    // Same shape as a real GoTrue JWT, signed with the WRONG secret — proves
    // the guard verifies the signature, not just decodes the payload.
    const forged = mintForgedJwt();
    const { status, bodyText } = await callProbe({ Authorization: `Bearer ${forged}` });
    expect(status).toBe(401);
    expect(bodyText).toBe("");
  });
});

describe("withConsoleAuth — expired JWT", () => {
  it("returns 401 with a completely empty body for a JWT past its exp claim", async () => {
    if (!ready || !demoAuthUserId) return;
    const expired = mintAuthenticatedJwt(demoAuthUserId, { expired: true });
    const { status, bodyText } = await callProbe({ Authorization: `Bearer ${expired}` });
    expect(status).toBe(401);
    expect(bodyText).toBe("");
  });
});

describe("withConsoleAuth — no stack trace or error detail leaks in any 401", () => {
  it("the response body never contains a stack trace, file path, or exception message substring", async () => {
    if (!ready) return;
    const cases: Array<Record<string, string>> = [
      {},
      { Authorization: "Bearer not-a-real-jwt" },
      { Authorization: `Bearer ${mintForgedJwt()}` },
    ];
    for (const headers of cases) {
      const { bodyText } = await callProbe(headers);
      expect(bodyText).toBe(""); // stronger than a substring scan: nothing at all leaks
      expect(bodyText).not.toMatch(/at .*\.ts:\d+|Error:|stack|Deno\./i);
    }
  });
});

describe("withConsoleAuth — valid session reaches the handler", () => {
  it("returns 200 with only ctx.merchantId for a genuinely valid JWT (sanity: the guard isn't just failing closed always)", async () => {
    if (!ready || !wellFormedFixture) return;
    const jwt = mintAuthenticatedJwt(wellFormedFixture.authUserId);
    const res = await fetch(PROBE_URL, {
      headers: { apikey: LOCAL_ANON_KEY, Authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; merchantId: string };
    expect(Object.keys(body).sort()).toEqual(["merchantId", "ok"]);
    expect(body.merchantId).toBe(wellFormedFixture.merchantId);
  });
});

describe("sanity — the demo merchant fixture genuinely exists via service_role", () => {
  it("proves the 401 tests above aren't vacuously passing against an empty merchants table", async () => {
    if (!ready) return;
    const service = serviceClient();
    const { data, error } = await service.from("merchants").select("id");
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

function mintForgedJwt(): string {
  // Deliberately signed with a secret the local GoTrue instance does NOT
  // trust, to prove verifyConsoleRequest actually validates the signature
  // rather than trusting any well-formed JWT.
  return mintAuthenticatedJwt("00000000-0000-0000-0000-000000000000", {
    secret: "a-completely-different-secret-not-trusted-by-gotrue",
  });
}
