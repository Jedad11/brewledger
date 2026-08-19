"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safeNext";

// WBS 4.1 — the ONLY place OTP verification happens. A Server Action, not a
// browser supabase-js call: this is what lets the session cookie be set as
// httpOnly (createClient()'s cookie adapter runs server-side here, so the
// Set-Cookie header comes from Next.js's own response, not from
// document.cookie in the page). See apps/console/src/lib/supabase/server.ts.
//
// interaction_spec.md's identical-error rule, verbatim: wrong OTP and an
// unregistered number must be indistinguishable.
const GENERIC_VERIFY_ERROR = "รหัสไม่ถูกต้อง กรุณาลองใหม่";

const E164_TH_PHONE = /^\+66\d{9}$/;
const OTP_CODE = /^\d{6}$/;

export async function verifyOtpAction(
  phone: string,
  token: string,
  next: string | null,
): Promise<{ error: string } | undefined> {
  if (!E164_TH_PHONE.test(phone) || !OTP_CODE.test(token)) {
    return { error: GENERIC_VERIFY_ERROR };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) {
    return { error: GENERIC_VERIFY_ERROR };
  }

  redirect(safeNext(next));
}
