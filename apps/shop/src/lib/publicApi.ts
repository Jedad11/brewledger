// WBS 5.1 — SSR data access for the public store page. Calls the WBS 3.7
// public-* Edge Functions over HTTP rather than querying Postgres directly.
// Those functions already apply the WBS 3.6 RLS policies and the WBS 3.7
// allow-list serializers (toPublicStore / toPublicMenuItem / ...), including
// the one documented service_role read (menu_categories carries zero anon
// RLS policy — docs/api/surfaces_design.md §1). Re-querying those tables
// directly from here would either miss categories entirely or require a
// service_role key in this app, which RL-3 forbids outright (see
// apps/shop/.env.example, eslint.config.mjs's packages/db and
// supabase/admin.ts zones). docs/api/surfaces_design.md §1's own routing
// table names these exact endpoints for these exact screens: "public-store |
// store header (/s/[slug])", "public-menu | menu page", "public-slots |
// slot picker at checkout".
//
// The DTO shapes below mirror packages/shared/src/serializers/public.ts
// field for field, authored independently rather than imported — that
// module's toPublicX functions type their parameters against
// Database["public"]["Tables"][...]["Row"] (packages/db), and apps/shop must
// never resolve packages/db (eslint.config.mjs's apps/shop zone bans it
// outright). Authoring these types locally keeps that boundary real instead
// of relying on skipLibCheck to paper over it. A mismatch against public.ts
// is a signal to fix here, not something to unify away — same posture
// packages/shared/src/serializers/public.schema.ts already takes.
//
// WBS 5.4's CreateOrderResult below has a type-only import from
// ./cartValidation (CartDiffReason) — cartValidation.ts already imports a
// type from this file, so this is a type-only circular reference. TypeScript
// erases `import type` entirely at compile time, so there is no runtime
// circularity; it exists purely so the 409 diff shape this file returns is
// provably the same type the cart page's existing diff UI already renders,
// not a hand-duplicated lookalike that could drift.
import type { CartDiffReason } from "./cartValidation";

export interface PublicStore {
  id: string;
  slug: string;
  name: string;
  pickupAddress: string | null;
  timezone: string;
  opensAt: string | null;
  closesAt: string | null;
  promptpayId: string | null;
}

export interface PublicMenuCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export interface PublicMenuItem {
  id: string;
  categoryId: string | null;
  name: string;
  description: string | null;
  imageUrl: string | null;
  priceSatang: number;
  availability: "available" | "out_of_stock" | "hidden";
  sortOrder: number;
}

export interface PublicOptionGroup {
  id: string;
  menuItemId: string;
  name: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
}

export interface PublicOption {
  id: string;
  optionGroupId: string;
  name: string;
  priceDeltaSatang: number;
  sortOrder: number;
}

export interface PublicSlot {
  id: string;
  slotStart: string;
  slotEnd: string;
  remaining: number;
}

export interface PublicMenuResponse {
  categories: PublicMenuCategory[];
  items: PublicMenuItem[];
  optionGroups: PublicOptionGroup[];
  options: PublicOption[];
}

export type PublicFetchResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "not_found" }
  | { kind: "error" };

async function callPublicFunction<T>(
  fn: string,
  params: Record<string, string>,
): Promise<PublicFetchResult<T>> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return { kind: "error" };

  const url = new URL(`${supabaseUrl}/functions/v1/${fn}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  try {
    const res = await fetch(url, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      // Store status, menu availability and slot capacity all change
      // frequently and must never be served stale from Next's fetch cache —
      // freshness here is the entire point of the WBS 5.1 Realtime/state
      // requirements.
      cache: "no-store",
    });

    if (res.status === 404) return { kind: "not_found" };
    if (!res.ok) return { kind: "error" };

    return { kind: "ok", data: (await res.json()) as T };
  } catch {
    return { kind: "error" };
  }
}

export function fetchPublicStore(slug: string): Promise<PublicFetchResult<PublicStore>> {
  return callPublicFunction<PublicStore>("public-store", { slug });
}

export function fetchPublicMenu(slug: string): Promise<PublicFetchResult<PublicMenuResponse>> {
  return callPublicFunction<PublicMenuResponse>("public-menu", { slug });
}

export function fetchPublicSlots(slug: string): Promise<PublicFetchResult<PublicSlot[]>> {
  return callPublicFunction<PublicSlot[]>("public-slots", { slug });
}

// WBS 5.4 — public-create-order. Mirrors packages/shared/src/serializers/
// public.ts's PublicOrderCreated/CheckoutDiff field for field, authored
// independently rather than imported, same posture as every DTO above (that
// module's builders type against packages/db's Database row types, which
// apps/shop must never resolve).
export interface PublicOrderCreatedOption {
  name: string;
  priceDeltaSatang: number;
}

export interface PublicOrderCreatedItem {
  name: string;
  quantity: number;
  unitPriceSatang: number;
  options: PublicOrderCreatedOption[];
}

export interface PublicOrderCreated {
  orderCode: string;
  totalSatang: number;
  pickupAt: string;
  expiresAt: string;
  items: PublicOrderCreatedItem[];
}

export interface CreateOrderOptionInput {
  groupId: string;
  optionId: string;
  name: string;
  deltaSatang: number;
}

export interface CreateOrderLineInput {
  menuItemId: string;
  nameSnapshot: string;
  unitPriceSatang: number;
  quantity: number;
  options: CreateOrderOptionInput[];
}

export interface CreateOrderRequest {
  storeSlug: string;
  cart: CreateOrderLineInput[];
  pickupSlotId: string;
  customerName: string;
  customerPhone?: string;
}

export type CreateOrderResult =
  | { kind: "created"; data: PublicOrderCreated }
  // Same CartDiffReason the cart page's existing diff UI already renders —
  // see the type-only circular import note at the top of this file.
  | { kind: "price_mismatch"; diffs: CartDiffReason[] }
  | { kind: "slot_full"; slots: PublicSlot[] }
  | { kind: "not_found" }
  | { kind: "error" };

export async function createOrder(request: CreateOrderRequest): Promise<CreateOrderResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return { kind: "error" };

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/public-create-order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify(request),
    });

    if (res.status === 201) return { kind: "created", data: (await res.json()) as PublicOrderCreated };
    if (res.status === 409) {
      const body = (await res.json()) as { diffs: CartDiffReason[] };
      return { kind: "price_mismatch", diffs: body.diffs };
    }
    if (res.status === 410) {
      const body = (await res.json()) as { slots: PublicSlot[] };
      return { kind: "slot_full", slots: body.slots };
    }
    if (res.status === 404) return { kind: "not_found" };
    return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

// WBS 5.5 — public-create-charge / public-order-status. Mirrors
// packages/shared/src/serializers/public.ts's PublicPaymentIntent field
// for field, same "authored independently, not imported" posture every
// other DTO in this file already takes (packages/db must never resolve
// from apps/shop).
export interface PublicPaymentIntent {
  qrPayload: string;
  amountSatang: number;
  expiresAt: string;
  orderCode: string;
}

export type CreateChargeResult =
  | { kind: "ok"; data: PublicPaymentIntent }
  | { kind: "not_found" }
  | { kind: "not_payable" }
  | { kind: "store_not_verified" }
  | { kind: "error" };

export async function createCharge(orderCode: string): Promise<CreateChargeResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return { kind: "error" };

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/public-create-charge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ orderCode }),
    });

    if (res.status === 201) return { kind: "ok", data: (await res.json()) as PublicPaymentIntent };
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 409) {
      const body = (await res.json()) as { code?: string };
      return body.code === "STORE_NOT_VERIFIED" ? { kind: "store_not_verified" } : { kind: "not_payable" };
    }
    return { kind: "error" };
  } catch {
    return { kind: "error" };
  }
}

// public-order-status returns an array with one row per order item, all
// sharing the same orderCode/status/pickupAt -- callers read row[0] for
// the order-level fields. Mirrors PublicOrderStatus (public.ts) field for
// field, same independently-authored posture as every DTO above.
export interface PublicOrderStatusRow {
  orderCode: string;
  status: string;
  pickupAt: string | null;
  itemName: string;
  quantity: number;
  cancelReason: string | null;
  // 'pending' | 'done' | null. null = no refund owed -- THE gating field
  // for any refund-timeframe copy. Never derive this from cancelReason's
  // presence; see docs/db/wbs_5_11_refund_design.md §4.
  refundStatus: "pending" | "done" | null;
}

export function fetchOrderStatus(code: string): Promise<PublicFetchResult<PublicOrderStatusRow[]>> {
  return callPublicFunction<PublicOrderStatusRow[]>("public-order-status", { code });
}

// WBS 5.10 — public-order-status's phone+code branch (`/track`). Distinct
// function, not an optional third param bolted onto fetchOrderStatus above:
// this call is rate-limited server-side (packages/db/migrations/
// 0036_order_lookup_rate_limit.sql) and can 429, a response shape
// fetchOrderStatus's callers (the /o/{code} poll loop) never need to handle.
export type OrderLookupResult =
  | { kind: "ok"; data: PublicOrderStatusRow[] }
  | { kind: "rate_limited" }
  | { kind: "error" };

export async function fetchOrderLookup(phone: string, code: string): Promise<OrderLookupResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return { kind: "error" };

  const url = new URL(`${supabaseUrl}/functions/v1/public-order-status`);
  url.searchParams.set("code", code);
  url.searchParams.set("phone", phone);

  try {
    const res = await fetch(url, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      cache: "no-store",
    });
    if (res.status === 429) return { kind: "rate_limited" };
    if (!res.ok) return { kind: "error" };
    return { kind: "ok", data: (await res.json()) as PublicOrderStatusRow[] };
  } catch {
    return { kind: "error" };
  }
}
