// WBS 4.2 — unit-level test for assertOwnedStore / ForbiddenStoreError in
// supabase/functions/_shared/console/auth.ts, independent of the HTTP
// roundtrip. tenant_isolation.test.ts (same directory) covers the real
// cross-tenant HTTP path through withConsoleAuth + a real Edge Function; this
// file isolates the pure scoping check itself: given a ConsoleContext and a
// storeId, does it throw the RIGHT thing, with no database, no HTTP, no
// Supabase stack required. Always runs (no reachability gate) — a real,
// direct import of the production module, not a reimplementation of its
// logic.
//
// The import below only resolves because of this package's own
// vitest.config.mts, which aliases the Deno-only "npm:@supabase/supabase-js@2"
// specifier _shared/console/auth.ts uses to the plain npm package already in
// this test package's own devDependencies — see that file's header. No
// production file is modified to make this import work.
import { describe, expect, it } from "vitest";
import { assertOwnedStore, ForbiddenStoreError, type ConsoleContext } from "../_shared/console/auth.ts";

function fakeCtx(storeIds: string[]): ConsoleContext {
  return {
    merchantId: "00000000-0000-0000-0000-0000000000aa",
    storeIds,
    // assertOwnedStore never touches ctx.supabase -- it only compares
    // storeIds. A real SupabaseClient is deliberately not constructed here.
    supabase: {} as ConsoleContext["supabase"],
  };
}

describe("assertOwnedStore", () => {
  it("does not throw when storeId IS a member of ctx.storeIds", () => {
    const ctx = fakeCtx(["store-a", "store-b"]);
    expect(() => assertOwnedStore(ctx, "store-b")).not.toThrow();
  });

  it("does not throw for every member of a multi-store ctx.storeIds, not just the first", () => {
    const ctx = fakeCtx(["store-a", "store-b", "store-c"]);
    expect(() => assertOwnedStore(ctx, "store-a")).not.toThrow();
    expect(() => assertOwnedStore(ctx, "store-b")).not.toThrow();
    expect(() => assertOwnedStore(ctx, "store-c")).not.toThrow();
  });

  it("throws ForbiddenStoreError specifically -- not just any Error -- when storeId is NOT a member of ctx.storeIds", () => {
    const ctx = fakeCtx(["store-a"]);
    expect(() => assertOwnedStore(ctx, "store-not-owned")).toThrow(ForbiddenStoreError);

    let caught: unknown;
    try {
      assertOwnedStore(ctx, "store-not-owned");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ForbiddenStoreError);
    expect((caught as Error).name).toBe("ForbiddenStoreError");
    // Also NOT some other error shape a lazy refactor could silently swap in
    // (e.g. a bare Error or TypeError) -- instanceof already proves this, but
    // pin the constructor identity too so a future "throw new Error(...)"
    // regression fails loudly here rather than only at the HTTP layer.
    expect((caught as Error).constructor).toBe(ForbiddenStoreError);
  });

  it("throws when ctx.storeIds is empty -- a merchant with no stores owns nothing", () => {
    const ctx = fakeCtx([]);
    expect(() => assertOwnedStore(ctx, "any-store")).toThrow(ForbiddenStoreError);
  });

  it("is NOT fooled by a substring/prefix match -- storeIds membership is exact, not a partial match", () => {
    const ctx = fakeCtx(["store-a"]);
    expect(() => assertOwnedStore(ctx, "store-a-extra")).toThrow(ForbiddenStoreError);
    expect(() => assertOwnedStore(ctx, "store-")).toThrow(ForbiddenStoreError);
  });

  it("the thrown error's message names the rejected storeId (useful in server logs) -- distinct from the empty HTTP response body withConsoleAuth returns for it", () => {
    const ctx = fakeCtx(["store-a"]);
    expect(() => assertOwnedStore(ctx, "store-x")).toThrow(/store-x/);
  });
});
