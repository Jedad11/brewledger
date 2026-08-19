// WBS 4.2 — regression coverage for resolveMerchantCtx() (apps/console/src/lib/merchant.ts).
//
// Why this file exists: resolveMerchantCtx() had a real bug, found by
// redline_reviewer and fixed by engineer, that no test caught because nothing
// exercised the function at all. The bug: auth_store_ids() is
// `returns setof uuid` (a scalar set-returning function), so supabase-js's
// .rpc() resolves to a plain `string[]` -- but the old code mapped the result
// as if it were `{ auth_store_ids: string }[]` row objects
// (`rows.map(r => r.auth_store_ids)`). Mapping a property off a bare string
// produces `undefined`, so every real UUID silently became `undefined`.
// `storeIds.length` stayed correct (so the zero-store short-circuit below
// never caught it), which is exactly why this only broke merchants who
// actually own a store, and why a test that only covers the zero-store case
// would still pass against the buggy code.
//
// Unit-tested against a mocked Supabase client rather than a live Postgres
// roundtrip: this bug class is a pure JS mapping error over a
// realistically-shaped supabase-js response, not a query-correctness
// question RLS/Postgres would need to adjudicate (that's WBS 3.6/4.2's own
// tenant_isolation.test.ts territory, which runs against the real stack).
// apps/console has no vitest.config.ts of its own; the existing
// phone.test.ts is this app's only other unit suite, and confirms `vitest
// run` from apps/console needs nothing extra to execute a plain unit test.
// The "@/..." tsconfig path alias used by merchant.ts (and mocked below)
// resolves under vitest with no extra config -- verified directly before
// writing this file.
//
// createClient() (apps/console/src/lib/supabase/server.ts) is mocked at the
// module boundary because it depends on next/headers' cookies(), which only
// works inside a real Next.js request context -- not something a unit test
// should stand up just to prove a JS array-shape bug.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "./merchant";

const mockedCreateClient = vi.mocked(createClient);

// A real user id and two real-shaped store UUIDs -- distinct from each
// other and from the merchant id, so a test that accidentally reads the
// wrong field would fail loudly instead of coincidentally matching.
const AUTH_USER_ID = "11111111-1111-4111-8111-111111111111";
const MERCHANT_ID = "22222222-2222-4222-8222-222222222222";
const STORE_ID_A = "33333333-3333-4333-8333-333333333333";
const STORE_ID_B = "44444444-4444-4444-8444-444444444444";

interface SupabaseMockConfig {
  user?: { id: string } | null;
  userErr?: unknown;
  // What .rpc("auth_store_ids") resolves to. Deliberately typed as the REAL
  // supabase-js shape (a plain string[], since the function is `returns
  // setof uuid`) everywhere in this file except the one test that
  // reproduces the old buggy row-object shape on purpose.
  rpcData?: unknown;
  rpcErr?: unknown;
  merchant?: { id: string } | null;
  merchantErr?: unknown;
  storeRows?: Array<{ id: string; slug: string; name: string; is_published: boolean }> | null;
  storesErr?: unknown;
}

/**
 * Builds a mock object matching the subset of the Supabase client
 * resolveMerchantCtx() actually calls: auth.getUser(), rpc(), and
 * .from("merchants"|"stores").select(...)....
 *
 * Returns the client mock plus the individual `single`/`in` terminal mocks
 * so a test can assert on the exact arguments resolveMerchantCtx() passed
 * through -- the `.in("id", storeIds)` call is the one that would have
 * received `[undefined, undefined]` under the old buggy mapping, so
 * asserting its actual call arguments is what makes this suite fail against
 * the pre-fix code rather than just against a broken return value.
 */
function buildSupabaseMock(config: SupabaseMockConfig) {
  const singleMock = vi.fn().mockResolvedValue({
    data: config.merchant ?? null,
    error: config.merchantErr ?? null,
  });
  const merchantEqMock = vi.fn().mockReturnValue({ single: singleMock });
  const merchantSelectMock = vi.fn().mockReturnValue({ eq: merchantEqMock });

  const storesInMock = vi.fn().mockResolvedValue({
    data: config.storeRows ?? null,
    error: config.storesErr ?? null,
  });
  const storesSelectMock = vi.fn().mockReturnValue({ in: storesInMock });

  const fromMock = vi.fn((table: string) => {
    if (table === "merchants") return { select: merchantSelectMock };
    if (table === "stores") return { select: storesSelectMock };
    throw new Error(`unexpected table passed to .from(): ${table}`);
  });

  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: config.user ?? null },
        error: config.userErr ?? null,
      }),
    },
    rpc: vi.fn().mockResolvedValue({
      data: config.rpcData ?? null,
      error: config.rpcErr ?? null,
    }),
    from: fromMock,
  };

  return { client, singleMock, merchantEqMock, merchantSelectMock, storesInMock, storesSelectMock, fromMock };
}

describe("resolveMerchantCtx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it(
    "a merchant who owns stores gets a non-null MerchantCtx with real store ids threaded through " +
      "(the case the original bug broke for almost every real user)",
    async () => {
      const { client, storesInMock } = buildSupabaseMock({
        user: { id: AUTH_USER_ID },
        // The REAL supabase-js shape for a `returns setof uuid` RPC: a
        // plain array of UUID strings, not `{ auth_store_ids: string }[]`
        // row objects. This is precisely the shape the old code mishandled.
        rpcData: [STORE_ID_A, STORE_ID_B],
        merchant: { id: MERCHANT_ID },
        storeRows: [
          { id: STORE_ID_A, slug: "store-a", name: "Store A", is_published: true },
          { id: STORE_ID_B, slug: "store-b", name: "Store B", is_published: false },
        ],
      });
      mockedCreateClient.mockResolvedValue(client as never);

      const ctx = await resolveMerchantCtx();

      expect(ctx).not.toBeNull();
      expect(ctx!.merchantId).toBe(MERCHANT_ID);

      // The core regression assertion: storeIds must be the real UUID
      // strings, never `undefined`. Under the old
      // `.map(row => row.auth_store_ids)` code, mapping a property off a
      // bare string produces `undefined` for every entry, so this would
      // have failed as `[undefined, undefined]` against the pre-fix
      // implementation.
      expect(ctx!.storeIds).toEqual([STORE_ID_A, STORE_ID_B]);
      expect(ctx!.storeIds.every((id) => typeof id === "string")).toBe(true);

      // The .in("id", storeIds) call is exactly where the old bug surfaced
      // against real Postgres (an array of `undefined` fails `.in` against
      // a uuid column). Asserting the actual call arguments here proves the
      // fix independent of whatever the mocked query happens to return.
      expect(storesInMock).toHaveBeenCalledWith("id", [STORE_ID_A, STORE_ID_B]);

      expect(ctx!.stores).toEqual([
        { id: STORE_ID_A, slug: "store-a", name: "Store A", isPublished: true },
        { id: STORE_ID_B, slug: "store-b", name: "Store B", isPublished: false },
      ]);
    },
  );

  it(
    "reproduces the original bug: mapping the RPC result as row objects turns every real " +
      "store id into undefined and reaches .in() with undefined entries",
    async () => {
      // This test intentionally exercises the OLD buggy mapping logic
      // in-line (not the fixed merchant.ts) to document, executably, why
      // the bug was invisible to a hand-test: storeIds.length stays 2 (not
      // 0), so the zero-store short-circuit never fires, yet every id is
      // undefined by the time .in() is called.
      const rpcData = [STORE_ID_A, STORE_ID_B]; // real supabase-js shape
      const buggyStoreIds = (rpcData as unknown[]).map(
        (row) => (row as { auth_store_ids?: string }).auth_store_ids,
      );

      expect(buggyStoreIds).toHaveLength(2); // length-based short-circuit does NOT catch this
      expect(buggyStoreIds).toEqual([undefined, undefined]); // every id silently lost
    },
  );

  it("a merchant who owns zero stores returns storeIds: [] and stores: [] without querying stores", async () => {
    const { client, storesSelectMock } = buildSupabaseMock({
      user: { id: AUTH_USER_ID },
      rpcData: [],
      merchant: { id: MERCHANT_ID },
    });
    mockedCreateClient.mockResolvedValue(client as never);

    const ctx = await resolveMerchantCtx();

    expect(ctx).toEqual({ merchantId: MERCHANT_ID, storeIds: [], stores: [] });
    // The zero-store short-circuit returns before ever calling .from("stores").
    expect(storesSelectMock).not.toHaveBeenCalled();
  });

  it("no signed-in user returns null", async () => {
    const { client } = buildSupabaseMock({ user: null });
    mockedCreateClient.mockResolvedValue(client as never);

    const ctx = await resolveMerchantCtx();

    expect(ctx).toBeNull();
  });

  it("auth.getUser() returning an error (not just a null user) also returns null", async () => {
    const { client } = buildSupabaseMock({ user: null, userErr: new Error("session invalid") });
    mockedCreateClient.mockResolvedValue(client as never);

    const ctx = await resolveMerchantCtx();

    expect(ctx).toBeNull();
  });

  it("a valid session with no matching merchants row (merchant not found) returns null", async () => {
    const { client } = buildSupabaseMock({
      user: { id: AUTH_USER_ID },
      rpcData: [STORE_ID_A],
      merchant: null,
      merchantErr: { message: "No rows found", code: "PGRST116" },
    });
    mockedCreateClient.mockResolvedValue(client as never);

    const ctx = await resolveMerchantCtx();

    expect(ctx).toBeNull();
  });

  it("auth_store_ids() RPC returning an error returns null without querying merchants or stores", async () => {
    const { client, fromMock } = buildSupabaseMock({
      user: { id: AUTH_USER_ID },
      rpcData: null,
      rpcErr: new Error("rpc failed"),
    });
    mockedCreateClient.mockResolvedValue(client as never);

    const ctx = await resolveMerchantCtx();

    expect(ctx).toBeNull();
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("the stores query erroring returns null even though merchant and store ids resolved", async () => {
    const { client } = buildSupabaseMock({
      user: { id: AUTH_USER_ID },
      rpcData: [STORE_ID_A],
      merchant: { id: MERCHANT_ID },
      storesErr: new Error("stores query failed"),
    });
    mockedCreateClient.mockResolvedValue(client as never);

    const ctx = await resolveMerchantCtx();

    expect(ctx).toBeNull();
  });
});
