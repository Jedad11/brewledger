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
}

export function MenuItemRow({ item, ordering, preloadImage }: MenuItemRowProps) {
  const isUnavailable = item.availability === "out_of_stock";
  const isOut = isUnavailable || !ordering;
  const imageUrl = item.imageUrl && isAbsoluteHttpUrl(item.imageUrl) ? item.imageUrl : null;

  return (
    <div className={`cw-item${isOut ? " is-out" : ""}`} aria-disabled={isOut} data-testid={`menu-item-${item.id}`}>
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
    </div>
  );
}
