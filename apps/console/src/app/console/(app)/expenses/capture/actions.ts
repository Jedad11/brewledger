"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { uploadCompressedBill } from "@brewledger/shared/dist/storage/bills";
import type { ManualRawOcrOutput, ManualRawPurchaseLineItem } from "@brewledger/shared/dist/purchases/rawOcrOutput";

const SAVE_ERROR = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
const PHOTO_UPLOAD_ERROR = "อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง";

function isOwnedStore(merchant: { storeIds: string[] }, storeId: string): boolean {
  return merchant.storeIds.includes(storeId);
}

export interface PurchaseLineItemInput {
  name: string;
  qtyText: string;
  unitText: string;
  /** Integer satang, already converted from the merchant's THB input by the form. */
  unitCostSatang: number;
}

export interface CreatePurchaseInvoiceInput {
  storeId: string;
  vendorName: string | null;
  invoiceDate: string;
  lineItems: PurchaseLineItemInput[];
}

export type CreatePurchaseInvoiceResult = { ok: true; invoiceId: string } | { error: string };

// Mirrors PurchaseCaptureForm's isCompleteRow/lineTotalSatang server-side —
// a garbage or bypassed-UI value must reject the whole submission, not
// silently coerce into a legitimate-looking ฿0 line (RL-2's "unknown is
// null, never 0" posture applies here too).
function isValidLineItem(item: PurchaseLineItemInput): boolean {
  const qty = Number(item.qtyText);
  return (
    Number.isFinite(qty) &&
    qty > 0 &&
    Number.isInteger(item.unitCostSatang) &&
    item.unitCostSatang >= 0
  );
}

function lineTotalSatang(item: PurchaseLineItemInput): number {
  return Math.round(Number(item.qtyText) * item.unitCostSatang);
}

/**
 * Inserts ONE purchase_invoices row. Deliberately does NOT write
 * purchase_line_items — see ManualRawOcrOutput's own header for why. The
 * merchant's typed rows are parked in raw_ocr_output for WBS 6.4's confirm
 * step to read back after it resolves each line to an ingredient (and
 * therefore a base_unit). image_path is left unset here (stays NULL,
 * migration 0043); uploadPurchaseInvoicePhoto below fills it in as a
 * separate step once this row's id exists, mirroring
 * apps/console/.../menu/[id]/actions.ts's saveMenuItem + uploadMenuItemPhoto
 * split for the same session-cookie reason (see that file's own comment).
 *
 * ocr_status is set to 'manual' explicitly for readability, even though the
 * column now defaults to it (migration 0043 recommends this explicitly).
 */
export async function createPurchaseInvoice(
  input: CreatePurchaseInvoiceInput,
): Promise<CreatePurchaseInvoiceResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: SAVE_ERROR };

  if (!isOwnedStore(merchant, input.storeId)) {
    console.error(`createPurchaseInvoice: rejected storeId ${input.storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: SAVE_ERROR };
  }

  const survivingLineItems: PurchaseLineItemInput[] = input.lineItems
    .map((item) => ({
      name: item.name.trim(),
      qtyText: item.qtyText.trim(),
      unitText: item.unitText.trim(),
      unitCostSatang: item.unitCostSatang,
    }))
    .filter((item) => item.name.length > 0 && item.qtyText.length > 0);

  if (survivingLineItems.length === 0) return { error: SAVE_ERROR };
  if (survivingLineItems.some((item) => !isValidLineItem(item))) return { error: SAVE_ERROR };

  const lineItems: ManualRawPurchaseLineItem[] = survivingLineItems.map((item) => ({
    name: item.name,
    qtyText: item.qtyText,
    unitText: item.unitText,
    unitCostSatang: item.unitCostSatang,
    totalSatang: lineTotalSatang(item),
  }));

  const totalSatang = lineItems.reduce((sum, item) => sum + item.totalSatang, 0);
  const rawOcrOutput: ManualRawOcrOutput = { source: "manual", version: 1, lineItems };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("purchase_invoices")
    .insert({
      store_id: input.storeId,
      vendor_name: input.vendorName?.trim() || null,
      invoice_date: input.invoiceDate || null,
      total_satang: totalSatang,
      ocr_status: "manual",
      raw_ocr_output: rawOcrOutput,
    })
    .select("id")
    .single();

  if (error || !data) return { error: SAVE_ERROR };

  return { ok: true, invoiceId: data.id as string };
}

export type UploadPurchaseInvoicePhotoResult = { ok: true } | { error: string };

/**
 * Runs the actual private-bucket Storage write server-side, same reasoning
 * as uploadMenuItemPhoto: compressImage (WBS 3.8) is DOM/Canvas-only and
 * stays in the browser; the write itself needs the merchant's session,
 * which a browser-side Supabase client never carries (WBS 4.1's session
 * cookie is httpOnly) — a browser-client storage call runs as `anon` and
 * merchant_insert_bills (0022_storage_policies.sql) rejects it.
 */
export async function uploadPurchaseInvoicePhoto(
  invoiceId: string,
  storeId: string,
  formData: FormData,
): Promise<UploadPurchaseInvoicePhotoResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: PHOTO_UPLOAD_ERROR };
  if (!isOwnedStore(merchant, storeId)) {
    console.error(`uploadPurchaseInvoicePhoto: rejected storeId ${storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: PHOTO_UPLOAD_ERROR };
  }

  const blob = formData.get("file");
  if (!(blob instanceof Blob)) return { error: PHOTO_UPLOAD_ERROR };

  const supabase = await createClient();
  let path: string;
  try {
    path = await uploadCompressedBill(supabase, blob, storeId, invoiceId);
  } catch (err) {
    console.error("uploadPurchaseInvoicePhoto: storage upload failed", err);
    return { error: PHOTO_UPLOAD_ERROR };
  }

  const { error } = await supabase
    .from("purchase_invoices")
    .update({ image_path: path })
    .eq("id", invoiceId)
    .eq("store_id", storeId);

  if (error) return { error: PHOTO_UPLOAD_ERROR };
  return { ok: true };
}
