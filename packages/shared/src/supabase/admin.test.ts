// WBS 3.2 — RL-3 service_role browser guard.
//
// admin.ts throws at *module import time* (not call time) when `window`
// exists on globalThis. This is the single highest-consequence check in
// this change: a passing import in a browser bundle means the service_role
// key — which bypasses RLS entirely — has shipped to the public. See
// architect.md's "Never Compromise" list and packages/shared/src/supabase/admin.ts.
//
// Testing a module-level throw needs a fresh module registry per case, since
// a normal `import` is cached after the first evaluation. We use
// `vi.resetModules()` + dynamic `import()` with a cache-busting query so each
// test re-evaluates the module under a clean globalThis.window state.
import { afterEach, describe, expect, it, vi } from "vitest";

const ADMIN_MODULE_PATH = "./admin.ts";

function deleteWindow() {
  delete (globalThis as { window?: unknown }).window;
}

describe("createAdminClient module guard (RL-3)", () => {
  afterEach(() => {
    deleteWindow();
    vi.resetModules();
  });

  it("throws at import time when globalThis.window exists (browser bundle)", async () => {
    (globalThis as { window?: unknown }).window = {};
    vi.resetModules();

    await expect(
      import(/* @vite-ignore */ `${ADMIN_MODULE_PATH}?case=browser`),
    ).rejects.toThrow(/RL-3: service_role client imported into a browser bundle/);
  });

  it("does not throw at import time when globalThis.window is absent (Node/server)", async () => {
    deleteWindow();
    vi.resetModules();

    await expect(
      import(/* @vite-ignore */ `${ADMIN_MODULE_PATH}?case=server`),
    ).resolves.toBeTruthy();
  });

  it("exports a working createAdminClient in the server (no-window) case", async () => {
    deleteWindow();
    vi.resetModules();

    const mod = await import(/* @vite-ignore */ `${ADMIN_MODULE_PATH}?case=server-factory`);
    expect(typeof mod.createAdminClient).toBe("function");

    const client = mod.createAdminClient(
      "https://example.supabase.co",
      "service-role-key-placeholder",
    );
    expect(client).toBeTruthy();
    // Sanity: it's a real Supabase client, not a stub — has the expected surface.
    expect(typeof client.from).toBe("function");
  });

  it("re-throws on every fresh import while window is present, not just the first", async () => {
    (globalThis as { window?: unknown }).window = {};
    vi.resetModules();

    await expect(
      import(/* @vite-ignore */ `${ADMIN_MODULE_PATH}?case=repeat-1`),
    ).rejects.toThrow();

    vi.resetModules();

    await expect(
      import(/* @vite-ignore */ `${ADMIN_MODULE_PATH}?case=repeat-2`),
    ).rejects.toThrow();
  });
});
