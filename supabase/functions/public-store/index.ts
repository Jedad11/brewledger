import { createPublicClient } from "../_shared/public/db.ts";
import { jsonResponse, errorResponse, corsPreflightResponse } from "../_shared/public/response.ts";
import { toPublicStore } from "../../../packages/shared/src/serializers/public.ts";
import { publicStoreSchema, parseOrThrow } from "../../../packages/shared/src/serializers/public.schema.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") return errorResponse(405, "method not allowed");

  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return errorResponse(400, "slug is required");

  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("stores")
    .select("*")
    .eq("slug", slug)
    .single();

  if (error || !data) return errorResponse(404, "store not found");

  const dto = parseOrThrow(publicStoreSchema, toPublicStore(data));
  return jsonResponse(dto);
});
