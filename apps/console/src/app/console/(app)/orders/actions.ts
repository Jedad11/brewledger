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
import { CONFIRM_FAILED, REJECT_FAILED } from "./copy";

interface FunctionResult {
  ok: boolean;
  already?: boolean;
  [key: string]: unknown;
}

async function callConsoleFunction(
  fnName: string,
  orderId: string,
  genericError: string,
): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return { ok: false, error: genericError };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { ok: false, error: genericError };
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/${fnName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ orderId }),
    });

    const json: FunctionResult | null = await res.json().catch(() => null);
    if (!res.ok || !json || json.ok !== true) {
      return { ok: false, error: genericError };
    }
    return { ok: true, already: Boolean(json.already) };
  } catch {
    return { ok: false, error: genericError };
  }
}

export type ConfirmPaymentResult = { ok: true; already: boolean } | { ok: false; error: string };

export async function confirmPayment(orderId: string): Promise<ConfirmPaymentResult> {
  return callConsoleFunction("console-confirm-payment", orderId, CONFIRM_FAILED);
}

export type RejectPaymentResult = { ok: true; already: boolean } | { ok: false; error: string };

export async function rejectPayment(orderId: string): Promise<RejectPaymentResult> {
  return callConsoleFunction("console-reject-payment", orderId, REJECT_FAILED);
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
