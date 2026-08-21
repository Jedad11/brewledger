// apps/shop and apps/console previously drifted onto different Supabase
// backends in dev (one .env.local pointed local, the sibling app had no
// .env.local and fell back to its committed .env pointing at remote) —
// a published local store 404'd on the storefront with no indication why.
// assertLocalSupabaseInDev is the guard against that recurring silently.
import { describe, expect, it } from "vitest";
import { assertLocalSupabaseInDev } from "./config";

describe("assertLocalSupabaseInDev", () => {
  it("allows 127.0.0.1 in development", () => {
    expect(() =>
      assertLocalSupabaseInDev("http://127.0.0.1:54321", { NODE_ENV: "development" }),
    ).not.toThrow();
  });

  it("allows localhost in development", () => {
    expect(() =>
      assertLocalSupabaseInDev("http://localhost:54321", { NODE_ENV: "development" }),
    ).not.toThrow();
  });

  it("throws when development points at a remote host", () => {
    expect(() =>
      assertLocalSupabaseInDev("https://xeoaoabqmqutnsssneiq.supabase.co", {
        NODE_ENV: "development",
      }),
    ).toThrow(/not the local/);
  });

  it("throws on an unparseable URL in development", () => {
    expect(() => assertLocalSupabaseInDev("not-a-url", { NODE_ENV: "development" })).toThrow(
      /not a valid URL/,
    );
  });

  it("does nothing outside development (production, preview builds)", () => {
    expect(() =>
      assertLocalSupabaseInDev("https://xeoaoabqmqutnsssneiq.supabase.co", {
        NODE_ENV: "production",
      }),
    ).not.toThrow();
  });

  it("does nothing when the URL is missing — loadBrowserConfig owns that error", () => {
    expect(() => assertLocalSupabaseInDev(undefined, { NODE_ENV: "development" })).not.toThrow();
  });
});
