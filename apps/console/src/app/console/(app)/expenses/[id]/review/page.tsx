// WBS 6.4 -- Purchase Confirmation Screen (Manual): /console/expenses/{id}/review.
// Reached from WBS 6.1's capture screen on save. OCR is deferred (Phase 6.0
// banner) -- every field here was typed by the merchant in 6.1, not
// extracted, so this screen carries no confidence scoring, no confidence
// styling, and no arithmetic-mismatch banner (see ReviewForm.tsx's own top
// comment for the architectural rule this pair of files enforces).
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { getBillSignedUrl } from "@brewledger/shared/dist/storage/bills";
import type { ManualRawOcrOutput } from "@brewledger/shared/dist/purchases/rawOcrOutput";
import { ReviewForm, type ReviewIngredientOption, type ReviewLineDraft } from "./ReviewForm";
import { ConfirmedInvoiceView, type ConfirmedLine } from "./ConfirmedInvoiceView";
import type { BaseUnit } from "@brewledger/costing/dist/units";
import type { Database } from "@brewledger/db/types";

type InvoiceRow = Pick<
  Database["public"]["Tables"]["purchase_invoices"]["Row"],
  "id" | "store_id" | "vendor_name" | "invoice_date" | "total_satang" | "image_path" | "review_status" | "raw_ocr_output"
>;

type IngredientRow = Pick<
  Database["public"]["Tables"]["ingredients"]["Row"],
  "id" | "name" | "base_unit" | "current_unit_cost_satang" | "pack_size"
>;

export default async function PurchaseReviewPage({ params }: PageProps<"/console/expenses/[id]/review">) {
  const { id } = await params;

  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    redirect("/console/login");
  }
  const storeId = currentStoreId(merchant);
  if (!storeId) {
    redirect("/console/settings/store");
  }

  const supabase = await createClient();

  const { data: invoiceRow } = await supabase
    .from("purchase_invoices")
    .select("id, store_id, vendor_name, invoice_date, total_satang, image_path, review_status, raw_ocr_output")
    .eq("id", id)
    .eq("store_id", storeId)
    .maybeSingle();
  const invoice = invoiceRow as InvoiceRow | null;

  // RLS already scopes this to the caller's own store; the explicit
  // .eq("store_id", storeId) above is the WBS 4.2 second layer, same as
  // every other console [id] page in this app.
  if (!invoice) {
    notFound();
  }

  const { data: ingredientRows } = await supabase
    .from("ingredients")
    .select("id, name, base_unit, current_unit_cost_satang, pack_size")
    .eq("store_id", storeId)
    .is("archived_at", null)
    .order("name", { ascending: true });
  const ingredients = (ingredientRows ?? []) as IngredientRow[];

  // "กระทบ N เมนู" in the before-confirm summary (WBS 6.4's own literal
  // example copy) needs, per ingredient, how many DISTINCT menu items
  // reference it via bom_lines. A store's bom_lines table is small (a
  // handful of rows per menu item) -- reducing in JS over one plain SELECT
  // is simpler than standing up a new grouped RPC/view for a single count
  // this one screen needs.
  const { data: bomRows } = await supabase
    .from("bom_lines")
    .select("ingredient_id, menu_item_id")
    .eq("store_id", storeId);
  const menuItemSetsByIngredient = new Map<string, Set<string>>();
  for (const row of (bomRows ?? []) as { ingredient_id: string; menu_item_id: string }[]) {
    const set = menuItemSetsByIngredient.get(row.ingredient_id) ?? new Set<string>();
    set.add(row.menu_item_id);
    menuItemSetsByIngredient.set(row.ingredient_id, set);
  }
  const affectedMenuItemCounts = new Map<string, number>(
    [...menuItemSetsByIngredient].map(([ingredientId, set]) => [ingredientId, set.size]),
  );

  const ingredientOptions: ReviewIngredientOption[] = ingredients.map((row) => ({
    id: row.id,
    name: row.name,
    baseUnit: row.base_unit as BaseUnit,
    currentCostSatang: row.current_unit_cost_satang,
    packSize: row.pack_size,
    affectedMenuItemCount: affectedMenuItemCounts.get(row.id) ?? 0,
  }));

  let imageUrl: string | null = null;
  if (invoice.image_path) {
    try {
      imageUrl = await getBillSignedUrl(supabase, invoice.image_path);
    } catch (err) {
      console.error("PurchaseReviewPage: getBillSignedUrl failed", err);
      // Not fatal -- the review form still works from the typed fields
      // alone, same "photo failure never blocks the underlying record"
      // posture WBS 6.1's own capture screen takes.
    }
  }

  if (invoice.review_status === "confirmed") {
    const { data: lineRows } = await supabase
      .from("purchase_line_items")
      .select("id, ingredient_id, raw_text, qty_base_unit, unit_cost_satang, total_satang")
      .eq("invoice_id", invoice.id);
    const ingredientNameById = new Map(ingredients.map((row) => [row.id, row.name]));
    const lines: ConfirmedLine[] = ((lineRows ?? []) as {
      id: string;
      ingredient_id: string | null;
      raw_text: string | null;
      qty_base_unit: number | null;
      unit_cost_satang: number | null;
      total_satang: number | null;
    }[]).map((row) => ({
      id: row.id,
      label: row.raw_text ?? "-",
      ingredientName: row.ingredient_id ? (ingredientNameById.get(row.ingredient_id) ?? null) : null,
      totalSatang: row.total_satang,
    }));

    return (
      <main className="mx-auto w-full max-w-xl px-4 py-8">
        <ConfirmedInvoiceView
          vendorName={invoice.vendor_name}
          invoiceDate={invoice.invoice_date}
          totalSatang={invoice.total_satang}
          lines={lines}
        />
      </main>
    );
  }

  const raw = invoice.raw_ocr_output as ManualRawOcrOutput | null;
  const initialLines: ReviewLineDraft[] = (raw?.lineItems ?? []).map((item) => ({
    name: item.name,
    qtyText: item.qtyText,
    unitText: item.unitText,
    unitCostThb: String(item.unitCostSatang / 100),
  }));

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <ReviewForm
        storeId={storeId}
        invoiceId={invoice.id}
        vendorName={invoice.vendor_name ?? ""}
        invoiceDate={invoice.invoice_date ?? new Date().toISOString().slice(0, 10)}
        imageUrl={imageUrl}
        initialLines={initialLines}
        ingredientOptions={ingredientOptions}
      />
    </main>
  );
}
