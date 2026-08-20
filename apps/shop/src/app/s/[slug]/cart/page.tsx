"use client";

// WBS 5.2 — client component, not a Server Component: the cart lives
// entirely in sessionStorage (apps/shop/src/lib/cart.ts), which only
// exists in the browser. MenuList.tsx already establishes the "use client"
// pattern this app uses for anything that needs browser-only state; this
// page's params come through useParams() rather than an awaited `params`
// prop for the same reason a client component can't be `async`.
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { EmptyState, PublicMoneyValue } from "@brewledger/ui";
import { cartLineTotalSatang, cartCupCount, cartTotalSatang, useCart } from "@/lib/cart";
import { fetchPublicMenu, type PublicMenuResponse } from "@/lib/publicApi";
import { revalidateCart, type CartDiffReason } from "@/lib/cartValidation";
import { CartDiffNotices } from "@/components/CartDiffNotices";
import {
  ADD_MORE_ITEMS_LABEL,
  BACK_LABEL,
  BACK_TO_MENU_LABEL,
  CART_CHANGED_BODY,
  CART_CHANGED_TITLE,
  CART_EMPTY_BODY,
  CART_EMPTY_TITLE,
  CART_REVALIDATING_LABEL,
  CART_REVALIDATION_ERROR,
  CART_TITLE,
  CART_TOTAL_LABEL,
  DECREASE_QUANTITY_LABEL,
  INCREASE_QUANTITY_LABEL,
  PROCEED_TO_SLOT_LABEL,
  REMOVE_LABEL,
  cupsLabel,
} from "@/lib/copy";

const BACK_ARROW = (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M12.5 4 6.5 10l6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

type RevalidationPhase = "idle" | "checking" | "blocked" | "error";

function optionLabel(options: { name: string }[]): string {
  return options.map((option) => option.name).join(" · ");
}

export default function CartPage() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const router = useRouter();
  const { lines, updateQuantity, removeLine, updateLine } = useCart(slug);

  const [phase, setPhase] = React.useState<RevalidationPhase>("idle");
  const [diffs, setDiffs] = React.useState<CartDiffReason[]>([]);
  // Cached from the last successful re-fetch so resolving a diff (accept /
  // remove) can re-check locally without another round trip.
  const freshMenuRef = React.useRef<PublicMenuResponse | null>(null);

  async function handleProceed() {
    setPhase("checking");
    const result = await fetchPublicMenu(slug);
    if (result.kind !== "ok") {
      setPhase("error");
      return;
    }
    freshMenuRef.current = result.data;
    const check = revalidateCart(lines, result.data);
    if (check.ok) {
      router.push(`/s/${slug}/checkout`);
      return;
    }
    setDiffs(check.diffs);
    setPhase("blocked");
  }

  // Re-checks against the already-fetched menu whenever the cart changes
  // while blocked — resolving every diff (accept or remove) clears the
  // block and proceeds automatically, matching state_matrix.md's "Stale
  // cart at proceed" state.
  React.useEffect(() => {
    if (phase !== "blocked" || !freshMenuRef.current) return;
    const check = revalidateCart(lines, freshMenuRef.current);
    if (check.ok) {
      setPhase("idle");
      router.push(`/s/${slug}/checkout`);
    } else {
      setDiffs(check.diffs);
    }
  }, [lines, phase, router, slug]);

  function acceptDiff(diff: CartDiffReason) {
    if (diff.kind === "price_changed") {
      updateLine(diff.lineIndex, (line) => ({ ...line, unitPriceSatang: diff.newSatang }));
    } else if (diff.kind === "option_price_changed") {
      updateLine(diff.lineIndex, (line) => ({
        ...line,
        options: line.options.map((option) =>
          option.optionId === diff.optionId ? { ...option, deltaSatang: diff.newSatang } : option,
        ),
      }));
    }
  }

  if (lines.length === 0) {
    return (
      <div className="cw">
        <header className="cw-header">
          <Link className="back" href={`/s/${slug}`} aria-label={BACK_LABEL}>
            {BACK_ARROW}
          </Link>
          <span className="name">{CART_TITLE}</span>
        </header>
        <div className="cw-body">
          <EmptyState
            title={CART_EMPTY_TITLE}
            body={CART_EMPTY_BODY}
            action={{ label: BACK_TO_MENU_LABEL, onPress: () => router.push(`/s/${slug}`) }}
          />
        </div>
      </div>
    );
  }

  const total = cartTotalSatang(lines);
  const cups = cartCupCount(lines);

  return (
    <div className="cw">
      <header className="cw-header">
        <Link className="back" href={`/s/${slug}`} aria-label={BACK_LABEL}>
          {BACK_ARROW}
        </Link>
        <span className="name">{CART_TITLE}</span>
      </header>
      <div className="cw-body">
        {phase === "blocked" ? (
          <div className="cw-notice">
            <b>{CART_CHANGED_TITLE}</b>
            <p>{CART_CHANGED_BODY}</p>
          </div>
        ) : null}
        {phase === "error" ? (
          <div className="cw-notice">
            <b>{CART_REVALIDATION_ERROR}</b>
          </div>
        ) : null}

        {phase === "blocked" ? <CartDiffNotices diffs={diffs} onAccept={acceptDiff} onRemove={removeLine} /> : null}

        {lines.map((line, i) => (
          <div className="card cw-line" key={i}>
            <div className="cw-line-top">
              <div>
                <b>{line.nameSnapshot}</b>
                <p className="note-plain">{optionLabel(line.options)}</p>
              </div>
              <b className="num">
                <PublicMoneyValue value={cartLineTotalSatang(line)} />
              </b>
            </div>
            <div className="cw-line-bot">
              <div className="cw-step">
                <button type="button" aria-label={DECREASE_QUANTITY_LABEL} onClick={() => updateQuantity(i, -1)}>
                  −
                </button>
                <span className="num">{line.quantity}</span>
                <button type="button" aria-label={INCREASE_QUANTITY_LABEL} onClick={() => updateQuantity(i, 1)}>
                  +
                </button>
              </div>
              <button type="button" className="btn btn--quiet" onClick={() => removeLine(i)}>
                {REMOVE_LABEL}
              </button>
            </div>
          </div>
        ))}

        <Link className="btn btn--outline" href={`/s/${slug}`} style={{ width: "100%" }}>
          {ADD_MORE_ITEMS_LABEL}
        </Link>

        <div className="card cw-total">
          <span>{CART_TOTAL_LABEL}</span>
          <b className="num">
            <PublicMoneyValue value={total} />
          </b>
        </div>
      </div>

      <div className="cw-cartbar">
        <span className="cw-sum">
          {cupsLabel(cups)} · <PublicMoneyValue value={total} />
        </span>
        <button type="button" className="btn" disabled={phase === "checking"} onClick={handleProceed}>
          {phase === "checking" ? CART_REVALIDATING_LABEL : PROCEED_TO_SLOT_LABEL}
        </button>
      </div>
    </div>
  );
}
