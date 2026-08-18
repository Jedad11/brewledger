// RL-3. Every field emitted to Customer Web is listed here by hand. If you
// are about to add a spread operator to this file, stop and read WBS 3.7.

import type { Database } from "@brewledger/db/types";

type StoreRow = Database["public"]["Tables"]["stores"]["Row"];
type MenuCategoryRow = Database["public"]["Tables"]["menu_categories"]["Row"];
type MenuItemRow = Database["public"]["Tables"]["menu_items"]["Row"];
type OptionGroupRow = Database["public"]["Tables"]["menu_option_groups"]["Row"];
type OptionRow = Database["public"]["Tables"]["menu_options"]["Row"];
type SlotRow = Database["public"]["Tables"]["pickup_slots"]["Row"];

// No Storage bucket has been provisioned yet (not a WBS 3.7 deliverable) —
// menu_items.image_path is a storage object path, not a URL. Once a public
// bucket exists, this is where its base URL gets prefixed. Passing the path
// through unchanged for now follows the same "flag the gap, don't invent"
// rule the design doc applies to PublicPaymentIntent (§2).
function publicImageUrl(imagePath: string): string {
  return imagePath;
}

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

export function toPublicMenuItem(row: MenuItemRow): PublicMenuItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_path ? publicImageUrl(row.image_path) : null,
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
}): PublicOrderStatus {
  return {
    orderCode: row.order_code,
    status: row.status,
    pickupAt: row.pickup_at,
    itemName: row.item_name,
    quantity: row.quantity,
  };
}

// PublicPaymentIntent — deliberately not defined here. No public-checkout
// Edge Function or PromptPay payload builder exists yet (WBS 5.5). See
// docs/api/surfaces_design.md §2 "PublicPaymentIntent — deferred, not built".
