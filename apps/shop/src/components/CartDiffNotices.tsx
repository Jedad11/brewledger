// WBS 5.2/5.4 — shared diff-notice rendering for a stale/mismatched cart.
// Extracted out of the /cart page (where this was first built, WBS 5.2) so
// WBS 5.4's checkout-time 409 PRICE_MISMATCH can render the identical UI
// instead of a second, drift-prone copy — the WBS 5.4 Claude Code Prompt's
// own instruction is to reuse this if the shape lines up, and CheckoutDiff
// (packages/shared/src/serializers/public.ts) was deliberately built
// field-for-field parallel to CartDiffReason for exactly this reuse.
import { PublicMoneyValue } from "@brewledger/ui";
import type { CartDiffReason } from "@/lib/cartValidation";
import {
  ACCEPT_NEW_PRICE_LABEL,
  PRICE_CHANGED_DIFF_MIDDLE,
  REMOVE_LABEL,
  itemUnavailableDiffText,
  optionRemovedDiffText,
  priceChangedDiffPrefix,
} from "@/lib/copy";

function DiffText({ diff }: { diff: CartDiffReason }) {
  switch (diff.kind) {
    case "item_removed":
    case "item_unavailable":
      return <>{itemUnavailableDiffText(diff.nameSnapshot)}</>;
    case "option_removed":
      return <>{optionRemovedDiffText(diff.name)}</>;
    case "price_changed":
      return (
        <>
          {priceChangedDiffPrefix(diff.nameSnapshot)}
          <PublicMoneyValue value={diff.oldSatang} />
          {PRICE_CHANGED_DIFF_MIDDLE}
          <PublicMoneyValue value={diff.newSatang} />
        </>
      );
    case "option_price_changed":
      return (
        <>
          {priceChangedDiffPrefix(diff.name)}
          <PublicMoneyValue value={diff.oldSatang} />
          {PRICE_CHANGED_DIFF_MIDDLE}
          <PublicMoneyValue value={diff.newSatang} />
        </>
      );
  }
}

export function CartDiffNotices({
  diffs,
  onAccept,
  onRemove,
}: {
  diffs: CartDiffReason[];
  onAccept: (diff: CartDiffReason) => void;
  onRemove: (lineIndex: number) => void;
}) {
  return (
    <>
      {diffs.map((diff, i) => (
        <div className="cw-notice" key={i}>
          <p>
            <DiffText diff={diff} />
          </p>
          <div style={{ display: "flex", gap: "1.2rem", marginTop: ".8rem" }}>
            {diff.kind === "price_changed" || diff.kind === "option_price_changed" ? (
              <button type="button" className="btn btn--outline" onClick={() => onAccept(diff)}>
                {ACCEPT_NEW_PRICE_LABEL}
              </button>
            ) : null}
            <button type="button" className="btn btn--quiet" onClick={() => onRemove(diff.lineIndex)}>
              {REMOVE_LABEL}
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
