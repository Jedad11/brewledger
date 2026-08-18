import { createPublicClient } from "../_shared/public/db.ts";
import { jsonResponse, errorResponse, corsPreflightResponse } from "../_shared/public/response.ts";
import { toPublicSlot } from "../../../packages/shared/src/serializers/public.ts";
import { publicSlotSchema, parseOrThrow } from "../../../packages/shared/src/serializers/public.schema.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") return errorResponse(405, "method not allowed");

  const slug = new URL(req.url).searchParams.get("slug");
  if (!slug) return errorResponse(400, "slug is required");

  const supabase = createPublicClient();

  const { data: store, error: storeErr } = await supabase
    .from("stores")
    .select("id")
    .eq("slug", slug)
    .single();
  if (storeErr || !store) return errorResponse(404, "store not found");

  const { data: slots, error: slotsErr } = await supabase
    .from("pickup_slots")
    .select("*")
    .eq("store_id", store.id)
    .order("slot_start", { ascending: true });
  if (slotsErr) return errorResponse(500, "failed to load slots");

  const dtos = (slots ?? []).map((row) => parseOrThrow(publicSlotSchema, toPublicSlot(row)));
  return jsonResponse(dtos);
});
