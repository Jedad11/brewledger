// WBS 3.8 — upload / signed-URL helpers for the private `bills` bucket.
// RL-3: a supplier invoice reveals purchase prices. Never return or log a
// raw public URL for a bills object — only ever a short-lived signed URL,
// and only ever through getBillSignedUrl below.
import type { SupabaseClient } from "@supabase/supabase-js";
import { compressImage } from "./compress";

const BILLS_BUCKET = "bills";
const SIGNED_URL_EXPIRY_SECONDS = 300; // <= 5 minutes, WBS 3.8 acceptance

// {store_id}/{invoice_id}.jpg — the first path segment is what
// (storage.foldername(name))[1] in packages/db/migrations/0022_storage_policies.sql
// checks against auth_store_ids(). Getting this format wrong silently
// breaks every RLS policy on this bucket, not just this helper.
export function billObjectPath(storeId: string, invoiceId: string): string {
  return `${storeId}/${invoiceId}.jpg`;
}

/**
 * Uploads an already-compressed blob. Split out from `uploadBill` below —
 * mirrors `uploadCompressedMenuImage` in `./menuImages.ts` — so a Server
 * Action can call this directly with a blob a client component compressed
 * and handed over via FormData. `client` must be a real `authenticated`
 * Supabase client (the merchant's own session) so 0022_storage_policies.sql's
 * `merchant_insert_bills` policy actually applies — passing the
 * service_role admin client here would silently bypass the RLS check this
 * function exists to go through. This is also why `uploadBill` below can
 * never be called as written from a Server Action: `compressImage` is
 * Canvas/DOM-only and cannot run in Node.
 */
export async function uploadCompressedBill(
  client: SupabaseClient,
  blob: Blob,
  storeId: string,
  invoiceId: string,
): Promise<string> {
  const path = billObjectPath(storeId, invoiceId);

  const { error } = await client.storage.from(BILLS_BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) throw error;

  return path;
}

/**
 * Compresses `file` client-side, uploads it to the merchant's own store
 * folder in the private `bills` bucket, and returns the object path (never
 * a URL — see getBillSignedUrl for that). `client` must be a real
 * `authenticated` Supabase client (the merchant's own session) so
 * 0022_storage_policies.sql's `merchant_insert_bills` policy actually
 * applies — passing the service_role admin client here would silently
 * bypass the RLS check this function exists to go through.
 *
 * Only usable in a context where BOTH the DOM (for `compressImage`) and a
 * session-carrying Supabase client are available in the same place — that
 * is never true in this app (WBS 4.1's session cookie is httpOnly, so a
 * browser-side client always runs as `anon`). Kept for API symmetry with
 * `uploadCompressedMenuImage`'s own `uploadMenuImage`; real call sites
 * (WBS 6.1's expenses/capture) compress in the browser and call
 * `uploadCompressedBill` from a Server Action instead — see that entry's
 * `actions.ts`.
 */
export async function uploadBill(
  client: SupabaseClient,
  file: File,
  storeId: string,
  invoiceId: string,
): Promise<string> {
  const compressed = await compressImage(file);
  return uploadCompressedBill(client, compressed, storeId, invoiceId);
}

/**
 * Returns a signed URL for viewing one bill image, expiring in
 * SIGNED_URL_EXPIRY_SECONDS (<= 300s, WBS 3.8 acceptance). `client` must be
 * the requesting merchant's own `authenticated` client — createSignedUrl
 * still runs through storage's SELECT policy first (`merchant_select_bills`
 * in 0022_storage_policies.sql), so merchant A's client cannot mint a
 * signed URL for a path under merchant B's store folder; Supabase Storage
 * returns "Object not found" rather than a URL.
 */
export async function getBillSignedUrl(client: SupabaseClient, path: string): Promise<string> {
  const { data, error } = await client.storage
    .from(BILLS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRY_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("getBillSignedUrl: no signedUrl returned");

  return data.signedUrl;
}
