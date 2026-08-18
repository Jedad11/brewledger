// WBS 3.7 §7 test contract — "Forbidden-field CI scan".
//
// Exercises scripts/scan-forbidden-fields.mjs directly (imported as a
// module, not shelled out — it exports scanForForbiddenFields /
// loadForbiddenSubstrings precisely so this can be a fast in-process test).
// Two things are proven, not just one: (1) the real committed snapshot
// fixtures in __snapshots__/ are genuinely clean against the real
// docs/design/forbidden_fields.json today, and (2) the scanner actually
// DETECTS a forbidden substring when one is present — a scan that always
// reports "clean" because of a scanning bug would make (1) worthless.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-relative-packages
import { loadForbiddenSubstrings, scanForForbiddenFields } from "../../../scripts/scan-forbidden-fields.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SNAPSHOT_DIR = join(REPO_ROOT, "supabase/functions/_tests/__snapshots__");
const FORBIDDEN_FIELDS_PATH = join(REPO_ROOT, "docs/design/forbidden_fields.json");

describe("scan-forbidden-fields.mjs", () => {
  it("the real committed snapshot fixtures have zero hits against the real forbidden_fields.json", () => {
    const forbiddenSubstrings = loadForbiddenSubstrings(FORBIDDEN_FIELDS_PATH);
    expect(forbiddenSubstrings.length).toBeGreaterThan(0); // sanity: the list itself isn't empty
    const hits = scanForForbiddenFields(SNAPSHOT_DIR, forbiddenSubstrings);
    expect(hits).toEqual([]);
  });

  describe("detection proof — a planted forbidden substring", () => {
    let scratchDir: string | undefined;

    afterEach(() => {
      if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
      scratchDir = undefined;
    });

    it("is caught when a snapshot file contains a forbidden field name as a JSON key", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-forbidden-scan-"));
      writeFileSync(
        join(scratchDir, "leaked-menu-item.json"),
        JSON.stringify({ id: "x", name: "Latte", cost_satang: 1800 }),
      );

      const forbiddenSubstrings = loadForbiddenSubstrings(FORBIDDEN_FIELDS_PATH);
      const hits = scanForForbiddenFields(scratchDir, forbiddenSubstrings);

      expect(hits).toHaveLength(1);
      expect(hits[0].substring).toBe("cost_satang");
      expect(hits[0].file).toContain("leaked-menu-item.json");
    });

    it("is caught for a substring embedded mid-value, not just as a key (margin/profit/etc are still substrings)", () => {
      scratchDir = mkdtempSync(join(tmpdir(), "brewledger-forbidden-scan-"));
      writeFileSync(
        join(scratchDir, "leaked-note.json"),
        JSON.stringify({ note: "storemarginnote" }), // lowercase — the scan is a plain substring match, not case-insensitive
      );

      const forbiddenSubstrings = loadForbiddenSubstrings(FORBIDDEN_FIELDS_PATH);
      const hits = scanForForbiddenFields(scratchDir, forbiddenSubstrings);

      expect(hits.some((h: { substring: string }) => h.substring === "margin")).toBe(true);
    });
  });
});
