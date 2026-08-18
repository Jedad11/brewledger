// WBS 3.8 — total bytes per Storage bucket, feeding the WBS 3.10 quota
// monitor (not wired up here — this file only builds the reporting
// function, per the WBS 3.8 Claude Code prompt).
//
// This is an ops-level aggregate across ALL stores in a bucket, not a
// merchant-scoped figure, so it deliberately requires the service_role
// admin client (see packages/shared/src/supabase/admin.ts) rather than an
// authenticated merchant client, which RLS would correctly restrict to that
// merchant's own objects. Callers are the Render worker (WBS 3.10), never a
// browser — the admin.ts module guard already throws if this were ever
// reached from one.
import type { SupabaseClient } from "@supabase/supabase-js";

export const STORAGE_BUCKETS = ["bills", "menu-images"] as const;
export type StorageBucketName = (typeof STORAGE_BUCKETS)[number];

export interface BucketUsage {
  bucket: string;
  objectCount: number;
  totalBytes: number;
}

interface StorageObjectMetadataRow {
  metadata: { size?: number | string } | null;
}

/**
 * Sums `storage.objects.metadata->size` for every object in `bucket`.
 * Supabase Storage stores each object's size as the `size` key of that
 * jsonb column (populated by the storage API itself on upload) — there is
 * no separate bytes-used counter to query instead.
 */
export async function getBucketUsage(admin: SupabaseClient, bucket: string): Promise<BucketUsage> {
  const { data, error } = await admin
    .schema("storage")
    .from("objects")
    .select("metadata")
    .eq("bucket_id", bucket)
    .returns<StorageObjectMetadataRow[]>();
  if (error) throw error;

  const rows = data ?? [];
  const totalBytes = rows.reduce((sum, row) => {
    const size = row.metadata?.size;
    const bytes = typeof size === "number" ? size : Number(size ?? 0);
    return sum + (Number.isFinite(bytes) ? bytes : 0);
  }, 0);

  return { bucket, objectCount: rows.length, totalBytes };
}

export async function getAllBucketUsage(
  admin: SupabaseClient,
  buckets: readonly string[] = STORAGE_BUCKETS,
): Promise<BucketUsage[]> {
  return Promise.all(buckets.map((bucket) => getBucketUsage(admin, bucket)));
}
