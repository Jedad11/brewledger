"use server";

// WBS 5.6 — bridges to console-confirm-payment / console-reject-payment
// (supabase/functions/). Those two functions require the merchant's real
// session JWT (withConsoleAuth calls supabase.auth.getUser() against the
// Authorization header) -- unlike requestOtp.ts's pre-login call to
// console-auth-request-otp, this cannot be a plain browser fetch, because
// the console session lives in an httpOnly cookie (lib/supabase/server.ts)
// the browser has no access to. A Server Action is what CAN read that
// cookie server-side, so it reads the session here and forwards its
// access_token as the Bearer token -- the one hop between "the browser
// tapped a button" and "the Edge Function saw a real merchant JWT".
import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx, currentStoreId } from "@/lib/merchant";
import { CONFIRM_FAILED, REJECT_FAILED, ADVANCE_FAILED, ADVANCE_STALE } from "./copy";

interface FunctionResult {
  ok: boolean;
  already?: boolean;
  [key: string]: unknown;
}

// Bridges every console-* Edge Function call: those functions require the
// merchant's real session JWT (withConsoleAuth calls supabase.auth.getUser()
// against the Authorization header), and the console session lives in an
// httpOnly cookie the browser cannot read to build that header itself -- a
// Server Action is the one hop that CAN read it (lib/supabase/server.ts)
// and forward session.access_token as the Bearer token. Returns the raw
// response status alongside the parsed body so a caller that needs to
// distinguish HTTP status (e.g. advanceOrder's 409) can, without every
// caller needing its own fetch/session/env-var boilerplate.
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

async function callConsoleFunction(
  fnName: string,
  orderId: string,
  genericError: string,
): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  const result = await postConsoleFunction(fnName, { orderId });
  if (!result || !result.json || result.status >= 400 || result.json.ok !== true) {
    return { ok: false, error: genericError };
  }
  return { ok: true, already: Boolean(result.json.already) };
}

export type ConfirmPaymentResult = { ok: true; already: boolean } | { ok: false; error: string };

export async function confirmPayment(orderId: string): Promise<ConfirmPaymentResult> {
  return callConsoleFunction("console-confirm-payment", orderId, CONFIRM_FAILED);
}

export type RejectPaymentResult = { ok: true; already: boolean } | { ok: false; error: string };

export async function rejectPayment(orderId: string): Promise<RejectPaymentResult> {
  return callConsoleFunction("console-reject-payment", orderId, REJECT_FAILED);
}

// WBS 5.9 -- "เริ่มทำ" / "พร้อมรับ" / "รับแล้ว". `to` is the literal DB
// status console-advance-order's request body expects (WORKING_QUEUE
// callers derive it via statusMap.ts's nextDbStatusFor, never hand-typed).
export type AdvanceOrderResult = { ok: true; already: boolean } | { ok: false; error: string };

export async function advanceOrder(
  orderId: string,
  to: "PREPARING" | "READY" | "COLLECTED",
): Promise<AdvanceOrderResult> {
  const result = await postConsoleFunction("console-advance-order", { orderId, to });
  if (!result) return { ok: false, error: ADVANCE_FAILED };
  // 409 = ILLEGAL_TRANSITION: a real, expected state conflict (another
  // tab/device already moved this order), not a server fault -- gets its
  // own more specific Thai copy rather than the generic failure message.
  if (result.status === 409) return { ok: false, error: ADVANCE_STALE };
  if (!result.json || result.status >= 400 || result.json.ok !== true) {
    return { ok: false, error: ADVANCE_FAILED };
  }
  return { ok: true, already: Boolean(result.json.already) };
}

// WBS 5.9 -- "ทำเสร็จทั้งช่วงเวลานี้". Per-order results, not a single
// ok/fail: a partial failure must name which orders failed (WBS 5.9
// acceptance), which a collapsed boolean cannot express.
export interface BulkReadyOrderResult {
  orderId: string;
  ok: boolean;
}

export type BulkMarkReadyResult =
  | { ok: true; results: BulkReadyOrderResult[] }
  | { ok: false; error: string };

export async function bulkMarkReady(orderIds: string[]): Promise<BulkMarkReadyResult> {
  if (orderIds.length === 0) return { ok: true, results: [] };
  const result = await postConsoleFunction("console-bulk-ready-orders", { orderIds });
  if (!result || !result.json || result.status >= 400 || result.json.ok !== true) {
    return { ok: false, error: ADVANCE_FAILED };
  }
  const rows = Array.isArray(result.json.results) ? (result.json.results as BulkReadyOrderResult[]) : [];
  return { ok: true, results: rows };
}

// WBS 5.8 -- everything below is a plain authenticated write, RLS-scoped to
// the caller's own store (merchant_rw_push_subscriptions / merchant_rw_stores,
// packages/db/migrations/0038_push_subscriptions_and_inbox_state.sql). None
// of these are time-critical (nobody is blocked waiting on a subscribe or a
// mute toggle), and Server Actions are this app's own established pattern
// for a direct authenticated write (see settings/store/actions.ts,
// menu/actions.ts's toggleMenuItemAvailability) rather than a browser-side
// supabase-js call or a new Edge Function -- consistent, not a special case.
// Failures here are silent/best-effort by design: the inbox and the polling
// fallback both work with zero push subscriptions and with the cursor unset,
// so there is no Thai error copy to show for any of these.

async function storeIdOrNull(): Promise<string | null> {
  const merchant = await resolveMerchantCtx();
  return merchant ? currentStoreId(merchant) : null;
}

export async function markOrdersSeen(): Promise<{ ok: boolean }> {
  const storeId = await storeIdOrNull();
  if (!storeId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("stores")
    .update({ orders_last_seen_at: new Date().toISOString() })
    .eq("id", storeId);
  return { ok: !error };
}

export async function setNotifySoundMuted(muted: boolean): Promise<{ ok: boolean }> {
  const storeId = await storeIdOrNull();
  if (!storeId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("stores").update({ notify_sound_muted: muted }).eq("id", storeId);
  return { ok: !error };
}

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  authKey: string;
  userAgent?: string | null;
}

export async function savePushSubscription(input: PushSubscriptionInput): Promise<{ ok: boolean }> {
  const storeId = await storeIdOrNull();
  if (!storeId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      store_id: storeId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth_key: input.authKey,
      user_agent: input.userAgent ?? null,
    },
    { onConflict: "store_id,endpoint" },
  );
  return { ok: !error };
}

export async function deletePushSubscription(endpoint: string): Promise<{ ok: boolean }> {
  const storeId = await storeIdOrNull();
  if (!storeId) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("store_id", storeId)
    .eq("endpoint", endpoint);
  return { ok: !error };
}
