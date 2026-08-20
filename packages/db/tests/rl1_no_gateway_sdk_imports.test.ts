// WBS 4.5 — RL-1 static guard: no file anywhere in the tree may import a
// licensed payment gateway SDK. The gateway integration (2C2P / Omise) was
// withdrawn for the MVP -- see docs/adr/008-direct-promptpay.md and the
// WBS 4.5 entry's "Remove from the codebase" activity -- in favour of
// direct merchant-owned PromptPay, where money moves bank-to-bank and Brew
// Ledger is never a party to the transfer. A gateway SDK import creeping
// back in (a leftover dependency, a copy-pasted adapter, a "just for
// staging" experiment) would be a structural regression back toward a
// platform-in-the-middle model that RL-1 forbids.
//
// Pure filesystem/text scan -- no DB connection needed, unlike this
// directory's other rl1_*.test.ts (schema introspection requires a live
// Postgres; forbidden imports do not), so this file has no beforeAll/skip
// gate and always runs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..");

const EXCLUDED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
]);

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

// The two gateways the withdrawn plan named explicitly (docs/adr/008), plus
// a broader net of other commonly-integrated payment gateway/processor SDKs
// -- so this guard catches "a different gateway" being wired in, not only a
// literal reintroduction of the two originally withdrawn.
const FORBIDDEN_GATEWAY_PACKAGE_PATTERNS = [
  /2c2p/i,
  /\bomise\b/i,
  /\bstripe\b/i,
  /braintree/i,
  /\bpaypal\b/i,
  /chillpay/i,
  /gbprimepay/i,
  /\bopn-?payments?\b/i,
  /beam-?checkout/i,
  /\bktc-?epay\b/i,
];

interface FoundFile {
  path: string;
  ext: string;
}

function walk(dir: string, out: FoundFile[]): void {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIR_NAMES.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (entry === "package.json") {
      out.push({ path: full, ext: "package.json" });
      continue;
    }
    const ext = SOURCE_EXTENSIONS.find((e) => entry.endsWith(e));
    if (ext) out.push({ path: full, ext });
  }
}

// Matches ES import specifiers, CommonJS require() calls, and dynamic
// import() calls -- the three ways a gateway SDK could actually be pulled
// into a module graph.
const IMPORT_SPECIFIER_PATTERN =
  /(?:from\s*|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;

describe("WBS 4.5 — RL-1: no payment gateway SDK is imported anywhere in the tree", () => {
  const files: FoundFile[] = [];
  walk(REPO_ROOT, files);

  it("sanity: the scan actually found source files (a walk returning nothing would make every assertion below vacuous)", () => {
    const sourceFiles = files.filter((f) => f.ext !== "package.json");
    expect(sourceFiles.length).toBeGreaterThan(100);
  });

  it("no import/require/dynamic-import specifier in any source file matches a known payment gateway SDK package", () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (file.ext === "package.json") continue;
      const content = readFileSync(file.path, "utf8");
      let match: RegExpExecArray | null;
      IMPORT_SPECIFIER_PATTERN.lastIndex = 0;
      while ((match = IMPORT_SPECIFIER_PATTERN.exec(content)) !== null) {
        const specifier = match[1];
        if (FORBIDDEN_GATEWAY_PACKAGE_PATTERNS.some((p) => p.test(specifier))) {
          offenders.push(`${relative(REPO_ROOT, file.path)}: imports "${specifier}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("no package.json anywhere in the tree lists a payment gateway SDK as a dependency", () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (file.ext !== "package.json") continue;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(readFileSync(file.path, "utf8"));
      } catch {
        continue; // not this test's concern if some unrelated package.json is malformed
      }
      const depFields = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
      for (const field of depFields) {
        const deps = parsed[field];
        if (!deps || typeof deps !== "object") continue;
        for (const depName of Object.keys(deps as Record<string, unknown>)) {
          if (FORBIDDEN_GATEWAY_PACKAGE_PATTERNS.some((p) => p.test(depName))) {
            offenders.push(`${relative(REPO_ROOT, file.path)}: ${field}["${depName}"]`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("no environment/config file references a GATEWAY_* variable (the withdrawn plan's credential shape)", () => {
    const offenders: string[] = [];
    const GATEWAY_ENV_PATTERN = /\bGATEWAY_[A-Z0-9_]+\b/;
    // This test file necessarily names the pattern it's checking for (in
    // this very string literal, and in this describe block's title) --
    // exclude it from its own scan rather than let it flag itself.
    const SELF = join(__dirname, "rl1_no_gateway_sdk_imports.test.ts");

    for (const file of files) {
      if (file.ext === "package.json") continue;
      if (file.path === SELF) continue;
      const content = readFileSync(file.path, "utf8");
      if (GATEWAY_ENV_PATTERN.test(content)) {
        offenders.push(relative(REPO_ROOT, file.path));
      }
    }

    expect(offenders).toEqual([]);
  });
});
