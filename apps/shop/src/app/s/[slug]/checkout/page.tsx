import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchPublicSlots, fetchPublicStore } from "@/lib/publicApi";
import { CHECKOUT_TITLE } from "@/lib/copy";
import { SlotPicker } from "@/components/SlotPicker";

// WBS 5.3 — "เลือกเวลารับ /checkout" (docs/design/state_matrix.md).
//
// SCOPE BOUNDARY, read before extending this file: this route implements
// the slot-picker + name-capture screen the WBS 5.3 Claude Code Prompt asks
// for (point 4, "Customer picker UI at apps/shop/app/s/[slug]/checkout"),
// and nothing past it. It does NOT render the cart (WBS 5.2, built
// concurrently elsewhere — do not import apps/shop/lib/cart.ts or the
// cart/ route from this file, that boundary is deliberate, see the WBS 5.3
// dispatch notes) and does NOT create an order (WBS 5.4's
// public-create-order, not built yet). SlotPicker.tsx's own header comment
// has the exact wiring note for where WBS 5.4 plugs in. Next.js route
// segment, so this file existing does not preempt 5.4 — it extends this
// same page with the cart summary and the real submit handler.
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
