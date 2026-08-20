import Image from "next/image";
// Direct dist subpath, not the "@brewledger/shared" barrel — see MenuList.tsx
// for why (CJS output defeats tree-shaking; the barrel would otherwise pull
// log.ts's literal "unit_cost_snapshot_satang" string into this bundle).
import { formatSatangAsThb } from "@brewledger/shared/dist/money";
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
      {/* Deliberately not packages/ui's MoneyValue here — RL-3, redline_reviewer
          flag (see engineer report). This is a public selling price, never
          `null` (PublicMenuItem.priceSatang is a plain `number`, unlike
          cost/margin fields), so MoneyValue's whole null-handling contract
          doesn't apply — and MoneyValue's ROLE_CLASS map embeds the literal
          strings "money--cost"/"money--profit" in its own module regardless
          of which role a caller passes, which put those substrings in this
          route's built client bundle even though role="plain" never uses
          them at runtime. packages/shared's formatSatangAsThb carries no
          cost/margin/profit vocabulary at all. */}
      <span className="num cw-price">{formatSatangAsThb(item.priceSatang)}</span>
    </div>
  );
}
