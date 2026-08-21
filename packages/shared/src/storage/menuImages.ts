// WBS 4.4 — upload / public-URL helpers for the public `menu-images` bucket.
// Mirrors bills.ts's shape exactly, but this bucket is the OPPOSITE
// visibility: menu-images is anon-readable by design (0022_storage_policies.sql
// `anon_select_menu_images`), because a published store's photos are
// customer-facing. Never reuse getBillSignedUrl's signed-URL pattern here —
// there is nothing to keep private.
import type { SupabaseClient } from "@supabase/supabase-js";
import { compressImage } from "./compress";

export const MENU_IMAGES_BUCKET = "menu-images";

// {store_id}/{menu_item_id}.webp — matches 0022_storage_policies.sql's
// (storage.foldername(name))[1] check against auth_store_ids(). A menu item
// gets its id from the DB before a photo can be uploaded (the id names the
// file), so the item row must already exist — see saveMenuItem's two-step
// save in apps/console/src/app/console/(app)/menu/[id]/actions.ts.
export function menuImageObjectPath(storeId: string, menuItemId: string): string {
  return `${storeId}/${menuItemId}.webp`;
}

/**
 * Uploads an already-compressed blob. Split out from `uploadMenuImage` below
 * so a Server Action can call this directly with a blob a client component
 * compressed and handed over via FormData — `client` there is the
 * `@/lib/supabase/server` client, which actually carries the merchant's
 * session (0022_storage_policies.sql's insert policy is `to authenticated`).
 * The browser-side Supabase client can never carry it: WBS 4.1 sets the
 * session cookie `httpOnly`, so `document.cookie` (what the browser client
 * reads) never contains it and every browser-client storage call runs as
 * `anon` — RLS then rejects it, `compressImage` here is DOM-only anyway
 * (canvas), so it cannot run in a Server Action either. The split is what
 * lets compression stay in the browser while the authenticated write
 * happens server-side.
 */
export async function uploadCompressedMenuImage(
  client: SupabaseClient,
  blob: Blob,
  storeId: string,
  menuItemId: string,
): Promise<string> {
  const path = menuImageObjectPath(storeId, menuItemId);

  const { error } = await client.storage.from(MENU_IMAGES_BUCKET).upload(path, blob, {
    contentType: "image/webp",
    upsert: true,
  });
  if (error) throw error;

  return path;
}

/**
 * Compresses `file` client-side to WebP and uploads it to the merchant's own
 * store folder in the public `menu-images` bucket. `client` must be a real
 * `authenticated` Supabase client (the merchant's own session) so
 * `merchant_insert_menu_images` actually applies — a service_role client
 * here would silently bypass the RLS check this function exists to go
 * through.
 */
export async function uploadMenuImage(
  client: SupabaseClient,
  file: File,
  storeId: string,
  menuItemId: string,
): Promise<string> {
  const compressed = await compressImage(file, { mimeType: "image/webp" });
  return uploadCompressedMenuImage(client, compressed, storeId, menuItemId);
}

/**
 * `menu-images` is a public bucket — getPublicUrl needs no session and never
 * makes a network call, so this works with any client (server or browser,
 * authenticated or anon).
 */
export function getMenuImagePublicUrl(client: SupabaseClient, path: string): string {
  return client.storage.from(MENU_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}
