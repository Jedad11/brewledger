// WBS 4.4 — upload / public-URL helpers for the public `menu-images` bucket.
// Mirrors bills.ts's shape exactly, but this bucket is the OPPOSITE
// visibility: menu-images is anon-readable by design (0022_storage_policies.sql
// `anon_select_menu_images`), because a published store's photos are
// customer-facing. Never reuse getBillSignedUrl's signed-URL pattern here —
// there is nothing to keep private.
import type { SupabaseClient } from "@supabase/supabase-js";
import { compressImage } from "./compress";

const MENU_IMAGES_BUCKET = "menu-images";

// {store_id}/{menu_item_id}.webp — matches 0022_storage_policies.sql's
// (storage.foldername(name))[1] check against auth_store_ids(). A menu item
// gets its id from the DB before a photo can be uploaded (the id names the
// file), so the item row must already exist — see saveMenuItem's two-step
// save in apps/console/src/app/console/(app)/menu/[id]/actions.ts.
export function menuImageObjectPath(storeId: string, menuItemId: string): string {
  return `${storeId}/${menuItemId}.webp`;
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
  const path = menuImageObjectPath(storeId, menuItemId);

  const { error } = await client.storage.from(MENU_IMAGES_BUCKET).upload(path, compressed, {
    contentType: "image/webp",
    upsert: true,
  });
  if (error) throw error;

  return path;
}

/**
 * `menu-images` is a public bucket — getPublicUrl needs no session and never
 * makes a network call, so this works with any client (server or browser,
 * authenticated or anon).
 */
export function getMenuImagePublicUrl(client: SupabaseClient, path: string): string {
  return client.storage.from(MENU_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;
}
