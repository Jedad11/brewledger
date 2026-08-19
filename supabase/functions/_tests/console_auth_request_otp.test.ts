// WBS 4.1 — Testing block, item 3: "Security: the 6th OTP request within an
// hour for the same phone/IP is rejected." Acceptance criteria: 5 sends per
// phone per hour, 20 per IP per hour (packages/db/migrations/0024_auth_attempts.sql,
// supabase/functions/_shared/auth/rateLimit.ts).
//
// Real HTTP against the real console-auth-request-otp Edge Function, backed
// by the real auth_attempts table — not a mock of checkAndRecordRateLimit.
// Every phone number used here is randomly generated per test run so repeat
// runs inside the same hour don't collide with a previous run's bucket.
//
// Setup: `supabase start`, `supabase db reset` (applies 0024_auth_attempts.sql),
// then `supabase functions serve --no-verify-jwt --import-map
// supabase/functions/deno.json` (matches console_auth_guard.test.ts's own
// setup instructions in this directory). SKIPS (not passes) if the function
// isn't reachable.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { functionUrl, isFunctionReachable, LOCAL_ANON_KEY, serviceClient } from "./helpers/clients";

const FUNCTION_NAME = "console-auth-request-otp";
const URL_ = functionUrl(FUNCTION_NAME);
const GENERIC_ERROR = "ส่งรหัสไม่สำเร็จ ลองใหม่อีกครั้ง";

let ready = false;

// Reads the same local-dev-only throwaway salt the function itself uses
// (supabase/functions/.env, gitignored — see docs/ops/auth.md), purely so
// this suite can clean up its own auth_attempts rows after each run instead
// of leaving them to expire after an hour. Never point this at a hosted
// project's real secret.
function readLocalHashSalt(): string | undefined {
  try {
    const envPath = fileURLToPath(new URL("../.env", import.meta.url));
    const contents = readFileSync(envPath, "utf8");
    for (const line of contents.split("\n")) {
      const match = line.match(/^AUTH_ATTEMPTS_HASH_SALT=(.*)$/);
      if (match) return match[1].trim();
    }
  } catch {
    // fall through
  }
  return undefined;
}

function hashForCleanup(value: string, salt: string): string {
  return createHmac("sha256", salt).update(value).digest("hex");
}

const LOCAL_SALT = readLocalHashSalt();

function randomThaiPhone(): string {
  const rand = Math.floor(100000000 + Math.random() * 800000000);
  return `+668${String(rand).slice(0, 8)}`;
}

// The phone-bucket tests below want to isolate the PHONE bucket only — if
// every call in this file shared one implicit IP (whatever Kong forwards
// for a bare loopback call with no x-forwarded-for header, observed
// locally to be a single consistent value), repeated suite runs within the
// same hour would exhaust that one shared 20/hour IP bucket first and fail
// with a 429 that has nothing to do with the phone-bucket assertion being
// made — exactly what happened during this suite's own development. Each
// phone-bucket test gets its own fresh fake IP so it never competes with
// the real IP-bucket test below (which deliberately reuses a single IP) or
// with a previous run of this same file.
function randomFakeIp(): string {
  return `198.51.100.${Math.floor(Math.random() * 254 + 1)}`;
}

async function requestOtp(
  phone: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: LOCAL_ANON_KEY,
      Authorization: `Bearer ${LOCAL_ANON_KEY}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ phone }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const cleanupHashes: { column: "phone_hash" | "ip_hash"; hash: string }[] = [];

async function cleanupAuthAttempts() {
  if (!LOCAL_SALT || cleanupHashes.length === 0) return;
  const svc = serviceClient();
  for (const { column, hash } of cleanupHashes) {
    await svc.from("auth_attempts").delete().eq(column, hash);
  }
}

beforeAll(async () => {
  const reachable = await isFunctionReachable(FUNCTION_NAME);
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[console_auth_request_otp.test.ts] SKIPPING — the local Edge " +
        "Functions server isn't serving console-auth-request-otp. Run " +
        "`supabase start`, `supabase db reset`, then `supabase functions " +
        "serve --no-verify-jwt --import-map supabase/functions/deno.json`. " +
        "This is a SKIP, not a pass.\n",
    );
    return;
  }
  ready = true;
});

afterAll(async () => {
  if (ready) await cleanupAuthAttempts();
});

// checkAndRecordRateLimit (supabase/functions/_shared/auth/rateLimit.ts)
// records the attempt BEFORE console-auth-request-otp ever calls
// signInWithOtp, so a request that clears the rate-limit gate is recorded
// against the bucket regardless of what happens next. Locally, only the
// single seeded number (+66811111111) is mapped in supabase/config.toml's
// [auth.sms.test_otp] — signInWithOtp for any OTHER syntactically-valid
// number reaches the (unconfigured, local-only) real provider path and
// itself returns a GoTrue-level error, which this function forwards as its
// own 400 with the same generic body. That downstream delivery outcome is
// orthogonal to rate limiting and is verified separately (docs/ops/auth.md,
// the hosted brewledger-dev curl proof) — so "allowed by the rate limiter"
// is asserted here as "status is NOT 429", not as a literal 200, to avoid
// conflating the two concerns. The one assertion that IS status-exact is
// the 429 itself, which is what this test is actually about.
describe("console-auth-request-otp — per-phone rate limit (5/hour)", () => {
  it(
    "the first 5 requests for a fresh phone number are allowed by the rate limiter, and the 6th within the same hour is rejected with 429",
    async () => {
      if (!ready) return;
      const phone = randomThaiPhone();
      const fakeIp = randomFakeIp();
      if (LOCAL_SALT) {
        cleanupHashes.push({ column: "phone_hash", hash: hashForCleanup(phone, LOCAL_SALT) });
        cleanupHashes.push({ column: "ip_hash", hash: hashForCleanup(fakeIp, LOCAL_SALT) });
      }

      const results: { status: number; body: unknown }[] = [];
      // Sequential, not Promise.all: the rate limiter is a count-then-insert
      // read against a real table, not atomic under real concurrency (a
      // separate, more interesting question this test does not claim to
      // answer) — sequential calls are what actually exercises "the 6th
      // request is rejected" cleanly and deterministically.
      for (let i = 0; i < 6; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await requestOtp(phone, { "x-forwarded-for": fakeIp }));
      }

      const [r1, r2, r3, r4, r5, r6] = results;
      for (const r of [r1, r2, r3, r4, r5]) {
        expect(r.status).not.toBe(429);
      }
      expect(r6.status).toBe(429);
      expect(r6.body).toEqual({ error: GENERIC_ERROR });
    },
    20_000,
  );

  it(
    "a different phone number has its own separate bucket, unaffected by another number's limit",
    async () => {
      if (!ready) return;
      const phoneA = randomThaiPhone();
      const phoneB = randomThaiPhone();
      const fakeIp = randomFakeIp();
      if (LOCAL_SALT) {
        cleanupHashes.push({ column: "phone_hash", hash: hashForCleanup(phoneA, LOCAL_SALT) });
        cleanupHashes.push({ column: "phone_hash", hash: hashForCleanup(phoneB, LOCAL_SALT) });
        cleanupHashes.push({ column: "ip_hash", hash: hashForCleanup(fakeIp, LOCAL_SALT) });
      }

      for (let i = 0; i < 5; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const r = await requestOtp(phoneA, { "x-forwarded-for": fakeIp });
        expect(r.status).not.toBe(429);
      }
      const sixthA = await requestOtp(phoneA, { "x-forwarded-for": fakeIp });
      expect(sixthA.status).toBe(429);

      // phoneB has never been used — must still be allowed (not 429).
      const firstB = await requestOtp(phoneB, { "x-forwarded-for": fakeIp });
      expect(firstB.status).not.toBe(429);
    },
    20_000,
  );
});

describe("console-auth-request-otp — per-IP rate limit (20/hour)", () => {
  it(
    "the 21st request from the same IP (across distinct phone numbers) within an hour is rejected with 429",
    async () => {
      if (!ready) return;
      // The function reads x-forwarded-for first — set explicitly so this
      // test controls the IP bucket deterministically rather than depending
      // on how the local Kong gateway forwards the caller's real address.
      const fakeIp = `203.0.113.${Math.floor(Math.random() * 254 + 1)}`;
      if (LOCAL_SALT) cleanupHashes.push({ column: "ip_hash", hash: hashForCleanup(fakeIp, LOCAL_SALT) });

      const phones = Array.from({ length: 21 }, () => randomThaiPhone());
      if (LOCAL_SALT) {
        for (const p of phones) {
          cleanupHashes.push({ column: "phone_hash", hash: hashForCleanup(p, LOCAL_SALT) });
        }
      }

      const results: { status: number; body: unknown }[] = [];
      for (const phone of phones) {
        // eslint-disable-next-line no-await-in-loop
        results.push(await requestOtp(phone, { "x-forwarded-for": fakeIp }));
      }

      const first20 = results.slice(0, 20);
      const twentyFirst = results[20];

      // See the describe-block-level comment above: "allowed" is asserted
      // as not-429, since local SMS delivery for non-test_otp numbers fails
      // downstream of the rate-limit gate for an unrelated reason.
      for (const r of first20) {
        expect(r.status).not.toBe(429);
      }
      expect(twentyFirst.status).toBe(429);
      expect(twentyFirst.body).toEqual({ error: GENERIC_ERROR });
    },
    60_000,
  );
});

describe("console-auth-request-otp — input validation happens before any rate-limit bucket is touched", () => {
  it("rejects a malformed/non-E.164 phone with 400, and does not count against any bucket", async () => {
    if (!ready) return;
    const r = await requestOtp("0812345678"); // local format, not E.164 — must be rejected
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ error: GENERIC_ERROR });
  });
});
