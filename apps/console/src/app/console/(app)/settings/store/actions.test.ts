// WBS 4.3 — regression coverage for saveStoreProfile() (actions.ts), plus
// the redline_reviewer post-4.3-audit MEDIUM fix (the isOwnedStoreId guard
// against an unchecked client-supplied storeId).
//
// Mocking pattern mirrors apps/console/src/lib/merchant.test.ts (WBS 4.2):
// createClient() and resolveMerchantCtx() are mocked at the module boundary
// (both depend on next/headers'/Supabase session machinery that only works
// inside a real request context), and the collision-retry loop is exercised
// against a mocked Supabase client that returns a real-shaped Postgres
// 23505 error N times before succeeding -- rather than needing a live DB --
// matching this file's own header comment on why that's safe here (a JS
// control-flow question over a realistically-shaped supabase-js response,
// not a query-correctness question RLS/Postgres needs to adjudicate; that
// coverage lives in packages/db/tests/rls.test.ts instead).
//
// slug.ts itself is NOT mocked: the whole point of the collision-retry test
// below is to prove actions.ts's retry loop calls the REAL
// withCollisionSuffix() correctly on each attempt.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/merchant", () => ({
  resolveMerchantCtx: vi.fn(),
}));
// actions.ts's third "@/..." import, "@/lib/slug", is deliberately left
// UNMOCKED in substance -- the whole point of the collision-retry tests
// below is to prove actions.ts drives the REAL generateSlugBase/slugify/
// withCollisionSuffix correctly. But vitest/Vite here has no tsconfig-paths
// alias plugin configured (apps/console has no vitest.config.ts at all,
// same as merchant.test.ts/phone.test.ts), so the bare "@/lib/slug"
// specifier can't be resolved by the module graph on its own -- only the
// two mocked-with-a-factory imports above sidestep that, since vi.mock
// intercepts by the literal specifier text rather than requiring real
// resolution. This mocks the SPECIFIER only and passes through the ACTUAL
// module (resolved via a real relative path, which Vite can resolve with no
// extra config) as its implementation -- a standard vitest "mock the path,
// keep the behavior" passthrough.
vi.mock("@/lib/slug", async () => {
  const actual = await vi.importActual("../../../../../lib/slug");
  return actual;
});

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { saveStoreProfile, type StoreProfileInput } from "./actions";

const mockedCreateClient = vi.mocked(createClient);
const mockedResolveMerchantCtx = vi.mocked(resolveMerchantCtx);

const MERCHANT_ID = "22222222-2222-4222-8222-222222222222";
const OWNED_STORE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_MERCHANTS_STORE_ID = "99999999-9999-4999-8999-999999999999";

const BASE_INPUT: Omit<StoreProfileInput, "storeId" | "slug"> = {
  name: "Brew Ledger Cafe",
  pickupAddress: "123 Sukhumvit Rd",
  opensAt: "08:00",
  closesAt: "18:00",
  isPublished: true,
};

/**
 * Builds a mock Supabase client whose `.from("stores").insert(row).select
 * (...).single()` chain resolves `failCount` times with a real-shaped
 * Postgres 23505 unique-violation error (the actual error stores_slug_key
 * would raise), then succeeds on the next attempt. Captures every row
 * passed to `.insert()` so a test can assert the exact slug sequence
 * actions.ts's retry loop attempted.
 */
function buildInsertRetryMock(failCount: number) {
  const insertedRows: Array<{ slug: string }> = [];
  let calls = 0;

  const singleMock = vi.fn(() => {
    calls += 1;
    const lastRow = insertedRows[insertedRows.length - 1];
    if (calls <= failCount) {
      return Promise.resolve({
        data: null,
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "stores_slug_key"',
        },
      });
    }
    return Promise.resolve({
      data: { id: "new-store-id", slug: lastRow.slug },
      error: null,
    });
  });
  const selectMock = vi.fn().mockReturnValue({ single: singleMock });
  const insertMock = vi.fn((row: { slug: string }) => {
    insertedRows.push(row);
    return { select: selectMock };
  });
  const fromMock = vi.fn((table: string) => {
    if (table !== "stores") throw new Error(`unexpected table passed to .from(): ${table}`);
    return { insert: insertMock };
  });

  return { client: { from: fromMock }, insertedRows, insertMock, fromMock, callCount: () => calls };
}

/** A client whose from()/update()/insert() would throw if ever reached --
 * used to prove the ownership guard rejects BEFORE any DB call. */
function buildUnreachableClient() {
  const fromMock = vi.fn(() => {
    throw new Error("saveStoreProfile must not touch the DB client for a rejected storeId");
  });
  return { from: fromMock };
}

describe("saveStoreProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isOwnedStoreId guard (redline_reviewer MEDIUM finding)", () => {
    it(
      "a storeId NOT in the merchant's storeIds is rejected before any DB call -- createClient() itself " +
        "is never invoked, so the update/insert methods can't have been either",
      async () => {
        mockedResolveMerchantCtx.mockResolvedValue({
          merchantId: MERCHANT_ID,
          storeIds: [OWNED_STORE_ID],
          stores: [],
        });

        const result = await saveStoreProfile({
          ...BASE_INPUT,
          storeId: OTHER_MERCHANTS_STORE_ID,
          slug: "forged-slug",
        });

        expect(result).toEqual({ error: expect.any(String) });
        expect("ok" in result).toBe(false); // distinct rejection, not a silent fall-through to success
        expect(mockedCreateClient).not.toHaveBeenCalled();
      },
    );

    it("the unreachable-client canary itself would throw if saveStoreProfile ever reached the DB for a forged storeId", async () => {
      // Belt-and-suspenders on the assertion above: even if createClient()
      // somehow got called, wiring it to a client that throws on first use
      // proves no query was attempted either.
      mockedResolveMerchantCtx.mockResolvedValue({
        merchantId: MERCHANT_ID,
        storeIds: [OWNED_STORE_ID],
        stores: [],
      });
      mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

      await expect(
        saveStoreProfile({ ...BASE_INPUT, storeId: OTHER_MERCHANTS_STORE_ID, slug: "forged-slug" }),
      ).resolves.toEqual({ error: expect.any(String) });
    });

    it("a storeId that IS in the merchant's storeIds is accepted through to the update path", async () => {
      mockedResolveMerchantCtx.mockResolvedValue({
        merchantId: MERCHANT_ID,
        storeIds: [OWNED_STORE_ID],
        stores: [],
      });
      const singleMock = vi.fn().mockResolvedValue({ data: { id: OWNED_STORE_ID, slug: "brew-ledger-cafe" }, error: null });
      const selectMock = vi.fn().mockReturnValue({ single: singleMock });
      const eqMock = vi.fn().mockReturnValue({ select: selectMock });
      const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
      const fromMock = vi.fn().mockReturnValue({ update: updateMock });
      mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

      const result = await saveStoreProfile({ ...BASE_INPUT, storeId: OWNED_STORE_ID, slug: "Brew Ledger Cafe" });

      expect(result).toEqual({ ok: true, store: { id: OWNED_STORE_ID, slug: "brew-ledger-cafe" } });
      expect(updateMock).toHaveBeenCalled();
      expect(eqMock).toHaveBeenCalledWith("id", OWNED_STORE_ID);
    });

    it("storeId: null (first-store creation) always passes the guard regardless of storeIds", async () => {
      mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [], stores: [] });
      const { client } = buildInsertRetryMock(0);
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await saveStoreProfile({ ...BASE_INPUT, storeId: null, slug: "Brew Ledger Cafe" });

      expect(result).toEqual({ ok: true, store: { id: "new-store-id", slug: "brew-ledger-cafe" } });
    });
  });

  describe("collision-retry sequencing on Postgres 23505 (stores_slug_key)", () => {
    it("two collisions then success: the slug sequence attempted is base, base-2, base-3", async () => {
      mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [], stores: [] });
      const { client, insertedRows } = buildInsertRetryMock(2);
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await saveStoreProfile({ ...BASE_INPUT, storeId: null, slug: "Brew Ledger Cafe" });

      expect(insertedRows.map((r) => r.slug)).toEqual(["brew-ledger-cafe", "brew-ledger-cafe-2", "brew-ledger-cafe-3"]);
      expect(result).toEqual({ ok: true, store: { id: "new-store-id", slug: "brew-ledger-cafe-3" } });
    });

    it("zero collisions: only one insert attempt is made, with the unsuffixed base slug", async () => {
      mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [], stores: [] });
      const { client, insertedRows, insertMock } = buildInsertRetryMock(0);
      mockedCreateClient.mockResolvedValue(client as never);

      await saveStoreProfile({ ...BASE_INPUT, storeId: null, slug: "Brew Ledger Cafe" });

      expect(insertMock).toHaveBeenCalledTimes(1);
      expect(insertedRows[0].slug).toBe("brew-ledger-cafe");
    });

    it("a non-23505 error stops retrying immediately and surfaces the generic save error", async () => {
      mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [], stores: [] });
      const singleMock = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "23502", message: "null value in column violates not-null constraint" },
      });
      const selectMock = vi.fn().mockReturnValue({ single: singleMock });
      const insertMock = vi.fn().mockReturnValue({ select: selectMock });
      const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
      mockedCreateClient.mockResolvedValue({ from: fromMock } as never);

      const result = await saveStoreProfile({ ...BASE_INPUT, storeId: null, slug: "Brew Ledger Cafe" });

      expect(insertMock).toHaveBeenCalledTimes(1); // no retry on a non-23505 error
      expect(result).toEqual({ error: expect.any(String) });
      expect("ok" in result).toBe(false);
    });

    it("exhausting all 20 attempts on continuous 23505s returns the generic save error, having tried 20 distinct slugs", async () => {
      mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [], stores: [] });
      const { client, insertedRows, insertMock } = buildInsertRetryMock(9999); // never succeeds
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await saveStoreProfile({ ...BASE_INPUT, storeId: null, slug: "Brew Ledger Cafe" });

      expect(result).toEqual({ error: expect.any(String) });
      expect(insertMock).toHaveBeenCalledTimes(20);
      expect(insertedRows.map((r) => r.slug)).toEqual([
        "brew-ledger-cafe",
        ...Array.from({ length: 19 }, (_, i) => `brew-ledger-cafe-${i + 2}`),
      ]);
    });

    it("a blank slug input falls back to a transliterated slug base derived from the store name before retries start", async () => {
      mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [], stores: [] });
      const { client, insertedRows } = buildInsertRetryMock(0);
      mockedCreateClient.mockResolvedValue(client as never);

      await saveStoreProfile({ ...BASE_INPUT, name: "ร้านกาแฟ", storeId: null, slug: "   " });

      expect(insertedRows[0].slug.length).toBeGreaterThan(0);
      expect(/^[a-z0-9-]+$/.test(insertedRows[0].slug)).toBe(true);
    });
  });

  describe("basic input validation (unrelated to the guard/retry logic, kept for completeness)", () => {
    it("resolveMerchantCtx() returning null is rejected without a DB call", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(null);

      const result = await saveStoreProfile({ ...BASE_INPUT, storeId: null, slug: "x" });

      expect(result).toEqual({ error: expect.any(String) });
      expect(mockedCreateClient).not.toHaveBeenCalled();
    });

    it("a blank name is rejected without a DB call", async () => {
      mockedResolveMerchantCtx.mockResolvedValue({ merchantId: MERCHANT_ID, storeIds: [], stores: [] });

      const result = await saveStoreProfile({ ...BASE_INPUT, name: "   ", storeId: null, slug: "x" });

      expect(result).toEqual({ error: expect.any(String) });
      expect(mockedCreateClient).not.toHaveBeenCalled();
    });
  });
});
