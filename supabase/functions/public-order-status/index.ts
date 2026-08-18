import { createPublicClient } from "../_shared/public/db.ts";
import { jsonResponse, errorResponse, corsPreflightResponse } from "../_shared/public/response.ts";
import { toPublicOrderStatus } from "../../../packages/shared/src/serializers/public.ts";
import { publicOrderStatusSchema, parseOrThrow } from "../../../packages/shared/src/serializers/public.schema.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreflightResponse();
  if (req.method !== "GET") return errorResponse(405, "method not allowed");

  const params = new URL(req.url).searchParams;
  const code = params.get("code");
  const phone = params.get("phone");
  if (!code) return errorResponse(400, "code is required");

  const supabase = createPublicClient();

  const { data, error } = phone
    ? await supabase.rpc("public_order_lookup", { p_phone: phone, p_order_code: code })
    : await supabase.rpc("public_order_status", { p_order_code: code });

  if (error) return errorResponse(500, "lookup failed");

  const dtos = (data ?? []).map((row: unknown) =>
    parseOrThrow(publicOrderStatusSchema, toPublicOrderStatus(row as Parameters<typeof toPublicOrderStatus>[0]))
  );
  return jsonResponse(dtos);
});
