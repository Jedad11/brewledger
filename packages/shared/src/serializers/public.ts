// RL-3. Every field emitted to Customer Web is listed here by hand. If you
// are about to add a spread operator to this file, stop and read WBS 3.7.

import type { Database } from "@brewledger/db/types";

type StoreRow = Database["public"]["Tables"]["stores"]["Row"];
type MenuCategoryRow = Database["public"]["Tables"]["menu_categories"]["Row"];
type MenuItemRow = Database["public"]["Tables"]["menu_items"]["Row"];
type OptionGroupRow = Database["public"]["Tables"]["menu_option_groups"]["Row"];
type OptionRow = Database["public"]["Tables"]["menu_options"]["Row"];
type SlotRow = Database["public"]["Tables"]["pickup_slots"]["Row"];

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

export function toPublicStore(row: StoreRow): PublicStore {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    pickupAddress: row.pickup_address,
    timezone: row.timezone,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    promptpayId: row.promptpay_id,
  };
}

export interface PublicMenuCategory {
  id: string;
  name: string;
  sortOrder: number;
}

export function toPublicMenuCategory(row: MenuCategoryRow): PublicMenuCategory {
  return { id: row.id, name: row.name, sortOrder: row.sort_order };
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

// Deliberately NOT imported from ../storage/menuImagePath.ts, even though
// that file holds the canonical implementation menuImages.ts and
// apps/shop/src/lib/menu.ts both use. This file is resolved directly (by
// relative path, never through this package's dist output) by every
// supabase/functions/public-* Edge Function, and toPublicMenuItem needs the
// real function at Deno runtime, not just its type — so any import of it
// here would need the literal .ts extension Deno's resolver requires for a
// local relative specifier. That's fine for a first-level import (every
// public-* Edge Function already does exactly this to reach THIS file), but
// a second-level one — this file, itself Deno-resolved, reaching a THIRD
// file via its own .ts-suffixed relative import — reproducibly crashes this
// repo's local `supabase functions serve` CLI's own preflight dependency
// scan before it serves a single request (confirmed by bisection: identical
// logic through an extensionless import boots and serves fine; the same
// import with .ts added, even with every other file held constant, crashes
// "Setting up Edge Functions runtime" with an unrelated garbled path —
// `packages/shared/src/storage/normalize.ts`, a file that doesn't exist).
// That's a local-CLI tooling defect, not a Deno spec issue, but it blocks
// exactly the live boot-reachability check this fix must pass. Inlining
// this one-line pure function avoids the import chain that trips it. Kept
// in lockstep with menuImagePath.ts's menuImagePublicUrl by public.test.ts's
// own hardcoded-URL assertions below (any drift fails there directly) —
// change one, check the other.
function buildMenuImagePublicUrl(supabaseUrl: string, path: string): string {
  return encodeURI(`${supabaseUrl}/storage/v1/object/public/menu-images/${path}`);
}

// `supabaseUrl` must be a URL a BROWSER can reach (menu-images is a public
// bucket — WBS 3.8, supabase/config.toml, 0022_storage_policies.sql's
// `anon_select_menu_images` — so no session/signing is needed, just the
// project URL). Deliberately NOT necessarily the literal SUPABASE_URL env
// var: that reserved name is auto-injected by the Supabase CLI/platform and,
// under local `supabase functions serve`, resolves to the edge-runtime
// container's internal Docker view of Kong (http://kong:8000) — unreachable
// from a browser. Callers pass their own browser-reachable value instead
// (public-menu/index.ts reads PROJECT_PUBLIC_URL, deliberately not
// SUPABASE_-prefixed — the CLI silently drops any .env entry with that
// prefix; see supabase/functions/.env.example). image_path is a storage object path
// ({store_id}/{menu_item_id}.webp, packages/shared/src/storage/menuImagePath.ts's
// menuImageObjectPath), never a fetchable URL on its own — a browser <img>
// or next/image src needs the full public object URL.
export function toPublicMenuItem(row: MenuItemRow, supabaseUrl: string): PublicMenuItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_path ? buildMenuImagePublicUrl(supabaseUrl, row.image_path) : null,
    priceSatang: row.price_satang,
    availability: row.availability as PublicMenuItem["availability"],
    sortOrder: row.sort_order,
  };
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

export function toPublicOptionGroup(row: OptionGroupRow): PublicOptionGroup {
  return {
    id: row.id,
    menuItemId: row.menu_item_id,
    name: row.name,
    isRequired: row.is_required,
    minSelect: row.min_select,
    maxSelect: row.max_select,
    sortOrder: row.sort_order,
  };
}

export interface PublicOption {
  id: string;
  optionGroupId: string;
  name: string;
  priceDeltaSatang: number;
  sortOrder: number;
}

export function toPublicOption(row: OptionRow): PublicOption {
  return {
    id: row.id,
    optionGroupId: row.option_group_id,
    name: row.name,
    priceDeltaSatang: row.price_delta_satang,
    sortOrder: row.sort_order,
  };
}

export interface PublicSlot {
  id: string;
  slotStart: string;
  slotEnd: string;
  remaining: number;
}

export function toPublicSlot(row: SlotRow): PublicSlot {
  return {
    id: row.id,
    slotStart: row.slot_start,
    slotEnd: row.slot_end,
    remaining: row.capacity - row.booked_count,
  };
}

export interface PublicOrderStatus {
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

// The RPC's own column list IS the allow-list; this function only renames
// snake_case RPC output to camelCase for the client, field by field, same
// discipline as every other builder in this file.
export function toPublicOrderStatus(row: {
  order_code: string;
  status: string;
  pickup_at: string | null;
  item_name: string;
  quantity: number;
  cancel_reason: string | null;
  refund_status: string | null;
}): PublicOrderStatus {
  return {
    orderCode: row.order_code,
    status: row.status,
    pickupAt: row.pickup_at,
    itemName: row.item_name,
    quantity: row.quantity,
    cancelReason: row.cancel_reason,
    refundStatus: row.refund_status as PublicOrderStatus["refundStatus"],
  };
}

// WBS 5.4 — checkout_create_order's own jsonb outputs. Both map an already
// hand-shaped jsonb object built inside the RPC itself (not a raw DB row),
// same posture as toPublicOrderStatus above — the RPC's own field list IS
// the allow-list, this only renames snake_case to camelCase.

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

// NO cost field anywhere in this type — this is the one place in the whole
// checkout feature where an accidental unit_cost_snapshot_satang leaking
// into checkout_create_order's own jsonb_build_object(...) would violate
// RL-3 directly. This function only ever reads the five named keys below;
// the .strict() schema in public.schema.ts is the runtime backstop.
export function toPublicOrderCreated(row: {
  order_code: string;
  total_satang: number;
  pickup_at: string;
  expires_at: string;
  items: Array<{
    name: string;
    quantity: number;
    unit_price_satang: number;
    options: Array<{ name: string; price_delta_satang: number }>;
  }>;
}): PublicOrderCreated {
  return {
    orderCode: row.order_code,
    totalSatang: row.total_satang,
    pickupAt: row.pickup_at,
    expiresAt: row.expires_at,
    items: row.items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unitPriceSatang: item.unit_price_satang,
      options: item.options.map((option) => ({
        name: option.name,
        priceDeltaSatang: option.price_delta_satang,
      })),
    })),
  };
}

// CheckoutDiff — field-for-field parallel to apps/shop/src/lib/
// cartValidation.ts's CartDiffReason `kind` union, so the existing
// cart-page diff-rendering UI can render a checkout-time 409 unchanged.
// checkout_create_order already builds each diff object with these exact
// camelCase keys (unlike the rest of its response, which is snake_case,
// matching every other RPC in this codebase) specifically so this function
// stays a narrow allow-list/validation pass — read only the named keys,
// discard anything else, hand the result to .strict() — rather than a
// second case-conversion layer.
export type CheckoutDiff =
  | { lineIndex: number; kind: "item_removed"; menuItemId: string; nameSnapshot: string }
  | { lineIndex: number; kind: "item_unavailable"; menuItemId: string; nameSnapshot: string }
  | {
      lineIndex: number;
      kind: "price_changed";
      menuItemId: string;
      nameSnapshot: string;
      oldSatang: number;
      newSatang: number;
    }
  | {
      lineIndex: number;
      kind: "option_removed";
      menuItemId: string;
      groupId: string;
      optionId: string;
      name: string;
    }
  | {
      lineIndex: number;
      kind: "option_price_changed";
      menuItemId: string;
      groupId: string;
      optionId: string;
      name: string;
      oldSatang: number;
      newSatang: number;
    };

export function toCheckoutDiff(row: {
  lineIndex: number;
  kind: string;
  menuItemId?: string;
  nameSnapshot?: string;
  groupId?: string;
  optionId?: string;
  name?: string;
  oldSatang?: number;
  newSatang?: number;
}): CheckoutDiff {
  switch (row.kind) {
    case "item_removed":
    case "item_unavailable":
      return {
        lineIndex: row.lineIndex,
        kind: row.kind,
        menuItemId: row.menuItemId!,
        nameSnapshot: row.nameSnapshot!,
      };
    case "price_changed":
      return {
        lineIndex: row.lineIndex,
        kind: "price_changed",
        menuItemId: row.menuItemId!,
        nameSnapshot: row.nameSnapshot!,
        oldSatang: row.oldSatang!,
        newSatang: row.newSatang!,
      };
    case "option_removed":
      return {
        lineIndex: row.lineIndex,
        kind: "option_removed",
        menuItemId: row.menuItemId!,
        groupId: row.groupId!,
        optionId: row.optionId!,
        name: row.name!,
      };
    case "option_price_changed":
      return {
        lineIndex: row.lineIndex,
        kind: "option_price_changed",
        menuItemId: row.menuItemId!,
        groupId: row.groupId!,
        optionId: row.optionId!,
        name: row.name!,
        oldSatang: row.oldSatang!,
        newSatang: row.newSatang!,
      };
    default:
      throw new Error(`toCheckoutDiff: unknown diff kind "${row.kind}"`);
  }
}

// WBS 5.5 — public-create-charge's response shape. Built field by field
// from an object public-create-charge itself assembles from the payload it
// just generated plus create_payment_charge's returned row (never a spread
// of that row — the row also carries id/order_id/status, none of which
// cross the boundary). See docs/api/surfaces_design.md §2, now resolved.
export interface PublicPaymentIntent {
  qrPayload: string;
  amountSatang: number;
  expiresAt: string;
  orderCode: string;
}

export function toPublicPaymentIntent(input: {
  qrPayload: string;
  amountSatang: number;
  expiresAt: string;
  orderCode: string;
}): PublicPaymentIntent {
  return {
    qrPayload: input.qrPayload,
    amountSatang: input.amountSatang,
    expiresAt: input.expiresAt,
    orderCode: input.orderCode,
  };
}
