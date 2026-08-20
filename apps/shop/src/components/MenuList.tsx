"use client";

import * as React from "react";
// Direct dist subpath, not the "@brewledger/shared" barrel — packages/shared
// compiles to CommonJS (worker/edge-function compatibility, tsconfig.base.json),
// which webpack/Turbopack cannot tree-shake the way it can an ES module. The
// barrel's index.js requires every sibling module unconditionally (including
// log.ts, whose redaction regexes/error text embed the literal substring
// "unit_cost_snapshot_satang"), so importing the whole package here would put
// that substring in this route's built client bundle even though nothing in
// this file ever calls it. See MenuItemRow.tsx for the same reasoning applied
// to money formatting, and packages/shared/src/index.ts's own comments for
// the established "reach it via the direct dist subpath" precedent
// (supabase/admin, config already do this).
import { createBrowserClient } from "@brewledger/shared/dist/supabase/client";
import type { PublicMenuCategory, PublicMenuItem } from "@/lib/publicApi";
import { applyRealtimeMenuItemChange, groupItemsByCategory } from "@/lib/menu";
import { MenuItemRow } from "./MenuItemRow";

export interface MenuListProps {
  storeId: string;
  categories: PublicMenuCategory[];
  items: PublicMenuItem[];
  /** Whether the store is currently accepting orders (open + a slot exists today). */
  ordering: boolean;
  /** Id of the one item whose photo should be preloaded (the page's likely LCP element), or null if none has an image. */
  firstImageItemId: string | null;
}

// WBS 5.1 acceptance: "An item toggled unavailable in the console disappears
// from an open customer page within 2 seconds." Subscribes once per mount to
// menu_items changes scoped to this store — the same anon-key RLS policy
// that gates a fresh SELECT (availability <> 'hidden', published store) also
// gates which Realtime events this channel receives, so this component never
// sees a row it wasn't already allowed to see.
export function MenuList({ storeId, categories, items: initialItems, ordering, firstImageItemId }: MenuListProps) {
  const [items, setItems] = React.useState(initialItems);

  React.useEffect(() => {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) return;

    const client = createBrowserClient(supabaseUrl, anonKey);
    const channel = client
      .channel(`public-menu-items-${storeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_items", filter: `store_id=eq.${storeId}` },
        (payload) => {
          setItems((current) =>
            applyRealtimeMenuItemChange(current, {
              eventType: payload.eventType,
              new: payload.new,
              old: payload.old,
            }),
          );
        },
      )
      .subscribe();

    return () => {
      client.removeChannel(channel);
    };
  }, [storeId]);

  const groups = React.useMemo(() => groupItemsByCategory(categories, items), [categories, items]);

  return (
    <>
      {groups.map((group) => (
        <section className="cw-group" key={group.category?.id ?? "uncategorized"}>
          {group.category ? <h3>{group.category.name}</h3> : null}
          <div className="cw-list">
            {group.items.map((item) => (
              <MenuItemRow
                key={item.id}
                item={item}
                ordering={ordering}
                preloadImage={item.id === firstImageItemId}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
