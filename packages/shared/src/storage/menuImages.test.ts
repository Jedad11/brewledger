// WBS 3.7 / 4.4 — direct unit coverage for menuImagePublicUrl, the new
// pure helper added to fix toPublicMenuItem's imageUrl bug (it was passing
// the raw Storage object path straight through instead of a fetchable URL).
// menuImagePublicUrl's own header comment claims it produces the exact same
// URL storage-js's SupabaseClient.storage.from(bucket).getPublicUrl(path)
// builds internally, just without needing a client instance. This suite
// proves that claim by comparing menuImagePublicUrl's output against a real
// createClient(...).storage.from(...).getPublicUrl(...) call (via this
// file's own getMenuImagePublicUrl wrapper) for the same inputs, so the two
// can never silently drift apart.
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { getMenuImagePublicUrl, menuImagePublicUrl, MENU_IMAGES_BUCKET } from "./menuImages";

const UUID_STORE = "55555555-5555-4555-8555-555555555555";
const UUID_ITEM = "33333333-3333-4333-8333-333333333333";

describe("menuImagePublicUrl", () => {
  it("builds the exact expected object-storage public URL shape", () => {
    const path = `${UUID_STORE}/${UUID_ITEM}.webp`;
    const result = menuImagePublicUrl("https://project-ref.supabase.co", path);

    expect(result).toBe(
      `https://project-ref.supabase.co/storage/v1/object/public/${MENU_IMAGES_BUCKET}/${path}`,
    );
  });

  it("no trailing slash on supabaseUrl (this repo's SUPABASE_URL convention) — no double slash introduced", () => {
    const path = `${UUID_STORE}/${UUID_ITEM}.webp`;
    const result = menuImagePublicUrl("http://127.0.0.1:54321", path);

    expect(result).toBe(`http://127.0.0.1:54321/storage/v1/object/public/${MENU_IMAGES_BUCKET}/${path}`);
    expect(result).not.toContain("//storage"); // would indicate an accidental double slash
  });

  it("matches getMenuImagePublicUrl's (storage-js getPublicUrl) output for the same inputs, for a local Supabase URL", () => {
    const path = `${UUID_STORE}/${UUID_ITEM}.webp`;
    const supabaseUrl = "http://127.0.0.1:54321";
    const client = createClient(supabaseUrl, "anon-key-placeholder");

    const viaClient = getMenuImagePublicUrl(client, path);
    const viaPlainFunction = menuImagePublicUrl(supabaseUrl, path);

    expect(viaPlainFunction).toBe(viaClient);
  });

  it("matches getMenuImagePublicUrl's output for a real *.supabase.co project URL, proving the two never drift", () => {
    const path = `${UUID_STORE}/${UUID_ITEM}.webp`;
    const supabaseUrl = "https://project-ref.supabase.co";
    const client = createClient(supabaseUrl, "anon-key-placeholder");

    const viaClient = getMenuImagePublicUrl(client, path);
    const viaPlainFunction = menuImagePublicUrl(supabaseUrl, path);

    expect(viaPlainFunction).toBe(viaClient);
  });

  it("encodes a path segment that needs escaping (defensive — object names are not guaranteed ASCII-safe)", () => {
    // menu_item ids are UUIDs in practice, but the helper is a general string
    // joiner (encodeURI wraps the whole template), so prove it doesn't
    // silently produce an unfetchable URL if a path ever contains a space.
    const path = "some store/some item.webp";
    const result = menuImagePublicUrl("https://project-ref.supabase.co", path);

    expect(result).toBe(
      `https://project-ref.supabase.co/storage/v1/object/public/${MENU_IMAGES_BUCKET}/${encodeURI(path)}`,
    );
    expect(result).not.toContain(" ");
  });
});
