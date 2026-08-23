"use server";

// WBS 5.12 — bridges console-create-cash-sale / console-undo-cash-sale
// (supabase/functions/). Both require the merchant's real session JWT
// (withConsoleAuth calls supabase.auth.getUser() against the Authorization
// header), and the console session lives in an httpOnly cookie the browser
// cannot read to build that header itself -- a Server Action is the one hop
// that CAN read it (lib/supabase/server.ts) and forward
// session.access_token as the Bearer token. Mirrors orders/actions.ts's own
// postConsoleFunction helper rather than importing it: that function is not
// exported from its module, and this entry's own brief explicitly allows
// mirroring over a cross-route-folder refactor when the helper isn't
// already exported cleanly.
import { createClient } from "@/lib/supabase/server";
import { UNDO_FAILED, SALE_FAILED } from "./copy";

interface FunctionResult {
  ok: boolean;
  [key: string]: unknown;
}

async function postConsoleFunction(
  fnName: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: FunctionResult | null } | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) return null;

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    });
    const json: FunctionResult | null = await res.json().catch(() => null);
    return { status: res.status, json };
  } catch {
    return null;
  }
}

export interface CashSaleCartOption {
  groupId: string;
  optionId: string;
  name: string;
  deltaSatang: number;
}

export interface CashSaleCartLine {
  menuItemId: string;
  nameSnapshot: string;
  unitPriceSatang: number;
  quantity: number;
  options: CashSaleCartOption[];
}

export interface CashSaleOrder {
  id: string;
  order_code: string;
  total_satang: number;
  cups: number;
  created_at: string;
}

export type CreateCashSaleResult =
  | { ok: true; order: CashSaleOrder }
  | { ok: false; error: string; diffs?: unknown[] };

export async function createCashSale(cart: CashSaleCartLine[]): Promise<CreateCashSaleResult> {
  const result = await postConsoleFunction("console-create-cash-sale", { cart });
  if (!result || !result.json) {
    return { ok: false, error: SALE_FAILED };
  }
  if (result.status === 409 && result.json.code === "PRICE_MISMATCH") {
    return { ok: false, error: SALE_FAILED, diffs: (result.json.diffs as unknown[]) ?? [] };
  }
  if (result.status >= 400 || result.json.ok !== true) {
    return { ok: false, error: SALE_FAILED };
  }
  return { ok: true, order: result.json.order as CashSaleOrder };
}

export type UndoCashSaleResult = { ok: true } | { ok: false; error: string };

export async function undoCashSale(orderId: string): Promise<UndoCashSaleResult> {
  const result = await postConsoleFunction("console-undo-cash-sale", { orderId });
  if (!result || !result.json || result.status >= 400 || result.json.ok !== true) {
    return { ok: false, error: UNDO_FAILED };
  }
  return { ok: true };
}
