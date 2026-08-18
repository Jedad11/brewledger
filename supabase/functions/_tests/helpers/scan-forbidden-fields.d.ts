// Ambient typing for scripts/scan-forbidden-fields.mjs, which is plain
// (untyped) Node ESM by design — it's a standalone CI script, not part of
// any TS package's build. This declaration exists only so
// forbidden_field_scan.test.ts gets real types instead of implicit `any`
// when importing it.
declare module "*/scan-forbidden-fields.mjs" {
  export function loadForbiddenSubstrings(forbiddenFieldsPath: string): string[];
  export function scanForForbiddenFields(
    snapshotDir: string,
    forbiddenSubstrings: string[],
  ): Array<{ file: string; substring: string }>;
}
