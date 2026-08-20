"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { normalizePromptPayId, type PromptPayType } from "@brewledger/shared/dist/promptpay/normalize";

// WBS 4.5 — save the merchant's own PromptPay identifier. RL-1 primary
// enforcement point: this is the value every future order's QR is built
// from, so ownership is checked the same way saveStoreProfile
// (settings/store/actions.ts) checks it, and identifier changes always
// invalidate any prior verification -- see identifierChanged below.
const SAVE_ERROR = "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง";

function isOwnedStoreId(merchant: { storeIds: string[] }, storeId: string): boolean {
  return merchant.storeIds.includes(storeId);
}

export interface SavePromptPayInput {
  storeId: string;
  promptpayType: PromptPayType;
  promptpayIdRaw: string;
  verified: boolean;
}

export type SavePromptPayResult =
  | { ok: true; promptpayId: string; promptpayType: PromptPayType; promptpayVerifiedAt: string | null }
  | { error: string };

export async function savePromptPaySettings(input: SavePromptPayInput): Promise<SavePromptPayResult> {
  const merchant = await resolveMerchantCtx();
  if (!merchant) {
    return { error: SAVE_ERROR };
  }

  if (!isOwnedStoreId(merchant, input.storeId)) {
    console.error(
      `savePromptPaySettings: rejected storeId ${input.storeId} -- not in merchant ${merchant.merchantId}'s storeIds`,
    );
    return { error: SAVE_ERROR };
  }

  const normalized = normalizePromptPayId(input.promptpayType, input.promptpayIdRaw);
  if (!normalized.ok || !normalized.value) {
    return { error: normalized.error ?? SAVE_ERROR };
  }

  const supabase = await createClient();

  const { data: current, error: currentErr } = await supabase
    .from("stores")
    .select("promptpay_id, promptpay_type, promptpay_verified_at")
    .eq("id", input.storeId)
    .single();
  if (currentErr || !current) {
    return { error: SAVE_ERROR };
  }

  // Changing the identifier invalidates any prior verification carried over
  // from a PREVIOUS submission: the merchant's earlier scan proved the OLD
  // number was theirs, not the new one, so a stale/carried-over `verified`
  // flag must never survive an edit on its own. It does NOT mean a fresh
  // `verified: true` arriving in the SAME submission as the edit is
  // ignored -- the client resets `confirmed` to false on every identifier/
  // type edit (see handleRawChange/handleTypeChange) and the confirmation
  // toggle is only enabled once a QR for the CURRENT value has actually
  // rendered (canConfirm requires qrDataUrl), so `verified: true` here can
  // only mean an honest re-verify of the new value in this request, never a
  // stale tick. Only the UNCHANGED case carries a prior timestamp forward;
  // a changed identifier still always mints a fresh one from THIS
  // submission's own `verified` flag, never reuses the old timestamp.
  //
  // A row that never had an identifier (current.promptpay_id === null,
  // e.g. a store's very first PromptPay save) has no prior verification to
  // invalidate -- "changed" only applies to a genuine edit of a
  // previously-set value, not to setting one for the first time.
  const identifierChanged =
    current.promptpay_id !== null &&
    (current.promptpay_id !== normalized.value || current.promptpay_type !== input.promptpayType);

  const promptpayVerifiedAt = identifierChanged
    ? input.verified
      ? new Date().toISOString()
      : null
    : input.verified
      ? (current.promptpay_verified_at ?? new Date().toISOString())
      : null;

  const { error: updateErr } = await supabase
    .from("stores")
    .update({
      promptpay_id: normalized.value,
      promptpay_type: input.promptpayType,
      promptpay_verified_at: promptpayVerifiedAt,
    })
    .eq("id", input.storeId);

  if (updateErr) {
    return { error: SAVE_ERROR };
  }

  return {
    ok: true,
    promptpayId: normalized.value,
    promptpayType: input.promptpayType,
    promptpayVerifiedAt,
  };
}
