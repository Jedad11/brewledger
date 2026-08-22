// WBS 5.1 — pure helpers for MenuList.tsx: grouping items under categories,
// and folding a Realtime postgres_changes payload into local item state.
// Kept dependency-free and side-effect-free so qa_engineer can unit test
// them directly without a browser or a live Supabase project.
// Direct dist subpath, not the barrel — same reasoning as MenuList.tsx's
// import of createBrowserClient. menuImagePublicUrl is a plain string
// function (no Database row type involved), so importing it doesn't
// reintroduce the type-boundary problem the rest of this file's
// re-declared-not-imported posture exists to avoid — see the
// RealtimeMenuItemRow comment below. Imports from menuImagePath (not
// menuImages) specifically: menuImages also pulls in compressImage
// (canvas/DOM compression code apps/shop's realtime mapper has no use for)
// for its upload flow — menuImagePath is the pure path/URL slice.
import { menuImagePublicUrl } from "@brewledger/shared/dist/storage/menuImagePath";
import type { PublicMenuCategory, PublicMenuItem } from "./publicApi";

export interface MenuGroup {
  category: PublicMenuCategory | null;
  items: PublicMenuItem[];
}

// Any item whose categoryId is null, or references a category this client
// never received (menu_categories carries zero anon RLS policy — the only
// categories this page ever sees are the ones public-menu's service_role
// read already narrowed through toPublicMenuCategory), renders in a
// trailing, unheaded group rather than under an invented label.
export function groupItemsByCategory(categories: PublicMenuCategory[], items: PublicMenuItem[]): MenuGroup[] {
  const sortedCategories = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  const knownCategoryIds = new Set(sortedCategories.map((c) => c.id));

  const groups: MenuGroup[] = sortedCategories.map((category) => ({
    category,
    items: items.filter((item) => item.categoryId === category.id).sort((a, b) => a.sortOrder - b.sortOrder),
  }));

  const ungrouped = items
    .filter((item) => !item.categoryId || !knownCategoryIds.has(item.categoryId))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (ungrouped.length > 0) {
    groups.push({ category: null, items: ungrouped });
  }

  return groups.filter((group) => group.items.length > 0);
}

// Raw menu_items row shape as it arrives over Realtime (snake_case, exactly
// the table's own columns — see packages/db/migrations/0005_menu_items.sql).
// Deliberately re-declared here rather than imported from
// packages/shared/src/serializers/public.ts: that file's toPublicMenuItem
// types its parameter against Database["public"]["Tables"]["menu_items"]["Row"]
// (packages/db), which apps/shop must never resolve (RL-3, eslint.config.mjs).
export interface RealtimeMenuItemRow {
  id: string;
  store_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  image_path: string | null;
  price_satang: number;
  availability: "available" | "out_of_stock" | "hidden";
  sort_order: number;
}

// Mirrors toPublicMenuItem (packages/shared/src/serializers/public.ts) field
// for field. A mismatch against that function is a signal to fix here, not
// something to unify away — same posture public.schema.ts already takes
// toward public.ts. `supabaseUrl` is NEXT_PUBLIC_SUPABASE_URL, already read
// by MenuList.tsx's effect to build its Realtime channel client; threaded
// through here rather than re-read so this stays a pure function of its
// arguments.
export function toPublicMenuItemFromRealtimeRow(row: RealtimeMenuItemRow, supabaseUrl: string): PublicMenuItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_path ? menuImagePublicUrl(supabaseUrl, row.image_path) : null,
    priceSatang: row.price_satang,
    availability: row.availability,
    sortOrder: row.sort_order,
  };
}

// `new`/`old` mirror @supabase/realtime-js's own RealtimePostgresChangesPayload
// shape (an INSERT's `old` and a DELETE's `new` arrive as `{}`, not null —
// Partial<RealtimeMenuItemRow> already accepts that with every field
// optional, so this stays structurally assignable without fighting that
// type's generic inference at the .on() call site in MenuList.tsx).
export interface RealtimeMenuItemChange {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Partial<RealtimeMenuItemRow>;
  old: Partial<RealtimeMenuItemRow>;
}

// A `hidden` item disappears entirely rather than rendering greyed —
// matches the anon RLS predicate (availability <> 'hidden') an initial page
// load already gets for free, applied by hand here since Realtime delivers
// the raw row regardless of what RLS would have filtered from a fresh
// SELECT. `out_of_stock` keeps the item visible (greyed, "หมดชั่วคราว") —
// see docs/design/state_matrix.md's "Item temporarily unavailable" state.
export function applyRealtimeMenuItemChange(
  current: PublicMenuItem[],
  change: RealtimeMenuItemChange,
  supabaseUrl: string,
): PublicMenuItem[] {
  if (change.eventType === "DELETE") {
    const removedId = change.old?.id;
    return removedId ? current.filter((item) => item.id !== removedId) : current;
  }

  const row = change.new;
  if (!row?.id || !row.availability) return current;

  if (row.availability === "hidden") {
    return current.filter((item) => item.id !== row.id);
  }

  // An INSERT/UPDATE row is missing a required column only if it references
  // a category this snapshot never saw fully hydrated — extremely unlikely
  // given Postgres always sends the full row, but skip rather than crash.
  if (
    row.name === undefined ||
    row.description === undefined ||
    row.image_path === undefined ||
    row.price_satang === undefined ||
    row.sort_order === undefined ||
    row.category_id === undefined
  ) {
    return current;
  }

  const mapped = toPublicMenuItemFromRealtimeRow(row as RealtimeMenuItemRow, supabaseUrl);
  const exists = current.some((item) => item.id === mapped.id);
  return exists ? current.map((item) => (item.id === mapped.id ? mapped : item)) : [...current, mapped];
}

export function isAbsoluteHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}
