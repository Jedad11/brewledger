"use server";

// WBS 6.4 -- Purchase Confirmation Screen (Manual).
//
// ARCHITECTURAL RULE THIS FILE ENFORCES: nothing writes to
// ingredients.current_unit_cost_satang until a merchant explicitly taps
// confirm, even though every value on this screen was typed by the merchant
// themselves back in WBS 6.1 -- a fat-fingered price would silently corrupt
// the cost of every menu item using that ingredient, and the merchant would
// only discover it as a profit figure they cannot explain. confirmPurchaseInvoice
// below is the ONLY function in this file (and, per packages/db/migrations/
// 0043's own header, the only write path in the whole codebase) that can
// move that column, and it only ever runs from the confirm button's onClick
// -- never on page load, never on an intermediate field edit.
//
// RPC vs Edge Function, disclosed: WBS 5.6/5.9's order/payment actions
// (../../orders/actions.ts) route through supabase/functions/console-*
// Edge Functions, forwarding the merchant's session as a Bearer token. That
// indirection exists for the specific critical-path list CLAUDE.md's own
// "critical-path rule" enumerates (menu, slot check, order creation, QR
// issue, payment confirmation, order status) -- this screen is not on that
// list; it is an inventory/costing write, not an order-lifecycle one. The
// established precedent for THIS class of write is a direct authenticated
// RPC call from a Server Action -- see inventory/page.tsx's own
// `supabase.rpc("ingredient_stock_levels", ...)` and this same directory's
// sibling saveIngredient/archiveIngredient (both plain `.from()` writes, no
// Edge Function). console_confirm_purchase_invoice needs `security definer`
// ONLY because job_queue carries zero RLS policies for `authenticated`
// (0043's own header) -- that is orthogonal to whether the caller is an Edge
// Function or a Server Action; both present the identical merchant JWT to
// PostgREST. Going through a new Edge Function here would add a network hop
// with no corresponding benefit, so this calls the RPC directly.
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import type { BaseUnit } from "@brewledger/costing/dist/units";

const SAVE_ERROR = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";
const CONFIRM_ERROR = "ยืนยันไม่สำเร็จ ลองใหม่อีกครั้ง";
const NAME_REQUIRED = "กรอกชื่อวัตถุดิบ";

function isOwnedStore(merchant: { storeIds: string[] }, storeId: string): boolean {
  return merchant.storeIds.includes(storeId);
}

export interface CreateIngredientInlineInput {
  storeId: string;
  name: string;
  baseUnit: BaseUnit;
  packSize: number | null;
}

export interface CreatedIngredient {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  currentCostSatang: number | null;
  packSize: number | null;
}

export type CreateIngredientInlineResult = { ok: true; ingredient: CreatedIngredient } | { error: string };

/**
 * "สร้างวัตถุดิบใหม่" without leaving this screen (WBS 6.4 deliverable).
 * Same shape as inventory/[id]/actions.ts's saveIngredient create path, kept
 * as its own thin action rather than importing that file directly -- this
 * screen needs only name + baseUnit + packSize back immediately to populate
 * the just-created option in the mapping dropdown, not that screen's
 * low-stock-threshold field or its update/delete/archive paths.
 * current_unit_cost_satang is deliberately left NULL here (0008's own
 * column comment: "null until a bill is confirmed") -- this ingredient did
 * not exist a moment ago and has no purchase history yet; confirming THIS
 * invoice, if this line ends up mapped to it, is what will set it.
 */
export async function createIngredientInline(input: CreateIngredientInlineInput): Promise<CreateIngredientInlineResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: SAVE_ERROR };
  if (!isOwnedStore(merchant, input.storeId)) {
    console.error(`createIngredientInline: rejected storeId ${input.storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: SAVE_ERROR };
  }

  const name = input.name.trim();
  if (!name) return { error: NAME_REQUIRED };
  if (input.packSize !== null && !(input.packSize > 0)) return { error: SAVE_ERROR };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ingredients")
    .insert({
      store_id: input.storeId,
      name,
      base_unit: input.baseUnit,
      pack_size: input.baseUnit === "piece" ? input.packSize : null,
    })
    .select("id, name, base_unit, current_unit_cost_satang, pack_size")
    .single();

  if (error || !data) return { error: SAVE_ERROR };
  return {
    ok: true,
    ingredient: {
      id: data.id as string,
      name: data.name as string,
      baseUnit: data.base_unit as BaseUnit,
      currentCostSatang: data.current_unit_cost_satang as number | null,
      packSize: data.pack_size as number | null,
    },
  };
}

export interface ConfirmLineInput {
  name: string;
  /** "name (qty unit)" as typed -- kept as purchase_line_items.raw_text for the record. */
  rawText: string;
  /** null => unmapped, recorded as a general expense only -- never forced. */
  ingredientId: string | null;
  /** Required iff ingredientId is set. Already converted client-side via
   * packages/costing/src/units.ts's toBaseUnit -- see this file's own top
   * comment for why that conversion is not redone here or in the RPC. */
  qtyBaseUnit: number | null;
  /** Required iff ingredientId is set. Cost per BASE unit, in satang,
   * already rounded client-side via costPerBaseUnit. */
  unitCostSatang: number | null;
  /** As typed -- the real amount paid for this line, always present. */
  totalSatang: number;
}

export interface ConfirmPurchaseInvoiceInput {
  invoiceId: string;
  storeId: string;
  vendorName: string | null;
  invoiceDate: string;
  lines: ConfirmLineInput[];
}

export interface ChangedIngredient {
  ingredientId: string;
  oldCostSatang: number | null;
  newCostSatang: number;
}

export type ConfirmPurchaseInvoiceResult =
  | { ok: true; already: boolean; changed: ChangedIngredient[] }
  | { error: string };

/** Mirrors createPurchaseInvoice's own isValidLineItem (WBS 6.1) -- a
 * garbage or bypassed-UI value must reject the whole submission before it
 * ever reaches the RPC, not silently coerce into a legitimate-looking line. */
function isValidLine(line: ConfirmLineInput): boolean {
  if (line.name.trim().length === 0) return false;
  if (!Number.isInteger(line.totalSatang) || line.totalSatang < 0) return false;
  if (line.ingredientId !== null) {
    if (line.qtyBaseUnit === null || !(line.qtyBaseUnit > 0)) return false;
    if (line.unitCostSatang === null || !Number.isInteger(line.unitCostSatang) || line.unitCostSatang < 0) return false;
  }
  return true;
}

export async function confirmPurchaseInvoice(input: ConfirmPurchaseInvoiceInput): Promise<ConfirmPurchaseInvoiceResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) return { error: CONFIRM_ERROR };
  if (!isOwnedStore(merchant, input.storeId)) {
    console.error(`confirmPurchaseInvoice: rejected storeId ${input.storeId} -- not owned by merchant ${merchant.merchantId}`);
    return { error: CONFIRM_ERROR };
  }

  if (input.lines.length === 0 || input.lines.some((line) => !isValidLine(line))) {
    return { error: CONFIRM_ERROR };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("console_confirm_purchase_invoice", {
    p_invoice_id: input.invoiceId,
    p_vendor_name: input.vendorName,
    p_invoice_date: input.invoiceDate,
    p_lines: input.lines.map((line) => ({
      name: line.name.trim(),
      rawText: line.rawText,
      ingredientId: line.ingredientId,
      qtyBaseUnit: line.qtyBaseUnit,
      unitCostSatang: line.unitCostSatang,
      totalSatang: line.totalSatang,
    })),
  });

  if (error) {
    console.error("confirmPurchaseInvoice: RPC error", error);
    return { error: CONFIRM_ERROR };
  }

  const result = data as {
    ok: boolean;
    already?: boolean;
    code?: string;
    changed?: ChangedIngredient[];
  } | null;

  if (!result || !result.ok) {
    console.error("confirmPurchaseInvoice: RPC returned failure", result);
    return { error: CONFIRM_ERROR };
  }

  return { ok: true, already: Boolean(result.already), changed: result.changed ?? [] };
}
