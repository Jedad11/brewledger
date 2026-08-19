// Ambient typing for scripts/check-shop-has-no-auth.mjs, which is plain
// (untyped) Node ESM by design — it's a standalone CI script, not part of
// any TS package's build. This declaration exists only so
// shop_no_auth_scan.test.ts gets real types instead of implicit `any` when
// importing it. Same pattern as scan-forbidden-fields.d.ts in this directory.
declare module "*/check-shop-has-no-auth.mjs" {
  export function scanShopForAuthCode(
    shopDir: string,
  ): Array<{ type: "import" | "call" | "route"; file: string; detail: string }>;
}
