// WBS 3.7 / 4.4 — pure, dependency-free menu-image path/URL helpers, split
// out of menuImages.ts so this module's import graph stays Deno-safe.
// menuImages.ts also pulls in compressImage (./compress.ts, browser
// canvas/DOM only — Image/document/URL.createObjectURL) for its upload
// flow, and this module is imported directly by
// packages/shared/src/serializers/public.ts, which every
// supabase/functions/public-* Edge Function (Deno) resolves through. A
// Deno-reachable module must never pull DOM-only code into its graph, and
// every relative specifier a Deno module reaches through needs its literal
// .ts extension — Deno's ESM resolver does not infer it the way Node/
// webpack/vitest do. See packages/shared/src/promptpay/generate.ts's import
// of "./normalize.ts" for the established precedent this module follows.
export const MENU_IMAGES_BUCKET = "menu-images";

// {store_id}/{menu_item_id}.webp — matches 0022_storage_policies.sql's
// (storage.foldername(name))[1] check against auth_store_ids().
export function menuImageObjectPath(storeId: string, menuItemId: string): string {
  return `${storeId}/${menuItemId}.webp`;
}

/**
 * Same URL a `SupabaseClient`'s `storage.from(MENU_IMAGES_BUCKET).getPublicUrl(path)`
 * would build (storage-js just string-templates `${url}/storage/v1/object/public/${bucket}/${path}`,
 * no request), but as a plain function of the project URL. Needed wherever
 * there's no live client instance in scope — packages/shared/src/
 * serializers/public.ts's toPublicMenuItem (Deno Edge Function, has
 * SUPABASE_URL but builds a client-free DTO) and apps/shop/src/lib/menu.ts's
 * realtime row mapper (deliberately dependency-free per that file's own
 * header comment, so qa_engineer can unit test it without constructing a
 * browser Supabase client).
 */
export function menuImagePublicUrl(supabaseUrl: string, path: string): string {
  return encodeURI(`${supabaseUrl}/storage/v1/object/public/${MENU_IMAGES_BUCKET}/${path}`);
}
