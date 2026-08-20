"use client";

// WBS 5.2 — client-side cart store. Persists to `sessionStorage`, not
// `localStorage`: the cart must survive a reload within the session but
// must not resurrect days later as a stale, mispriced order.
//
// WHY THE CART NEVER TOUCHES SUPABASE (WBS 5.2 scope note, load-bearing):
// creating an `orders` row for every add-to-cart (or every abandoned
// browse) would fill the 500 MB free-tier database with garbage and would
// corrupt WBS 5.3's slot-quota accounting, which counts real orders, not
// browsing sessions. This file has no Supabase import anywhere in it —
// "no order row is created while browsing" holds by construction, not by a
// runtime check that could regress silently. The only place a cart line
// becomes a real database row is WBS 5.4's checkout/order-creation flow,
// which reads this store's state but never lives inside it.
//
// Implemented as a small custom store (module-level state + a per-slug
// subscriber set, read through `useSyncExternalStore`) rather than Zustand:
// Zustand isn't a dependency of this workspace today (see
// apps/shop/package.json) and CLAUDE.md's stack table doesn't call for a
// state-management library here — sessionStorage plus a handful of pure
// array operations is the whole feature.
import * as React from "react";

export interface CartOptionSelection {
  groupId: string;
  optionId: string;
  name: string;
  deltaSatang: number;
}

export interface CartLine {
  menuItemId: string;
  nameSnapshot: string;
  /** Integer satang. Never a float — see CLAUDE.md's money rules. */
  unitPriceSatang: number;
  options: CartOptionSelection[];
  quantity: number;
}

const EMPTY_CART: CartLine[] = [];

function storageKey(slug: string): string {
  return `bl-cart:${slug}`;
}

function readFromStorage(slug: string): CartLine[] {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    const raw = window.sessionStorage.getItem(storageKey(slug));
    if (!raw) return EMPTY_CART;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CartLine[]) : EMPTY_CART;
  } catch {
    return EMPTY_CART;
  }
}

function writeToStorage(slug: string, lines: CartLine[]): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(storageKey(slug), JSON.stringify(lines));
}

// A per-slug in-memory cache of the last-known array, so getSnapshot()
// returns a stable reference between renders (useSyncExternalStore requires
// this — a fresh array on every call would loop forever). Only replaced on
// an explicit write or the first read for a given slug.
const snapshotCache = new Map<string, CartLine[]>();
const listeners = new Map<string, Set<() => void>>();

function getSnapshot(slug: string): CartLine[] {
  if (!snapshotCache.has(slug)) {
    snapshotCache.set(slug, readFromStorage(slug));
  }
  return snapshotCache.get(slug)!;
}

function getServerSnapshot(): CartLine[] {
  return EMPTY_CART;
}

function setSnapshot(slug: string, lines: CartLine[]): void {
  snapshotCache.set(slug, lines);
  writeToStorage(slug, lines);
  listeners.get(slug)?.forEach((listener) => listener());
}

function subscribe(slug: string, listener: () => void): () => void {
  let set = listeners.get(slug);
  if (!set) {
    set = new Set();
    listeners.set(slug, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

export interface UseCartResult {
  lines: CartLine[];
  addLine: (line: CartLine) => void;
  removeLine: (index: number) => void;
  updateQuantity: (index: number, delta: number) => void;
  /** General-purpose line mutator — used by cartValidation's resolve actions (accept a new price). */
  updateLine: (index: number, updater: (line: CartLine) => CartLine) => void;
}

// One cart per store slug — a customer's cart for one shop never mixes with
// another shop's menuItemIds, and sessionStorage is already scoped to the
// single tab, so no cross-store bleed is possible even without this, but
// the explicit key keeps the shape self-documenting.
export function useCart(slug: string): UseCartResult {
  const lines = React.useSyncExternalStore(
    (listener) => subscribe(slug, listener),
    () => getSnapshot(slug),
    getServerSnapshot,
  );

  const updateLine = React.useCallback(
    (index: number, updater: (line: CartLine) => CartLine) => {
      const next = getSnapshot(slug).map((line, i) => (i === index ? updater(line) : line));
      setSnapshot(slug, next);
    },
    [slug],
  );

  const addLine = React.useCallback(
    (line: CartLine) => {
      setSnapshot(slug, [...getSnapshot(slug), line]);
    },
    [slug],
  );

  const removeLine = React.useCallback(
    (index: number) => {
      setSnapshot(
        slug,
        getSnapshot(slug).filter((_, i) => i !== index),
      );
    },
    [slug],
  );

  const updateQuantity = React.useCallback(
    (index: number, delta: number) => {
      updateLine(index, (line) => ({ ...line, quantity: Math.max(1, line.quantity + delta) }));
    },
    [updateLine],
  );

  return { lines, addLine, removeLine, updateQuantity, updateLine };
}

export function cartLineTotalSatang(line: CartLine): number {
  const optionsDeltaSatang = line.options.reduce((sum, option) => sum + option.deltaSatang, 0);
  return (line.unitPriceSatang + optionsDeltaSatang) * line.quantity;
}

export function cartTotalSatang(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + cartLineTotalSatang(line), 0);
}

export function cartCupCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}
