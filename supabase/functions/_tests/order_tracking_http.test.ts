// WBS 5.10 — Customer Order Tracking (No Login): HTTP-layer coverage for
// public-order-status (supabase/functions/public-order-status/index.ts,
// git commit 2e78655), real `supabase functions serve` process, real
// Postgres behind it. Same posture as public_snapshots.test.ts's own header
// comment: hitting the served function over HTTP is what proves the real
// Deno runtime + real handler + real rate-limit RPC all cooperate, not a
// re-implementation of the routing/rate-limit logic.
//
// Owns:
//   - rate limiting (packages/db/migrations/0036_order_lookup_rate_limit.sql):
//     the phone+code branch caps at 20/hour/IP and actually 429s past that;
//     the code-only poll branch (what /o/[code] hits every 5s) is NOT
//     rate-limited, confirmed deliberately since over-limiting polling would
//     break the live status page for legitimate same-IP customers.
//   - enumeration at the HTTP boundary: a request carrying `phone` with no
//     `code` never reaches the database at all (400 before the rate-limit
//     check, before the RPC) — the strongest form of "never enumerates".
//   - RL-3 forbidden-substring scan of the actual camelCase JSON the
//     browser receives, across every terminal state, using this repo's own
//     docs/design/forbidden_fields.json + scripts/scan-forbidden-fields.mjs
//     (same mechanism supabase/functions/_tests/forbidden_field_scan.test.ts
//     already uses for the committed snapshot fixtures — reused directly
//     here against live response bodies rather than duplicating the list).
//
// SKIPS (not passes) if `supabase functions serve` isn't reachable — see
// public_snapshots.test.ts's header for the exact bring-up commands.
import { Client as PgClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// eslint-disable-next-line import/no-relative-packages
import { loadForbiddenSubstrings } from "../../../scripts/scan-forbidden-fields.mjs";
import { functionUrl, isFunctionReachable, LOCAL_ANON_KEY, serviceClient } from "./helpers/clients";

const LOCAL_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const FORBIDDEN_FIELDS_PATH = new URL("../../../docs/design/forbidden_fields.json", import.meta.url).pathname;

async function getRaw(query: string, extraHeaders?: Record<string, string>): Promise<{ status: number; text: string }> {
  const res = await fetch(`${functionUrl("public-order-status")}${query}`, {
    headers: { apikey: LOCAL_ANON_KEY, ...extraHeaders },
  });
  const text = await res.text();
  return { status: res.status, text };
}

function randomIp(): string {
  // A syntactically valid, definitely-not-real IPv4 in a private range,
  // unique per test run — see clientIp.ts's own looksLikeIp regex. Isolates
  // each describe block's rate-limit bucket from real traffic AND from any
  // other test run in the same hour (order_lookup_attempts buckets by
  // ip_hash, which this repo's extractClientIp derives from
  // x-forwarded-for — every host-machine caller with NO forwarded header at
  // all collapses onto a single "unknown" bucket, which is exactly the
  // collision this header sidesteps).
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

let ready = false;
const service = serviceClient();
let storeId: string;
let pg: PgClient;

// Unique per process run (not just per test) — order_code carries a real
// unique constraint (orders_order_code_key), and this file's earlier draft
// used a fixed codeSuffix per call site with no run-to-run uniqueness and no
// cleanup, so re-running the suite (or running it after an isolated single-
// file run) 23505'd on a leftover row from the previous run. RUN_ID plus an
// afterAll sweep below fixes both halves of that.
const RUN_ID = `${Date.now().toString(36)}${Math.floor(Math.random() * 1_000_000).toString(36)}`;
const insertedOrderIds: string[] = [];

async function insertOrder(opts: {
  status: string;
  phone: string | null;
  itemName: string;
  codeSuffix: string;
}): Promise<{ orderId: string; orderCode: string }> {
  const orderCode = `QAHTTP${RUN_ID}${opts.codeSuffix.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`
    .slice(0, 40)
    .toUpperCase();
  const { rows } = await pg.query(
    `insert into orders (store_id, order_code, customer_name, customer_phone, status, subtotal_satang, total_satang)
     values ($1, $2, 'QA HTTP Customer', $3, $4, 6500, 6500) returning id`,
    [storeId, orderCode, opts.phone, opts.status],
  );
  const orderId = rows[0].id as string;
  insertedOrderIds.push(orderId);
  await pg.query(
    `insert into order_items (order_id, store_id, item_name_snapshot, quantity, unit_price_snapshot_satang)
     values ($1, $2, $3, 1, 6500)`,
    [orderId, storeId, opts.itemName],
  );
  return { orderId, orderCode };
}

beforeAll(async () => {
  const reachable = await isFunctionReachable("public-order-status");
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[order_tracking_http.test.ts] SKIPPING — the local Edge Functions " +
        "server isn't serving public-order-status. Run `supabase start`, " +
        "`supabase db reset`, then `supabase functions serve --no-verify-jwt " +
        "--import-map supabase/functions/deno.json`. This is a SKIP, not a pass.\n",
    );
    return;
  }
  ready = true;

  const { data: store, error } = await service.from("stores").select("id").eq("slug", "demo-cafe").single();
  if (error || !store) {
    throw new Error(`[order_tracking_http.test.ts] demo-cafe store not found — has \`supabase db reset\` run? ${error?.message ?? ""}`);
  }
  storeId = store.id as string;

  pg = new PgClient({ connectionString: LOCAL_DB_URL });
  await pg.connect();
});

afterAll(async () => {
  if (!pg) return;
  if (insertedOrderIds.length > 0) {
    await pg.query(`delete from order_items where order_id = any($1::uuid[])`, [insertedOrderIds]);
    await pg.query(`delete from orders where id = any($1::uuid[])`, [insertedOrderIds]);
  }
  await pg.end();
});

// ---------------------------------------------------------------------------
// Enumeration at the HTTP boundary
// ---------------------------------------------------------------------------
describe("enumeration is blocked before the database is ever reached", () => {
  it("100 requests carrying `phone` with NO `code` param all 400 — never a 200, never a body containing order data", async () => {
    if (!ready) return;
    for (let i = 0; i < 100; i += 1) {
      const phone = `+668${String(30000000 + i).padStart(8, "0")}`;
      const { status, text } = await getRaw(`?phone=${encodeURIComponent(phone)}`);
      expect(status).toBe(400);
      expect(text).toBe(JSON.stringify({ error: "code is required" }));
    }
  });

  it("these 400s never consumed the phone+code rate-limit bucket (proof: a fresh IP still gets a full run of real phone+code lookups afterward)", async () => {
    if (!ready) return;
    const order = await insertOrder({
      status: "ACCEPTED",
      phone: "+66822220001",
      itemName: "QA Enum-Adjacent Latte",
      codeSuffix: "enumadj",
    });
    const ip = randomIp();
    // If the phone-only 400s above had consumed quota on a shared bucket,
    // this would 429 well before 5 requests on a brand-new IP.
    for (let i = 0; i < 5; i += 1) {
      const { status } = await getRaw(`?code=${order.orderCode}&phone=%2B66822220001`, { "x-forwarded-for": ip });
      expect(status).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// Rate limiting (migration 0036) — phone+code branch only
// ---------------------------------------------------------------------------
describe("rate limiting: phone+code branch caps at 20/hour/IP; code-only poll branch is exempt", () => {
  it("20 phone+code requests from one IP succeed; the 21st is 429", async () => {
    if (!ready) return;
    const order = await insertOrder({
      status: "ACCEPTED",
      phone: "+66822220002",
      itemName: "QA Rate Limit Latte",
      codeSuffix: "ratelimit",
    });
    const ip = randomIp();

    for (let i = 0; i < 20; i += 1) {
      const { status } = await getRaw(`?code=${order.orderCode}&phone=%2B66822220002`, { "x-forwarded-for": ip });
      expect(status).toBe(200);
    }

    const { status: status21, text: text21 } = await getRaw(
      `?code=${order.orderCode}&phone=%2B66822220002`,
      { "x-forwarded-for": ip },
    );
    expect(status21).toBe(429);
    expect(text21).toBe(JSON.stringify({ error: "too many attempts, try again later" }));
  }, 30_000);

  it("the 429 fires even for WRONG phone/code guesses — quota is consumed by attempt count, not by finding a match", async () => {
    if (!ready) return;
    const ip = randomIp();
    for (let i = 0; i < 20; i += 1) {
      const { status } = await getRaw(`?code=QA-NOPE-${i}&phone=%2B66800000000`, { "x-forwarded-for": ip });
      expect(status).toBe(200); // still 200 with an empty array — no match, but not rate-limited yet
    }
    const { status: status21 } = await getRaw(`?code=QA-NOPE-X&phone=%2B66800000000`, { "x-forwarded-for": ip });
    expect(status21).toBe(429);
  }, 30_000);

  it("a DIFFERENT IP is unaffected by another IP's exhausted quota (per-IP, not global)", async () => {
    if (!ready) return;
    const exhaustedIp = randomIp();
    for (let i = 0; i < 20; i += 1) {
      await getRaw(`?code=QA-BURN-${i}&phone=%2B66800000001`, { "x-forwarded-for": exhaustedIp });
    }
    const { status: exhaustedStatus } = await getRaw(`?code=QA-BURN-X&phone=%2B66800000001`, {
      "x-forwarded-for": exhaustedIp,
    });
    expect(exhaustedStatus).toBe(429);

    const freshIp = randomIp();
    const { status: freshStatus } = await getRaw(`?code=QA-FRESH&phone=%2B66800000002`, {
      "x-forwarded-for": freshIp,
    });
    expect(freshStatus).toBe(200);
  }, 30_000);

  it("the code-ONLY poll branch (no phone param — what /o/[code] polls every 5s) is never rate-limited, even after 30 rapid requests from the same IP", async () => {
    if (!ready) return;
    const order = await insertOrder({
      status: "ACCEPTED",
      phone: "+66822220003",
      itemName: "QA Poll Latte",
      codeSuffix: "pollnolimit",
    });
    const ip = randomIp();
    for (let i = 0; i < 30; i += 1) {
      const { status } = await getRaw(`?code=${order.orderCode}`, { "x-forwarded-for": ip });
      expect(status).toBe(200);
    }
  }, 30_000);

  it("an IP that has exhausted the phone+code branch's quota can still poll the code-only branch freely from the SAME IP (independent buckets)", async () => {
    if (!ready) return;
    const order = await insertOrder({
      status: "ACCEPTED",
      phone: "+66822220004",
      itemName: "QA Mixed Branch Latte",
      codeSuffix: "mixedbranch",
    });
    const ip = randomIp();

    for (let i = 0; i < 20; i += 1) {
      await getRaw(`?code=${order.orderCode}&phone=%2B66822220004`, { "x-forwarded-for": ip });
    }
    const { status: exhausted } = await getRaw(`?code=${order.orderCode}&phone=%2B66822220004`, {
      "x-forwarded-for": ip,
    });
    expect(exhausted).toBe(429);

    // Same IP, code-only branch — must still succeed.
    const { status: pollStatus } = await getRaw(`?code=${order.orderCode}`, { "x-forwarded-for": ip });
    expect(pollStatus).toBe(200);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// RL-3 forbidden-substring scan across every terminal state's live response
// ---------------------------------------------------------------------------
describe("RL-3: every terminal state's live HTTP response is clean against docs/design/forbidden_fields.json", () => {
  const STATUSES = [
    "PENDING_PAYMENT",
    "ACCEPTED",
    "PREPARING",
    "READY",
    "COLLECTED",
    "CANCELLED",
    "REFUNDED",
    "EXPIRED",
  ] as const;

  const ordersByStatus = new Map<string, { orderId: string; orderCode: string }>();

  beforeAll(async () => {
    if (!ready) return;
    for (const status of STATUSES) {
      const fixture = await insertOrder({
        status,
        phone: "+66822229999",
        itemName: `QA RL3 ${status}`,
        codeSuffix: `rl3-${status}`,
      });
      ordersByStatus.set(status, fixture);
    }
  });

  it.each(STATUSES)("status=%s: response body contains none of the forbidden substrings, and has exactly the allow-listed keys", async (status) => {
    if (!ready) return;
    const forbidden = loadForbiddenSubstrings(FORBIDDEN_FIELDS_PATH);
    const fixture = ordersByStatus.get(status)!;
    const { status: httpStatus, text } = await getRaw(`?code=${fixture.orderCode}`);
    expect(httpStatus).toBe(200);

    for (const substring of forbidden) {
      expect(text.includes(substring)).toBe(false);
    }

    const body = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(body.length).toBeGreaterThan(0);
    for (const row of body) {
      expect(Object.keys(row).sort()).toEqual(["itemName", "orderCode", "pickupAt", "quantity", "status"]);
    }
    expect(body[0].status).toBe(status);
  });

  it("sanity: the scanner actually detects a planted forbidden substring (proves the negative assertions above aren't vacuous)", async () => {
    const forbidden = loadForbiddenSubstrings(FORBIDDEN_FIELDS_PATH);
    expect(forbidden.length).toBeGreaterThan(0);
    const plantedResponse = JSON.stringify([{ orderCode: "X", status: "READY", cost_satang: 1800 }]);
    const hit = forbidden.some((s: string) => plantedResponse.includes(s));
    expect(hit).toBe(true);
  });
});
