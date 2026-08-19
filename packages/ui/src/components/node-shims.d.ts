// Minimal ambient Node built-in shims for Toggle.test.tsx only.
//
// packages/ui has no @types/node dependency -- no other file in this
// package touches a Node built-in, and its tsconfig.json `lib` is just
// ["ES2022","DOM"]. Rather than add that dependency for one test file's
// sake, this declares just the handful of fs/path/url exports Toggle.test
// .tsx actually calls, scoped to this package only.
//
// Deliberately has NO top-level import/export: that's what makes this a
// non-module "global script" file, so `declare module "fs" { ... }` below
// is treated as a fresh ambient module declaration rather than an
// augmentation of one TypeScript expects to already exist (which is what
// happens when the same `declare module` is written inside a file that IS
// itself a module, per the TS spec).
declare module "fs" {
  export function readFileSync(path: string, encoding: string): string;
}

declare module "path" {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
}

declare module "url" {
  export function fileURLToPath(url: string): string;
}
