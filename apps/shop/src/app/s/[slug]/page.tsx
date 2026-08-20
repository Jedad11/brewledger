import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState } from "@brewledger/ui";
import { fetchPublicMenu, fetchPublicSlots, fetchPublicStore } from "@/lib/publicApi";
import { computeSlotAvailability, computeStoreOpenState, formatHoursLabel } from "@/lib/storeSchedule";
import { groupItemsByCategory, isAbsoluteHttpUrl } from "@/lib/menu";
import {
  CLOSED_TITLE,
  MENU_EMPTY_BODY,
  MENU_EMPTY_TITLE,
  SLOTS_FULL_TITLE,
  STORE_CLOSED_LABEL,
  STORE_OPEN_LABEL,
  closedBody,
  slotsFullBody,
} from "@/lib/copy";
import { MenuList } from "@/components/MenuList";

// Store status, menu availability and slot capacity all change frequently
// (WBS 5.1's whole Realtime requirement is about that) — never let Next
// serve a statically cached or stale render of this route.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await fetchPublicStore(slug);
  if (result.kind !== "ok") {
    return { title: "Brew Ledger" };
  }
  return { title: result.data.name };
}

export default async function StorePage({ params }: PageProps<"/s/[slug]">) {
  const { slug } = await params;

  const storeResult = await fetchPublicStore(slug);
  if (storeResult.kind === "not_found") notFound();
  if (storeResult.kind === "error") throw new Error("failed to load public store");
  const store = storeResult.data;

  const [menuResult, slotsResult] = await Promise.all([fetchPublicMenu(slug), fetchPublicSlots(slug)]);
  if (menuResult.kind === "not_found") notFound();
  if (menuResult.kind === "error") throw new Error("failed to load public menu");
  if (slotsResult.kind === "not_found") notFound();
  if (slotsResult.kind === "error") throw new Error("failed to load public slots");

  const { categories, items } = menuResult.data;

  if (items.length === 0) {
    return (
      <div className="cw">
        <header className="cw-header">
          <span className="name">{store.name}</span>
        </header>
        <div className="cw-body">
          <EmptyState title={MENU_EMPTY_TITLE} body={MENU_EMPTY_BODY} />
        </div>
      </div>
    );
  }

  const now = new Date();
  const openState = computeStoreOpenState(store.opensAt, store.closesAt, store.timezone, now);
  const slotState = computeSlotAvailability(slotsResult.data, store.timezone, now);
  const allSlotsFullToday = slotsResult.data.length > 0 && !slotState.hasSlotsToday;
  const ordering = openState.isOpen && !allSlotsFullToday;

  const notice = !openState.isOpen
    ? { title: CLOSED_TITLE, body: closedBody(openState.nextOpeningLabel ?? "") }
    : allSlotsFullToday
      ? { title: SLOTS_FULL_TITLE, body: slotsFullBody(slotState.nextSlotLabel ?? "") }
      : null;

  const firstImageItemId =
    groupItemsByCategory(categories, items)
      .flatMap((group) => group.items)
      .find((item) => item.imageUrl && isAbsoluteHttpUrl(item.imageUrl))?.id ?? null;

  return (
    <div className="cw">
      <header className="cw-header">
        <span className="name">{store.name}</span>
      </header>
      <div className="cw-body">
        <div className="cw-store">
          <div className="cw-storehead">
            <h2>{store.name}</h2>
            <span className={`st ${openState.isOpen ? "st--making" : "st--expired"}`}>
              {openState.isOpen ? STORE_OPEN_LABEL : STORE_CLOSED_LABEL}
            </span>
          </div>
          {store.pickupAddress ? <p className="note-plain">{store.pickupAddress}</p> : null}
          {store.opensAt && store.closesAt ? (
            <p className="note-plain">{formatHoursLabel(store.opensAt, store.closesAt)}</p>
          ) : null}
        </div>

        {notice ? (
          <div className="cw-notice">
            <b>{notice.title}</b>
            <p>{notice.body}</p>
          </div>
        ) : null}

        <MenuList
          storeId={store.id}
          categories={categories}
          items={items}
          ordering={ordering}
          firstImageItemId={firstImageItemId}
        />
      </div>
    </div>
  );
}
