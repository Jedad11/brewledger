// WBS 6.1 — purchase / bill entry (manual): /console/expenses/capture.
// OCR (6.2/6.3) is deferred per the Phase 6.0 rescope banner in
// BrewLedger_WBS_Dictionary.md — this is a plain typed-entry form, not a
// capture-then-review split, and there is no processing/waiting state
// because nothing runs in the background.
import { redirect } from "next/navigation";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { PurchaseCaptureForm } from "./PurchaseCaptureForm";

export default async function PurchaseCapturePage() {
  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    redirect("/console/login");
  }

  // Same "no store yet" posture as /console/menu/[id] and every other
  // console form that writes a store-scoped row: nothing here can be
  // created without a store to attach it to.
  const storeId = currentStoreId(merchant);
  if (!storeId) {
    redirect("/console/settings/store");
  }

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <PurchaseCaptureForm storeId={storeId} />
    </main>
  );
}
