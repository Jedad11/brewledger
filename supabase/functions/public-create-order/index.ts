// WBS 5.4 — thin wrapper around checkout_create_order (packages/db/
// migrations/0029_checkout_order_creation.sql). ALL business logic —
// revalidation, slot reservation, cost snapshot, order code generation, the
// order/order_items/order_item_options inserts — lives inside that one
// `security definer` Postgres function, which is one implicit transaction.
// This file has no second query and no independent revalidation.
import { createServiceRoleClient } from "../_shared/public/db.ts";
import {
  toPublicOrderCreated,
  toCheckoutDiff,
  toPublicSlot,
} from "../../../packages/shared/src/serializers/public.ts";
import {
  publicOrderCreatedSchema,
  checkoutDiffSchema,
  publicSlotSchema,
  parseOrThrow,
} from "../../../packages/shared/src/serializers/public.schema.ts";

// This is a POST endpoint — response.ts's shared CORS_HEADERS hardcodes
// `Access-Control-Allow-Methods: GET, OPTIONS` (every other public-*
// function today is a GET). Local CORS block instead of widening the
// shared helper, same precedent console-auth-request-otp and
// public-reserve-slot (WBS 5.3, since removed) already set for the
// identical reason.
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

interface CreateOrderOption {
  groupId: string;
  optionId: string;
  name: string;
  deltaSatang: number;
}

interface CreateOrderLine {
  menuItemId: string;
  nameSnapshot: string;
  unitPriceSatang: number;
  quantity: number;
  options: CreateOrderOption[];
}

interface CreateOrderRequest {
  storeSlug: string;
  cart: CreateOrderLine[];
  pickupSlotId: string;
  customerName: string;
  customerPhone?: string;
}

function isCreateOrderRequest(body: unknown): body is CreateOrderRequest {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.storeSlug === "string" &&
    Array.isArray(b.cart) &&
    typeof b.pickupSlotId === "string" &&
    typeof b.customerName === "string" &&
    (b.customerPhone === undefined || typeof b.customerPhone === "string")
  );
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

  if (!isCreateOrderRequest(body)) {
    return corsJson({ error: "malformed request body" }, 400);
  }

  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc("checkout_create_order", {
    p_store_slug: body.storeSlug,
    p_cart_lines: body.cart.map((line) => ({
      menuItemId: line.menuItemId,
      nameSnapshot: line.nameSnapshot,
      unitPriceSatang: line.unitPriceSatang,
      quantity: line.quantity,
      options: line.options.map((option) => ({
        groupId: option.groupId,
        optionId: option.optionId,
        name: option.name,
        deltaSatang: option.deltaSatang,
      })),
    })),
    p_pickup_slot_id: body.pickupSlotId,
    p_customer_name: body.customerName,
    p_customer_phone: body.customerPhone ?? null,
  });

  if (error) {
    // Never leak error.message from supabase.rpc() into the response body —
    // same posture as parseOrThrow's deliberate detail-swallowing.
    console.error("checkout_create_order RPC error", error);
    return corsJson({ error: "order creation failed" }, 500);
  }

  if (data.ok === false) {
    if (data.code === "PRICE_MISMATCH") {
      const diffs = (data.diffs ?? []).map((row: unknown) =>
        parseOrThrow(checkoutDiffSchema, toCheckoutDiff(row as Parameters<typeof toCheckoutDiff>[0])),
      );
      return corsJson({ code: "PRICE_MISMATCH", diffs }, 409);
    }
    if (data.code === "SLOT_FULL") {
      const slots = (data.slots ?? []).map((row: unknown) =>
        parseOrThrow(publicSlotSchema, toPublicSlot(row as Parameters<typeof toPublicSlot>[0])),
      );
      return corsJson({ code: "SLOT_FULL", slots }, 410);
    }
    if (data.code === "STORE_NOT_FOUND") {
      return corsJson({ code: "STORE_NOT_FOUND" }, 404);
    }
    // VALIDATION_ERROR and anything else -- the RPC's own `message` is a
    // developer-facing string (never rendered to the customer, see
    // apps/shop/src/components/SlotPicker.tsx), not a place cost/margin
    // data could ever appear, so it is safe to forward as-is.
    return corsJson({ code: "VALIDATION_ERROR", message: data.message }, 400);
  }

  const dto = parseOrThrow(publicOrderCreatedSchema, toPublicOrderCreated(data.order));
  return corsJson(dto, 201);
});
