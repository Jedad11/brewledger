// WBS 5.5 — issues (and reissues) the PromptPay QR for an order already
// created by public-create-order (WBS 5.4). Same endpoint serves both the
// initial issuance on landing at /s/{slug}/pay/{code} and every "ขอ QR
// ใหม่" reissue — there is no separate reissue route, see this entry's
// architect spec §4. It succeeds for as long as orders.status is still
// PENDING_PAYMENT and fails 409 ORDER_NOT_PAYABLE once it isn't.
//
// The payload is built HERE in TS (buildPromptPayPayload), never in SQL —
// create_payment_charge (packages/db/migrations/0030_promptpay_charge.sql)
// only persists the string it's given. RL-1: the payee is always the
// order's own store's promptpay_id, resolved fresh from the DB on every
// call, never a value passed in by the client.
import { createServiceRoleClient } from "../_shared/public/db.ts";
import { buildPromptPayPayload } from "../../../packages/shared/src/promptpay/generate.ts";
import { toPublicPaymentIntent } from "../../../packages/shared/src/serializers/public.ts";
import { publicPaymentIntentSchema, parseOrThrow } from "../../../packages/shared/src/serializers/public.schema.ts";

// POST-only, own local CORS block — same precedent public-create-order set
// (response.ts's shared CORS_HEADERS hardcodes GET, OPTIONS for the GET-only
// public-* functions).
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

interface CreateChargeRequest {
  orderCode: string;
}

function isCreateChargeRequest(body: unknown): body is CreateChargeRequest {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return typeof b.orderCode === "string" && b.orderCode.length > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return corsJson({ error: "method not allowed" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return corsJson({ error: "invalid JSON body" }, 400);
  }

  if (!isCreateChargeRequest(body)) {
    return corsJson({ error: "malformed request body" }, 400);
  }

  const supabase = createServiceRoleClient();

  const { data: row, error: readError } = await supabase
    .from("orders")
    .select("id, status, total_satang, store:stores(promptpay_id, promptpay_type, promptpay_verified_at)")
    .eq("order_code", body.orderCode)
    .maybeSingle();

  if (readError) {
    console.error("public-create-charge: order lookup failed", readError);
    return corsJson({ error: "lookup failed" }, 500);
  }
  if (!row) {
    return corsJson({ code: "ORDER_NOT_FOUND" }, 404);
  }
  if (row.status !== "PENDING_PAYMENT") {
    return corsJson({ code: "ORDER_NOT_PAYABLE" }, 409);
  }

  // Supabase's nested-select typing returns store as an array here even
  // though the FK makes it one-to-one — narrow explicitly rather than
  // trusting an `as` cast on the whole row.
  const store = Array.isArray(row.store) ? row.store[0] : row.store;
  if (!store || store.promptpay_id == null || store.promptpay_verified_at == null) {
    return corsJson({ code: "STORE_NOT_VERIFIED" }, 409);
  }

  let payload: string;
  try {
    payload = buildPromptPayPayload({
      promptpayId: store.promptpay_id,
      promptpayType: store.promptpay_type,
      amountSatang: row.total_satang,
    });
  } catch (err) {
    console.error("public-create-charge: payload build failed", err);
    return corsJson({ error: "payload generation failed" }, 500);
  }

  // create_payment_charge returns a `table (...)` -- supabase-js hands back
  // an array, same shape reserve_pickup_slot's callers already key off (see
  // 0028/0029's own comments: "zero rows back means did not apply"). Zero
  // rows here is the race where orders.status flipped away from
  // PENDING_PAYMENT between the read above and this insert -- same 409 as
  // the pre-check, no extra re-query.
  const { data: chargeRows, error: rpcError } = await supabase.rpc("create_payment_charge", {
    p_order_code: body.orderCode,
    p_qr_payload: payload,
  });

  if (rpcError) {
    console.error("public-create-charge: create_payment_charge RPC error", rpcError);
    return corsJson({ error: "charge creation failed" }, 500);
  }
  const charge = chargeRows?.[0];
  if (!charge) {
    return corsJson({ code: "ORDER_NOT_PAYABLE" }, 409);
  }

  const dto = parseOrThrow(
    publicPaymentIntentSchema,
    toPublicPaymentIntent({
      qrPayload: payload,
      amountSatang: row.total_satang,
      expiresAt: charge.expires_at,
      orderCode: body.orderCode,
    }),
  );
  return corsJson(dto, 201);
});
