"use client";

import Link from "next/link";
import { PublicMoneyValue } from "@brewledger/ui";
import { cartCupCount, cartTotalSatang, useCart } from "@/lib/cart";
import { cartBarDisabledLabel, cupsLabel, VIEW_CART_LABEL } from "@/lib/copy";

export interface CartBarProps {
  slug: string;
  ordering: boolean;
  /** customer-web.js's `cartbar()` disabled label — see docs/design/state_matrix.md's เมนูร้าน "Closed" state. */
  nextOpeningLabel: string;
}

// WBS 5.2 — sticky cart summary bar (customer-web.js's cartbar(), line 42).
// Deliberately a sibling of `.cw-body` in page.tsx, not nested inside it:
// `.cw-body` carries its own padding (`var(--space-3)` on all sides), and
// the prototype's cartbar() is a sibling of the body div specifically so it
// renders edge-to-edge and sticks to the *viewport* bottom, not inset by
// the body's padding — nesting it inside `.cw-body` would visually break
// that. Reads the cart via useCart(slug), the same sessionStorage-backed
// external store MenuOrdering.tsx's add-to-cart writes into — no prop
// drilling or context provider needed for the two to stay in sync.
export function CartBar({ slug, ordering, nextOpeningLabel }: CartBarProps) {
  const { lines } = useCart(slug);
  const cups = cartCupCount(lines);
  if (cups === 0) return null;

  const total = cartTotalSatang(lines);

  return (
    <div className="cw-cartbar">
      <span className="cw-sum">
        {cupsLabel(cups)} · <PublicMoneyValue value={total} />
      </span>
      {ordering ? (
        <Link className="btn" href={`/s/${slug}/cart`}>
          {VIEW_CART_LABEL}
        </Link>
      ) : (
        <button type="button" className="btn" disabled>
          {cartBarDisabledLabel(nextOpeningLabel)}
        </button>
      )}
    </div>
  );
}
