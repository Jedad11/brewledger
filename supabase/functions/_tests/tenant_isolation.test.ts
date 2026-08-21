// WBS 4.2 — Cross-tenant isolation: merchant A attempting every console
// endpoint with merchant B's store_id (BrewLedger_WBS_Dictionary.md lines
// 2751-2755 / the entry's Testing block).
//
// Real HTTP against the real Edge Runtime, exercising the ACTUAL
// assertOwnedStore call inside qa-console-auth-probe/index.ts through the
// ACTUAL withConsoleAuth factory in _shared/console/auth.ts -- not a mock of
// either. Two real merchants (A, B), each with one real store, are inserted
// directly via `pg` (same fixture style as helpers/auth-user-fixture.ts and
// packages/db/tests/helpers/rls-fixture.ts: a plain autocommit `pg` Client
// bypassing RLS for setup, exactly like service_role would).
//
// SKIPS (not passes) if the local Edge Functions server isn't reachable; see
// console_auth_guard.test.ts's header in this directory for the exact
// commands to bring the stack up (`supabase start`, `supabase db reset`,
// `supabase functions serve --no-verify-jwt --import-map
// supabase/functions/deno.json`).
//
// --- Endpoint manifest mechanism -------------------------------------------
// ENDPOINT_MANIFEST below is the single source of truth for "which
// console-*/qa-* Edge Functions this suite drives". The "endpoint manifest
// completeness" describe block lists the REAL directories on disk under
// supabase/functions/ and fails the suite if one matching console-*/qa-*
// exists without either a manifest entry or a named entry in
// KNOWN_NON_GUARDED_EXCEPTIONS -- this is the "loop over an endpoint manifest
// so a newly added endpoint that is not in the manifest fails the test"
// mechanism the WBS 4.2 Claude Code Prompt asks for. That completeness check
// runs unconditionally (pure filesystem, no stack required) so it still
// catches a coverage gap even in an environment where the live stack is
// unreachable.
//
// qa-console-auth-probe is the synthetic handler console_auth_guard.test.ts
// also drives for the 401 guard -- see that function's own header comment
// for why it's the sanctioned interim probe. console-confirm-payment and
// console-reject-payment (WBS 5.6, packages/db/migrations/
// 0031_payment_confirmation.sql) are the first real business console-*
// functions in the manifest; unlike the probe, they don't accept a
// client-supplied store_id at all -- each looks up its own store_id from
// the orderId in the request body (see 0031's own header) -- so their
// `request()` builders below resolve the generic `storeId` test parameter
// to a pre-seeded throwaway order belonging to that store, and their
// success-path assertion is supplied via `assertSuccessBody` rather than
// the probe's `{ok, merchantId}` shape, which these two don't share. As
// more real console-* functions land in later WBS entries, each one's
// directory name must be added to ENDPOINT_MANIFEST or this suite's own
// completeness check fails.
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  functionUrl,
  isFunctionReachable,
  LOCAL_ANON_KEY,
  mintAuthenticatedJwt,
  serviceClient,
} from "./helpers/clients";
import { createWellFormedAuthUserFixture, type AuthUserFixture } from "./helpers/auth-user-fixture";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FUNCTIONS_DIR = join(REPO_ROOT, "supabase/functions");

const LOCAL_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Directories that are pre-auth by design and therefore cannot be driven
// through this suite's "call as merchant A" shape at all. An entry here is a
// claim that needs to stay true -- it is not a place to silence a real gap.
const KNOWN_NON_GUARDED_EXCEPTIONS = new Set<string>([
  "console-auth-request-otp", // issues the OTP itself; cannot require a session to call it (WBS 4.1)
]);

interface EndpointManifestEntry {
  functionName: string;
  /** Builds the request URL + init for a call to this endpoint, optionally carrying a store_id. */
  request(opts: { jwt: string; storeId?: string }): { url: string; init: RequestInit };
  /**
   * Asserts the entry's own 200-success response body. Defaults to the
   * qa-console-auth-probe shape ({ok, merchantId}) when omitted -- only
   * entries whose real response contract differs (console-confirm-payment,
   * console-reject-payment: {ok, already, ...}, no merchantId field) need
   * to supply their own.
   */
  assertSuccessBody?(bodyText: string, expectedMerchantId: string): void;
}

function assertProbeSuccessBody(bodyText: string, expectedMerchantId: string): void {
  const body = JSON.parse(bodyText) as { ok: boolean; merchantId: string };
  expect(Object.keys(body).sort()).toEqual(["merchantId", "ok"]);
  expect(body.merchantId).toBe(expectedMerchantId);
}

function assertPaymentActionSuccessBody(bodyText: string): void {
  const body = JSON.parse(bodyText) as { ok: boolean };
  expect(body.ok).toBe(true);
}

// THE manifest. Every console-*/qa-* Edge Function directory on disk must
// appear here or in KNOWN_NON_GUARDED_EXCEPTIONS above.
const ENDPOINT_MANIFEST: EndpointManifestEntry[] = [
  {
    functionName: "qa-console-auth-probe",
    request: ({ jwt, storeId }) => ({
      url:
        storeId !== undefined
          ? `${functionUrl("qa-console-auth-probe")}?store_id=${encodeURIComponent(storeId)}`
          : functionUrl("qa-console-auth-probe"),
      init: { headers: { apikey: LOCAL_ANON_KEY, Authorization: `Bearer ${jwt}` } },
    }),
    assertSuccessBody: assertProbeSuccessBody,
  },
  {
    functionName: "console-confirm-payment",
    // No store_id param on this endpoint by design (0031's own header) --
    // ownership is derived from the orderId's own store_id. `storeId` here
    // just selects which pre-seeded throwaway order (owned by storeA or
    // storeB) the generic tests below exercise; omitted (test 5, always
    // called as merchant A) defaults to merchant A's own order.
    request: ({ jwt, storeId }) => ({
      url: functionUrl("console-confirm-payment"),
      init: {
        method: "POST",
        headers: {
          apikey: LOCAL_ANON_KEY,
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId: storeId === storeB ? confirmOrderB : confirmOrderA }),
      },
    }),
    assertSuccessBody: assertPaymentActionSuccessBody,
  },
  {
    functionName: "console-reject-payment",
    request: ({ jwt, storeId }) => ({
      url: functionUrl("console-reject-payment"),
      init: {
        method: "POST",
        headers: {
          apikey: LOCAL_ANON_KEY,
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orderId: storeId === storeB ? rejectOrderB : rejectOrderA }),
      },
    }),
    assertSuccessBody: assertPaymentActionSuccessBody,
  },
];

function listGuardableFunctionDirNames(): string[] {
  return readdirSync(FUNCTIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("_")) // _shared, _tests -- not deployable functions
    .filter((name) => name.startsWith("console-") || name.startsWith("qa-"));
}

describe("endpoint manifest completeness", () => {
  // Pure filesystem checks -- no reachability gate, always run.
  it("sanity: the scan actually finds console-*/qa-* directories (not vacuously passing against an empty functions dir)", () => {
    expect(listGuardableFunctionDirNames().length).toBeGreaterThan(0);
  });

  it("every console-*/qa-* function directory on disk is covered by the manifest or a named exception", () => {
    const onDisk = listGuardableFunctionDirNames();
    const manifestNames = new Set(ENDPOINT_MANIFEST.map((e) => e.functionName));
    const uncovered = onDisk.filter(
      (name) => !manifestNames.has(name) && !KNOWN_NON_GUARDED_EXCEPTIONS.has(name),
    );
    expect(uncovered).toEqual([]);
  });

  it("every manifest entry corresponds to a real directory on disk (no stale entry testing a deleted function)", () => {
    const onDisk = new Set(listGuardableFunctionDirNames());
    const stale = ENDPOINT_MANIFEST.map((e) => e.functionName).filter((name) => !onDisk.has(name));
    expect(stale).toEqual([]);
  });

  it("the exception list and the manifest are disjoint (an endpoint is either driven or explicitly excused, never both)", () => {
    const manifestNames = new Set(ENDPOINT_MANIFEST.map((e) => e.functionName));
    const overlap = [...KNOWN_NON_GUARDED_EXCEPTIONS].filter((name) => manifestNames.has(name));
    expect(overlap).toEqual([]);
  });
});

let ready = false;
let merchantA: AuthUserFixture | undefined;
let merchantB: AuthUserFixture | undefined;
let storeA: string | undefined;
let storeB: string | undefined;
// Throwaway PENDING_PAYMENT orders for console-confirm-payment /
// console-reject-payment's manifest entries above -- separate order per
// (function, store) pair so the two entries' state transitions never
// interfere with each other's assertions.
let confirmOrderA: string | undefined;
let confirmOrderB: string | undefined;
let rejectOrderA: string | undefined;
let rejectOrderB: string | undefined;

beforeAll(async () => {
  const reachable = await isFunctionReachable("qa-console-auth-probe");
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[tenant_isolation.test.ts] SKIPPING — the local Edge Functions server " +
        "isn't serving qa-console-auth-probe. Run `supabase start`, `supabase " +
        "db reset`, then `supabase functions serve --no-verify-jwt --import-map " +
        "supabase/functions/deno.json`. This is a SKIP, not a pass.\n",
    );
    return;
  }
  ready = true;

  merchantA = await createWellFormedAuthUserFixture();
  merchantB = await createWellFormedAuthUserFixture();
  storeA = await insertStoreForMerchant(merchantA.merchantId, "a");
  storeB = await insertStoreForMerchant(merchantB.merchantId, "b");

  confirmOrderA = await insertThrowawayOrder(storeA, "confirm-a");
  confirmOrderB = await insertThrowawayOrder(storeB, "confirm-b");
  rejectOrderA = await insertThrowawayOrder(storeA, "reject-a");
  rejectOrderB = await insertThrowawayOrder(storeB, "reject-b");
});

afterAll(async () => {
  // Deleting each fixture's auth.users row cascades merchants -> stores
  // (packages/db/migrations/0003_stores.sql: stores.merchant_id references
  // merchants(id) on delete cascade; auth-user-fixture.ts's own cleanup
  // deletes auth.users) -- one cleanup call per merchant tears down its
  // store too, no separate store cleanup needed.
  if (merchantA) await merchantA.cleanup();
  if (merchantB) await merchantB.cleanup();
});

async function insertStoreForMerchant(merchantId: string, label: string): Promise<string> {
  const client = new PgClient({ connectionString: LOCAL_DB_URL });
  await client.connect();
  try {
    const slug = `qa-tenant-iso-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const { rows } = await client.query<{ id: string }>(
      `insert into stores (merchant_id, slug, name, is_published) values ($1, $2, $3, true) returning id`,
      [merchantId, slug, `QA Tenant Isolation Store ${label.toUpperCase()}`],
    );
    return rows[0].id;
  } finally {
    await client.end();
  }
}

// A minimal PENDING_PAYMENT order -- no items, no payment row -- sufficient
// for console-confirm-payment / console-reject-payment's ownership check
// (0031_payment_confirmation.sql looks up orders.store_id and stops there
// before ever touching order_items/payments) without dragging in the full
// checkout fixture packages/db/tests/payment_confirmation.test.ts builds
// for its own deeper RPC-level assertions -- this suite only needs the
// endpoint to be callable, not its side effects verified.
async function insertThrowawayOrder(storeId: string, label: string): Promise<string> {
  const client = new PgClient({ connectionString: LOCAL_DB_URL });
  await client.connect();
  try {
    const orderCode = `QTI${label.toUpperCase()}${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const { rows } = await client.query<{ id: string }>(
      `insert into orders (store_id, order_code, customer_name, subtotal_satang, total_satang)
       values ($1, $2, $3, $4, $4) returning id`,
      [storeId, orderCode, `QA Tenant Isolation Customer ${label}`, 10000],
    );
    return rows[0].id;
  } finally {
    await client.end();
  }
}

async function callEndpoint(
  entry: EndpointManifestEntry,
  opts: { jwt: string; storeId?: string },
): Promise<{ status: number; bodyText: string }> {
  const { url, init } = entry.request(opts);
  const res = await fetch(url, init);
  const bodyText = await res.text();
  return { status: res.status, bodyText };
}

describe.each(ENDPOINT_MANIFEST)("console endpoint: $functionName", (entry) => {
  it("merchant A supplying merchant B's store_id is rejected -- 403, empty body, never B's data", async () => {
    if (!ready) return;
    const jwtA = mintAuthenticatedJwt(merchantA!.authUserId);
    const { status, bodyText } = await callEndpoint(entry, { jwt: jwtA, storeId: storeB });
    expect(status).toBe(403);
    expect(bodyText).toBe("");
  });

  it("merchant B supplying merchant A's store_id is rejected -- 403, empty body, never A's data (symmetric direction)", async () => {
    if (!ready) return;
    const jwtB = mintAuthenticatedJwt(merchantB!.authUserId);
    const { status, bodyText } = await callEndpoint(entry, { jwt: jwtB, storeId: storeA });
    expect(status).toBe(403);
    expect(bodyText).toBe("");
  });

  it("the 403 body leaks nothing -- no JSON, no stack trace, no store/merchant existence hint", async () => {
    if (!ready) return;
    const jwtA = mintAuthenticatedJwt(merchantA!.authUserId);
    const { bodyText } = await callEndpoint(entry, { jwt: jwtA, storeId: storeB });
    expect(bodyText).toBe(""); // stronger than a substring scan: nothing at all leaks
    expect(bodyText).not.toMatch(/at .*\.ts:\d+|Error:|stack|Deno\.|store|merchant/i);
  });

  it("merchant A supplying merchant A's OWN store_id succeeds -- 200 (the assertion isn't just rejecting everything)", async () => {
    if (!ready) return;
    const jwtA = mintAuthenticatedJwt(merchantA!.authUserId);
    const { status, bodyText } = await callEndpoint(entry, { jwt: jwtA, storeId: storeA });
    expect(status).toBe(200);
    (entry.assertSuccessBody ?? assertProbeSuccessBody)(bodyText, merchantA!.merchantId);
  });

  it("no store_id supplied at all -- existing 200 behavior is unaffected (regression check against the pre-WBS-4.2 probe)", async () => {
    if (!ready) return;
    const jwtA = mintAuthenticatedJwt(merchantA!.authUserId);
    const { status, bodyText } = await callEndpoint(entry, { jwt: jwtA });
    expect(status).toBe(200);
    (entry.assertSuccessBody ?? assertProbeSuccessBody)(bodyText, merchantA!.merchantId);
  });
});

describe("sanity — both merchants' stores genuinely exist via service_role", () => {
  it("proves the 403 assertions above aren't vacuously passing against stores that don't exist", async () => {
    if (!ready) return;
    const service = serviceClient();
    const { data, error } = await service.from("stores").select("id").in("id", [storeA, storeB]);
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(2);
  });

  it("proves A and B are genuinely different merchants, not the same row twice (a vacuous-pass risk if fixture creation collided)", async () => {
    if (!ready) return;
    expect(merchantA!.merchantId).not.toBe(merchantB!.merchantId);
    expect(storeA).not.toBe(storeB);
  });
});
