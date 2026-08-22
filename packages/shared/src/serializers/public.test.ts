// WBS 3.7 — direct unit coverage for toPublicMenuItem's imageUrl field.
//
// Context: the bug fixed alongside this test was toPublicMenuItem passing
// the raw Storage object path ({store_id}/{menu_item_id}.webp) straight
// through as imageUrl instead of a fetchable public URL. apps/shop's
// isAbsoluteHttpUrl guard silently swallowed the defect by falling back to
// the placeholder, so nothing here was ever exercised end to end.
// public.schema.test.ts only ever hand-builds already-camelCased DTOs and
// never calls toPublicMenuItem itself, so this file is the first place the
// row -> DTO mapping (and specifically the image_path -> imageUrl join with
// menuImagePublicUrl) gets exercised directly.
import { describe, expect, it } from "vitest";
import { toPublicMenuItem } from "./public";
import { menuImagePublicUrl } from "../storage/menuImagePath";
import type { Database } from "@brewledger/db/types";

type MenuItemRow = Database["public"]["Tables"]["menu_items"]["Row"];

const UUID_ITEM = "33333333-3333-4333-8333-333333333333";
const UUID_CATEGORY = "44444444-4444-4444-8444-444444444444";
const UUID_STORE = "55555555-5555-4555-8555-555555555555";

function makeRow(overrides: Partial<MenuItemRow> = {}): MenuItemRow {
  return {
    id: UUID_ITEM,
    store_id: UUID_STORE,
    category_id: UUID_CATEGORY,
    name: "Latte",
    description: "Espresso with steamed milk",
    image_path: null,
    price_satang: 6500,
    availability: "available",
    sort_order: 0,
    created_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

describe("toPublicMenuItem — imageUrl", () => {
  it("image_path set builds a real absolute public Storage URL, not the raw path", () => {
    const row = makeRow({ image_path: `${UUID_STORE}/${UUID_ITEM}.webp` });
    const result = toPublicMenuItem(row, "https://project-ref.supabase.co");

    expect(result.imageUrl).toBe(
      `https://project-ref.supabase.co/storage/v1/object/public/menu-images/${UUID_STORE}/${UUID_ITEM}.webp`,
    );
  });

  it("image_path set is never the bare object path itself (the regression this fix closes)", () => {
    const path = `${UUID_STORE}/${UUID_ITEM}.webp`;
    const row = makeRow({ image_path: path });
    const result = toPublicMenuItem(row, "https://project-ref.supabase.co");

    expect(result.imageUrl).not.toBe(path);
    expect(result.imageUrl?.startsWith("https://")).toBe(true);
  });

  it("image_path null produces imageUrl: null — never a broken URL, never the string \"null\"", () => {
    const row = makeRow({ image_path: null });
    const result = toPublicMenuItem(row, "https://project-ref.supabase.co");

    expect(result.imageUrl).toBeNull();
    expect(result.imageUrl).not.toBe("null");
  });

  it("supabaseUrl with no trailing slash (this codebase's SUPABASE_URL convention) concatenates cleanly — no double slash, no missing slash", () => {
    const row = makeRow({ image_path: `${UUID_STORE}/${UUID_ITEM}.webp` });
    const result = toPublicMenuItem(row, "https://project-ref.supabase.co");

    // Exactly one slash between the host and the /storage path segment, and
    // exactly one between every path segment — no // anywhere except the
    // unavoidable https:// scheme separator.
    expect(result.imageUrl).not.toMatch(/(?<!:)\/\//);
    expect(result.imageUrl).toMatch(
      new RegExp(`^https://project-ref\\.supabase\\.co/storage/v1/object/public/menu-images/${UUID_STORE}/${UUID_ITEM}\\.webp$`),
    );
  });

  it("a local Supabase URL (127.0.0.1:54321, this repo's dev convention) also concatenates cleanly", () => {
    const row = makeRow({ image_path: `${UUID_STORE}/${UUID_ITEM}.webp` });
    const result = toPublicMenuItem(row, "http://127.0.0.1:54321");

    expect(result.imageUrl).toBe(
      `http://127.0.0.1:54321/storage/v1/object/public/menu-images/${UUID_STORE}/${UUID_ITEM}.webp`,
    );
  });
});

// Round-3 fix (WBS 3.7): public-menu/index.ts's toPublicMenuItem call is
// served through buildMenuImagePublicUrl, a PRIVATE inline copy of
// menuImagePath.ts's menuImagePublicUrl (see public.ts's own header comment
// for why the copy exists — a local `supabase functions serve` CLI bug with
// two-hop-deep relative .ts-extensioned imports, not a design preference).
// Nothing in the type system enforces that the two implementations stay
// identical; round 2 of this fix proved that directly — the inline copy
// dropped its `encodeURI(...)` wrapper and zero existing test failed,
// because every prior test hand-asserted an already-URL-safe hardcoded path
// (a UUID/.webp path never needs escaping) against BOTH implementations
// independently, so neither implementation was ever compared against the
// other. These tests close that gap: same (baseUrl, path) input fed to both
// menuImagePublicUrl directly and to toPublicMenuItem (which routes through
// the private inline copy), byte-for-byte equal output required — including
// a path that actually needs escaping, so a dropped/wrong encodeURI call
// fails here even when every hardcoded-URL assertion above still passes.
describe("toPublicMenuItem's imageUrl vs. menuImagePath.ts's menuImagePublicUrl — parity (drift-risk regression, round 3)", () => {
  const CASES: Array<{ label: string; baseUrl: string; path: string }> = [
    {
      label: "ordinary UUID/.webp path, https project URL",
      baseUrl: "https://project-ref.supabase.co",
      path: `${UUID_STORE}/${UUID_ITEM}.webp`,
    },
    {
      label: "ordinary UUID/.webp path, local http URL",
      baseUrl: "http://127.0.0.1:54321",
      path: `${UUID_STORE}/${UUID_ITEM}.webp`,
    },
    {
      label: "a path containing a space and non-ASCII characters — requires encodeURI to escape it",
      baseUrl: "https://project-ref.supabase.co",
      path: `${UUID_STORE}/menu item café ☕.webp`,
    },
  ];

  for (const { label, baseUrl, path } of CASES) {
    it(`produces byte-identical output for: ${label}`, () => {
      const direct = menuImagePublicUrl(baseUrl, path);

      const row = makeRow({ image_path: path });
      const viaToPublicMenuItem = toPublicMenuItem(row, baseUrl).imageUrl;

      expect(viaToPublicMenuItem).toBe(direct);
      // Escaping actually happened, not just "the two agree on doing
      // nothing" — guards against a future case where both copies drop
      // encodeURI in lockstep and this test would otherwise pass vacuously.
      if (/[ éç☕]/.test(path)) {
        expect(direct).not.toContain(" ");
        expect(direct).toBe(encodeURI(`${baseUrl}/storage/v1/object/public/menu-images/${path}`));
      }
    });
  }
});

describe("toPublicMenuItem — other fields unaffected by the imageUrl fix (regression guard)", () => {
  it("maps every other field field-by-field, unchanged", () => {
    const row = makeRow({
      description: null,
      image_path: null,
      availability: "out_of_stock",
      sort_order: 3,
    });
    const result = toPublicMenuItem(row, "https://project-ref.supabase.co");

    expect(result).toEqual({
      id: UUID_ITEM,
      categoryId: UUID_CATEGORY,
      name: "Latte",
      description: null,
      imageUrl: null,
      priceSatang: 6500,
      availability: "out_of_stock",
      sortOrder: 3,
    });
  });
});
