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
