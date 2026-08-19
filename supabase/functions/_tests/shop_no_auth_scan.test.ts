// WBS 4.1 §5 — "Structural: apps/shop contains no auth code (fails build
// otherwise)." The RL-3/F01 boundary assertion left as this entry's main gap
// for qa_engineer (see apps/console/src/lib/phone.ts's header comment and
// PROGRESS.md's WBS 4.1 row: "Explicitly not done ... left for qa_engineer").
//
// Exercises scripts/check-shop-has-no-auth.mjs directly (imported as a
// module, same pattern as forbidden_field_scan.test.ts in this directory),
// not shelled out, so it's a fast in-process test. Two things are proven,
// not just one: (1) the REAL apps/shop directory in this repo is clean
// today, and (2) the scanner genuinely detects each of the three violation
// shapes named in the WBS when planted in a scratch directory — a scanner
// that always reports "clean" because of a bug would make (1) worthless.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-relative-packages
import { scanShopForAuthCode } from "../../../scripts/check-shop-has-no-auth.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const REAL_SHOP_DIR = join(REPO_ROOT, "apps/shop");

describe("check-shop-has-no-auth.mjs", () => {
  it("the real apps/shop directory has zero hits today", () => {
    const hits = scanShopForAuthCode(REAL_SHOP_DIR);
    expect(hits).toEqual([]);
  });

  describe("detection proof — each violation shape named in the WBS is actually caught", () => {
    let scratchDir: string | undefined;

    afterEach(() => {
      if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
      scratchDir = undefined;
    });

    it("catches an @supabase/auth-helpers import", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-shop-auth-scan-"));
      mkdirSync(join(scratchDir, "src", "app"), { recursive: true });
      writeFileSync(
        join(scratchDir, "src", "app", "some-component.tsx"),
        `import { createBrowserClient } from "@supabase/auth-helpers-nextjs";\nexport const x = createBrowserClient;\n`,
      );

      const hits = scanShopForAuthCode(scratchDir);
      expect(hits.some((h) => h.type === "import")).toBe(true);
    });

    it("catches a signIn(...) call", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-shop-auth-scan-"));
      mkdirSync(join(scratchDir, "src", "app"), { recursive: true });
      writeFileSync(
        join(scratchDir, "src", "app", "some-component.tsx"),
        `export async function doThing() {\n  await signIn("phone");\n}\n`,
      );

      const hits = scanShopForAuthCode(scratchDir);
      expect(hits.some((h) => h.type === "call" && h.detail.startsWith("signIn"))).toBe(true);
    });

    it("catches a signUp(...) call", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-shop-auth-scan-"));
      mkdirSync(join(scratchDir, "src", "app"), { recursive: true });
      writeFileSync(
        join(scratchDir, "src", "app", "some-component.tsx"),
        `export async function doThing() {\n  await signUp({ phone: "x" });\n}\n`,
      );

      const hits = scanShopForAuthCode(scratchDir);
      expect(hits.some((h) => h.type === "call" && h.detail.startsWith("signUp"))).toBe(true);
    });

    it("catches a getSession(...) call", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-shop-auth-scan-"));
      mkdirSync(join(scratchDir, "src", "app"), { recursive: true });
      writeFileSync(
        join(scratchDir, "src", "app", "some-component.tsx"),
        `export async function doThing() {\n  const s = await getSession();\n  return s;\n}\n`,
      );

      const hits = scanShopForAuthCode(scratchDir);
      expect(hits.some((h) => h.type === "call" && h.detail.startsWith("getSession"))).toBe(true);
    });

    // Regression coverage for the widened AUTH_CALL_RE (redline_reviewer
    // finding, 2026-08-19): the original regex matched only the exact
    // WBS-named identifiers (signIn/signUp/getSession) and missed the shapes
    // this project's own console code actually uses —
    // supabase.auth.signInWithOtp(...) and supabase.auth.verifyOtp(...) —
    // because "signIn" immediately followed by "With" never reached a bare
    // `signIn(`. The generalized `.auth.\w+(` alternative now catches any
    // Supabase Auth method call by shape, not by name.
    it("catches a .auth.signInWithOtp(...) call (the shape console actually uses)", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-shop-auth-scan-"));
      mkdirSync(join(scratchDir, "src", "app"), { recursive: true });
      writeFileSync(
        join(scratchDir, "src", "app", "some-component.tsx"),
        `export async function doThing(supabase: unknown) {\n  await (supabase as { auth: { signInWithOtp: (a: unknown) => unknown } }).auth.signInWithOtp({ phone: "+66800000000" });\n}\n`,
      );

      const hits = scanShopForAuthCode(scratchDir);
      expect(hits.some((h) => h.type === "call" && h.detail === ".auth.signInWithOtp(")).toBe(true);
    });

    it("catches a .auth.verifyOtp(...) call (the shape console actually uses)", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-shop-auth-scan-"));
      mkdirSync(join(scratchDir, "src", "app"), { recursive: true });
      writeFileSync(
        join(scratchDir, "src", "app", "some-component.tsx"),
        `export async function doThing(supabase: unknown) {\n  await (supabase as { auth: { verifyOtp: (a: unknown) => unknown } }).auth.verifyOtp({ phone: "+66800000000", token: "123456", type: "sms" });\n}\n`,
      );

      const hits = scanShopForAuthCode(scratchDir);
      expect(hits.some((h) => h.type === "call" && h.detail === ".auth.verifyOtp(")).toBe(true);
    });

    it("catches a /login route (a page.tsx under an app-router 'login' folder)", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-shop-auth-scan-"));
      mkdirSync(join(scratchDir, "src", "app", "login"), { recursive: true });
      writeFileSync(
        join(scratchDir, "src", "app", "login", "page.tsx"),
        `export default function Page() { return null; }\n`,
      );

      const hits = scanShopForAuthCode(scratchDir);
      expect(hits.some((h) => h.type === "route" && h.file.includes("login"))).toBe(true);
    });

    it("catches a /signup route", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-shop-auth-scan-"));
      mkdirSync(join(scratchDir, "src", "app", "signup"), { recursive: true });
      writeFileSync(
        join(scratchDir, "src", "app", "signup", "page.tsx"),
        `export default function Page() { return null; }\n`,
      );

      const hits = scanShopForAuthCode(scratchDir);
      expect(hits.some((h) => h.type === "route" && h.file.includes("signup"))).toBe(true);
    });

    it("catches an /auth route", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-shop-auth-scan-"));
      mkdirSync(join(scratchDir, "src", "app", "auth", "callback"), { recursive: true });
      writeFileSync(
        join(scratchDir, "src", "app", "auth", "callback", "route.ts"),
        `export async function GET() { return new Response(null); }\n`,
      );

      const hits = scanShopForAuthCode(scratchDir);
      expect(hits.some((h) => h.type === "route" && h.file.includes("auth"))).toBe(true);
    });

    it("a clean tree with unrelated code produces zero hits (no false positives on ordinary code)", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-shop-auth-scan-"));
      mkdirSync(join(scratchDir, "src", "app", "menu"), { recursive: true });
      writeFileSync(
        join(scratchDir, "src", "app", "menu", "page.tsx"),
        `export default function Page() {\n  const items = fetchMenuItems();\n  return null;\n}\n`,
      );

      const hits = scanShopForAuthCode(scratchDir);
      expect(hits).toEqual([]);
    });
  });
});
