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
