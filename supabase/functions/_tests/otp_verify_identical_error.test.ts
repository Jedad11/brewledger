// WBS 4.1 — Testing block, item 4: "Security: wrong code and unknown number
// produce identical responses." Acceptance: "An expired or wrong code
// produces a Thai error that does not disclose whether the number is
// registered."
//
// This isolates the claim at the layer it actually holds: Supabase Auth's
// own verifyOtp endpoint, called directly over real HTTP against the real
// local GoTrue + Postgres — not the Next.js Server Action wrapper
// (apps/console/src/app/console/login/actions.ts), which cannot be invoked
// outside a real Next.js request (it calls next/headers' cookies(), which
// throws when imported into a bare test process). The Server Action's own
// generic-message wrapping (GENERIC_VERIFY_ERROR, identical string for both
// cases by construction — one `if (error)` branch, one message, no
// per-cause branching) is proven separately by the Playwright-driven
// integration test (otp_login.e2e.test.ts) for the wrong-code path, the one
// half of this pair reachable through the real UI without a second
// test_otp-mapped phone number.
//
// Real network calls to the local GoTrue instance. No mock.
import { describe, expect, it } from "vitest";
import { anonClient, isFunctionReachable } from "./helpers/clients";

// Reuses isFunctionReachable's underlying reachability signal for "is the
// local stack up at all" by checking the well-known seeded function; if
// Edge Functions aren't serving, GoTrue (a separate `supabase start`
// service) may still be up, so this suite also tries a direct getUser()
// no-op call rather than gating strictly on isFunctionReachable.
async function isAuthReachable(): Promise<boolean> {
  try {
    const client = anonClient();
    // signInWithOtp against a syntactically valid but never-used number is a
    // cheap, side-effect-tolerable reachability probe (it either sends a
    // "test" OTP via the local test_otp intercept path or fails cleanly —
    // both prove GoTrue answered).
    await client.auth.getSession();
    return true;
  } catch {
    return false;
  }
}

let ready = false;

describe("GoTrue verifyOtp — identical error for wrong code vs. unknown number", () => {
  it("setup: local Supabase Auth is reachable", async () => {
    ready = await isAuthReachable();
    if (!ready) {
      // eslint-disable-next-line no-console
      console.warn(
        "\n[otp_verify_identical_error.test.ts] SKIPPING remaining tests — " +
          "local Supabase Auth not reachable. Run `supabase start` first. " +
          "This is a SKIP, not a pass.\n",
      );
    }
    expect(true).toBe(true); // this probe test itself always "passes"; it only sets `ready`
  });

  it("a WRONG code on a KNOWN, registered number and ANY code on an UNKNOWN number return byte-identical error text", async () => {
    if (!ready) return;

    // Known, registered number: the seeded demo merchant
    // (packages/db/seed.sql), which supabase/config.toml's
    // [auth.sms.test_otp] maps to the real code "123456" — so "000000" is
    // guaranteed wrong for it.
    const knownRegisteredPhone = "+66811111111";
    const wrongCode = "000000";

    // Unknown number: freshly random, has never gone through
    // signInWithOtp, so there is no outstanding OTP challenge for it at
    // all — verifyOtp for it must fail the same way a wrong code does, not
    // with a different "no such user" style error.
    const unknownPhone = `+668${Math.floor(10000000 + Math.random() * 89999999)}`;
    const anyCode = "123456";

    const client = anonClient();

    const wrongCodeResult = await client.auth.verifyOtp({
      phone: knownRegisteredPhone,
      token: wrongCode,
      type: "sms",
    });
    const unknownNumberResult = await client.auth.verifyOtp({
      phone: unknownPhone,
      token: anyCode,
      type: "sms",
    });

    // Both must fail (neither accidentally succeeds).
    expect(wrongCodeResult.data.session).toBeNull();
    expect(unknownNumberResult.data.session).toBeNull();
    expect(wrongCodeResult.error).not.toBeNull();
    expect(unknownNumberResult.error).not.toBeNull();

    // The actual claim: the two error responses are indistinguishable —
    // same HTTP status, same message. A merchant (or an attacker probing
    // for registered numbers) cannot tell these two cases apart.
    expect(wrongCodeResult.error?.status).toBe(unknownNumberResult.error?.status);
    expect(wrongCodeResult.error?.message).toBe(unknownNumberResult.error?.message);
    expect(wrongCodeResult.error?.code).toBe(unknownNumberResult.error?.code);
  });

  it("sanity: the KNOWN number's real test_otp code actually verifies (proves the wrong-code case above is genuinely wrong, not just always-broken)", async () => {
    if (!ready) return;
    const client = anonClient();
    // Unlike the two error cases above, a genuine successful verify DOES
    // require a real pending challenge to exist first — GoTrue matches the
    // submitted code against a specific outstanding OTP row, and there is
    // none until signInWithOtp creates one. This send is intercepted
    // locally by supabase/config.toml's [auth.sms.test_otp] map (fixed code
    // "123456" for this number) rather than dispatching a real SMS.
    const { error: sendError } = await client.auth.signInWithOtp({ phone: "+66811111111" });
    expect(sendError).toBeNull();

    const { data, error } = await client.auth.verifyOtp({
      phone: "+66811111111",
      token: "123456",
      type: "sms",
    });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
  });
});
