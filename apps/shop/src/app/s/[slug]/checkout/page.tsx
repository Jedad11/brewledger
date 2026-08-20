import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchPublicSlots, fetchPublicStore } from "@/lib/publicApi";
import { CHECKOUT_TITLE } from "@/lib/copy";
import { SlotPicker } from "@/components/SlotPicker";

// WBS 5.3/5.4 — "เลือกเวลารับ /checkout" (docs/design/state_matrix.md).
//
// This route implements the slot-picker + name-capture screen the WBS 5.3
// Claude Code Prompt asked for (point 4, "Customer picker UI at
// apps/shop/app/s/[slug]/checkout"). The WBS 5.3-era boundary that lived in
// this comment — "do NOT import apps/shop/lib/cart.ts... that boundary is
// deliberate" — is CLOSED as of WBS 5.4: order creation needs the cart's
// lines to submit, so SlotPicker.tsx now reads the cart directly via
// useCart(slug) and calls public-create-order. This page component itself
// still renders no cart summary of its own — that lives inside SlotPicker
// (see its own header comment) alongside the phone field and submit
// handler, keeping this file a thin server-rendered shell.
//
// Slot capacity changes frequently (interaction_spec.md: re-fetched on
// entering /checkout) — never statically cached.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await fetchPublicStore(slug);
  if (result.kind !== "ok") return { title: "Brew Ledger" };
  return { title: `${CHECKOUT_TITLE} · ${result.data.name}` };
}

export default async function CheckoutPage({ params }: PageProps<"/s/[slug]/checkout">) {
  const { slug } = await params;

  const storeResult = await fetchPublicStore(slug);
  if (storeResult.kind === "not_found") notFound();
  if (storeResult.kind === "error") throw new Error("failed to load public store");
  const store = storeResult.data;

  const slotsResult = await fetchPublicSlots(slug);
  if (slotsResult.kind === "not_found") notFound();
  if (slotsResult.kind === "error") throw new Error("failed to load public slots");

  return (
    <div className="cw">
      <header className="cw-header">
        <Link href={`/s/${slug}/cart`} className="back" aria-label="ย้อนกลับ">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M12.5 4 6.5 10l6 6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
        <span className="name">{CHECKOUT_TITLE}</span>
      </header>
      <div className="cw-body">
        <SlotPicker slug={slug} timezone={store.timezone} initialSlots={slotsResult.data} />
      </div>
    </div>
  );
}
