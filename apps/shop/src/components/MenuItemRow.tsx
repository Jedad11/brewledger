import Image from "next/image";
import { PublicMoneyValue } from "@brewledger/ui";
import type { PublicMenuItem } from "@/lib/publicApi";
import { isAbsoluteHttpUrl } from "@/lib/menu";
import { ITEM_UNAVAILABLE_LABEL } from "@/lib/copy";

const PHOTO_SIZE = 64;

export interface MenuItemRowProps {
  item: PublicMenuItem;
  /** Whether the store is currently accepting orders at all (open + a slot exists today). */
  ordering: boolean;
  /** True for the one item whose photo is the page's likely LCP element. */
  preloadImage: boolean;
  /** WBS 5.2 — opens the item options sheet. Omitted (or item disabled) renders an inert row. */
  onTap?: () => void;
}

export function MenuItemRow({ item, ordering, preloadImage, onTap }: MenuItemRowProps) {
  const isUnavailable = item.availability === "out_of_stock";
  const isOut = isUnavailable || !ordering;
  const imageUrl = item.imageUrl && isAbsoluteHttpUrl(item.imageUrl) ? item.imageUrl : null;

  return (
    // A real <button>, matching the prototype's own scMenu() markup
    // (`<button class="cw-item"...>`) — WBS 5.1 rendered a <div> here since
    // nothing was tappable yet; WBS 5.2 makes it interactive, which this
    // fixes to match fidelity rather than layering a click handler onto a
    // non-interactive element.
    <button
      type="button"
      className={`cw-item${isOut ? " is-out" : ""}`}
      disabled={isOut}
      onClick={onTap}
      data-testid={`menu-item-${item.id}`}
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt=""
          width={PHOTO_SIZE}
          height={PHOTO_SIZE}
          sizes={`${PHOTO_SIZE}px`}
          style={{ borderRadius: 8 }}
          preload={preloadImage}
        />
      ) : (
        <div className="cw-photo" style={{ width: PHOTO_SIZE, height: PHOTO_SIZE }} aria-hidden="true" />
      )}
      <span className="cw-item-txt">
        <b>{item.name}</b>
        <span className="note-plain">{isUnavailable ? ITEM_UNAVAILABLE_LABEL : item.description}</span>
      </span>
      {/* PublicMoneyValue, not packages/ui's MoneyValue — RL-3. MoneyValue's
          ROLE_CLASS map embeds the literal strings "money--cost"/
          "money--profit" in its own module regardless of which role a
          caller passes, so importing it at all (even role="plain") put
          those substrings in this route's built client bundle.
          PublicMoneyValue has no ROLE_CLASS and no MoneyRole import — those
          substrings never enter its module graph. */}
      <span className="num cw-price">
        <PublicMoneyValue value={item.priceSatang} />
      </span>
    </button>
  );
}
