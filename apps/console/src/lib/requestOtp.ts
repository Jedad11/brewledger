// WBS 4.1 — calls console-auth-request-otp directly from the browser (not
// through a Server Action) specifically so the Edge Function sees the
// merchant's real IP in the request itself, for its 20-sends/IP/hour check.
// Routing this through a Next.js server hop first would replace that IP
// with Vercel's, defeating the per-IP limit.
const GENERIC_ERROR = "ส่งรหัสไม่สำเร็จ ลองใหม่อีกครั้ง";

export async function requestOtp(phone: string): Promise<{ ok: true } | { error: string }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return { error: GENERIC_ERROR };
  }

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/console-auth-request-otp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ phone }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const message = body && typeof body.error === "string" ? body.error : GENERIC_ERROR;
      return { error: message };
    }

    return { ok: true };
  } catch {
    return { error: GENERIC_ERROR };
  }
}
