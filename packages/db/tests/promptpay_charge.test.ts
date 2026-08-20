// WBS 5.5 qa_engineer leg — create_payment_charge (packages/db/migrations/
// 0030_promptpay_charge.sql), the RPC public-create-charge's Edge Function
// calls to persist a PromptPay QR issuance.
//
// packages/shared/src/promptpay/conformance.test.ts (engineer-authored, WBS
// 5.5) already covers the pure payload builder end to end: tag 29 payee
// decode, an independent CRC-16/CCITT-FALSE reimplementation, golden-file
// byte comparison, and a suite-level forbidden-payee scan. None of that
// touches the RPC or the Edge Function, which is this file's job — same
// "RLS/triggers/constraints only exist in the database, a mock proves
// nothing" posture as checkout_create_order.test.ts (WBS 5.4) and
// pickup_slots.test.ts (WBS 5.3), and the same direct-`pg.Client`-against-
// the-service_role-only-function technique those two files use.
//
// Environment note (same limitation checkout_create_order.test.ts's own
// header documents): this sandbox's local Supabase stack runs db/auth/kong/
// storage healthy but has no edge-runtime container, so `supabase functions
// serve` is unavailable and supabase/functions/public-create-charge/
// index.ts's own HTTP status-code branches (404 ORDER_NOT_FOUND, 409
// ORDER_NOT_PAYABLE, 409 STORE_NOT_VERIFIED, 201) are NOT independently
// exercised over HTTP here. What IS exercised, directly and rigorously, is
// the RPC every one of those branches is built on: each zero-row case below
// is exactly the condition the Edge Function turns into a 409, proven at the
// layer the guard logic actually lives in. This is a real gap, not a
// silently skipped one — flagging it explicitly rather than inventing a
// bespoke HTTP harness for a single thin wrapper (index.ts has no branching
// logic of its own beyond this RPC call plus the two guards already covered
// here).
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, isReachable, LOCAL_DB_URL, withRollback } from "./helpers/db";

let dbAvailable = false;
let authUserId: string | undefined;
let merchantId: string | undefined;
let verifiedStoreId: string | undefined;
let unverifiedStoreId: string | undefined; // promptpay_id AND promptpay_verified_at both null

const VERIFIED_STORE_PROMPTPAY_ID = "0891234567";

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[promptpay_charge.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` (and \`supabase migration up\` ` +
        "if the stack predates migration 0030) first. This is a SKIP, not a pass.\n",
    );
    return;
  }

  const client = await connect();
  try {
    authUserId = randomUUID();
    const phone = `+66902${Math.floor(Math.random() * 900000 + 100000)}`;
    await client.query(
      `insert into auth.users (
         instance_id, id, aud, role, phone, phone_confirmed_at,
         confirmation_token, recovery_token, email_change_token_new, email_change,
         raw_app_meta_data, raw_user_meta_data, created_at, updated_at
       ) values (
         '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
         '', '', '', '',
         '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()
       )`,
      [authUserId, phone],
    );
    const merchantResult = await client.query<{ id: string }>(
      `insert into merchants (id, auth_user_id, phone, subscription_tier)
       values (gen_random_uuid(), $1, $2, 'free')
       on conflict (auth_user_id) do update set phone = excluded.phone
       returning id`,
      [authUserId, phone],
    );
    merchantId = merchantResult.rows[0].id;

    const verifiedResult = await client.query<{ id: string }>(
      `insert into stores (
         merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity,
         promptpay_id, promptpay_type, promptpay_verified_at, is_published
       )
       values ($1, $2, 'QA 5.5 Verified Store', '07:00', '19:00', 'Asia/Bangkok', 3, $3, 'msisdn', now(), true)
       returning id`,
      [merchantId, `qa-5-5-verified-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`, VERIFIED_STORE_PROMPTPAY_ID],
    );
    verifiedStoreId = verifiedResult.rows[0].id;

    const unverifiedResult = await client.query<{ id: string }>(
      `insert into stores (merchant_id, slug, name)
       values ($1, $2, 'QA 5.5 Unverified Store')
       returning id`,
      [merchantId, `qa-5-5-unverified-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`],
    );
    unverifiedStoreId = unverifiedResult.rows[0].id;
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  if (!dbAvailable || !authUserId) return;
  const client = await connect();
  try {
    // Cascades merchants -> stores -> orders -> payments, same as
    // checkout_create_order.test.ts / pickup_slots.test.ts's cleanup.
    await client.query("delete from auth.users where id = $1", [authUserId]);
  } finally {
    await client.end();
  }
});

let orderCodeCounter = 0;
function nextOrderCode(prefix: string): string {
  orderCodeCounter += 1;
  return `${prefix}${orderCodeCounter}`.slice(0, 40);
}

async function insertOrder(
  client: Client,
  opts: { storeId: string; status: string; totalSatang: number; orderCode?: string },
): Promise<{ id: string; orderCode: string }> {
  const orderCode = opts.orderCode ?? nextOrderCode("QA55");
  const { rows } = await client.query<{ id: string }>(
    `insert into orders (store_id, order_code, customer_name, subtotal_satang, total_satang, status)
     values ($1, $2, 'QA 5.5 Customer', $3, $3, $4)
     returning id`,
    [opts.storeId, orderCode, opts.totalSatang, opts.status],
  );
  return { id: rows[0].id, orderCode };
}

interface ChargeRow {
  id: string;
  order_id: string;
  amount_satang: number;
  expires_at: string;
  status: string;
}

async function callCreatePaymentCharge(client: Client, orderCode: string, qrPayload: string): Promise<ChargeRow[]> {
  const { rows } = await client.query<ChargeRow>(
    "select * from create_payment_charge($1, $2)",
    [orderCode, qrPayload],
  );
  return rows;
}

describe("WBS 5.5 — create_payment_charge: guard conditions, each in isolation", () => {
  it("order code that does not exist -> zero rows, no payments row inserted anywhere", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const rows = await callCreatePaymentCharge(client, "QA55-DOES-NOT-EXIST", "dummy-payload");
      expect(rows).toHaveLength(0);

      const { rows: paymentsRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from payments where qr_payload = 'dummy-payload'",
      );
      expect(Number(paymentsRows[0].n)).toBe(0);
    });
  });

  it("order status ACCEPTED (already confirmed) -> zero rows, no payments row inserted", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      if (!verifiedStoreId) throw new Error("verifiedStoreId fixture missing");
      const order = await insertOrder(client, { storeId: verifiedStoreId, status: "ACCEPTED", totalSatang: 6500 });

      const rows = await callCreatePaymentCharge(client, order.orderCode, "payload-accepted");
      expect(rows).toHaveLength(0);

      const { rows: paymentsRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from payments where order_id = $1",
        [order.id],
      );
      expect(Number(paymentsRows[0].n)).toBe(0);
    });
  });

  it("order status EXPIRED -> zero rows, no payments row inserted", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      if (!verifiedStoreId) throw new Error("verifiedStoreId fixture missing");
      const order = await insertOrder(client, { storeId: verifiedStoreId, status: "EXPIRED", totalSatang: 6500 });

      const rows = await callCreatePaymentCharge(client, order.orderCode, "payload-expired");
      expect(rows).toHaveLength(0);

      const { rows: paymentsRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from payments where order_id = $1",
        [order.id],
      );
      expect(Number(paymentsRows[0].n)).toBe(0);
    });
  });

  it("order status CANCELLED -> zero rows, no payments row inserted", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      if (!verifiedStoreId) throw new Error("verifiedStoreId fixture missing");
      const order = await insertOrder(client, { storeId: verifiedStoreId, status: "CANCELLED", totalSatang: 6500 });

      const rows = await callCreatePaymentCharge(client, order.orderCode, "payload-cancelled");
      expect(rows).toHaveLength(0);

      const { rows: paymentsRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from payments where order_id = $1",
        [order.id],
      );
      expect(Number(paymentsRows[0].n)).toBe(0);
    });
  });

  it("store with promptpay_id null (never configured) -> zero rows even though the order itself is PENDING_PAYMENT", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      if (!unverifiedStoreId) throw new Error("unverifiedStoreId fixture missing");
      const order = await insertOrder(client, { storeId: unverifiedStoreId, status: "PENDING_PAYMENT", totalSatang: 6500 });

      const rows = await callCreatePaymentCharge(client, order.orderCode, "payload-unconfigured");
      expect(rows).toHaveLength(0);

      const { rows: paymentsRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from payments where order_id = $1",
        [order.id],
      );
      expect(Number(paymentsRows[0].n)).toBe(0);
    });
  });

  it("store with promptpay_id SET but promptpay_verified_at null (unverified, not merely unconfigured) -> zero rows -- never issue a QR for an unverified store (RL-1)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const { rows: storeRows } = await client.query<{ id: string }>(
        `insert into stores (merchant_id, slug, name, promptpay_id, promptpay_type, promptpay_verified_at)
         values ($1, $2, 'QA 5.5 Set-But-Unverified Store', '0899998888', 'msisdn', null)
         returning id`,
        [merchantId, `qa-5-5-set-unverified-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`],
      );
      const order = await insertOrder(client, { storeId: storeRows[0].id, status: "PENDING_PAYMENT", totalSatang: 6500 });

      const rows = await callCreatePaymentCharge(client, order.orderCode, "payload-set-but-unverified");
      expect(rows).toHaveLength(0);

      const { rows: paymentsRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from payments where order_id = $1",
        [order.id],
      );
      expect(Number(paymentsRows[0].n)).toBe(0);
    });
  });

  it("positive control: order PENDING_PAYMENT + store fully verified -> succeeds -- proves the zero-row cases above are the guard firing, not the function being broken", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      if (!verifiedStoreId) throw new Error("verifiedStoreId fixture missing");
      const order = await insertOrder(client, { storeId: verifiedStoreId, status: "PENDING_PAYMENT", totalSatang: 6500 });

      const rows = await callCreatePaymentCharge(client, order.orderCode, "payload-happy-path");
      expect(rows).toHaveLength(1);
      expect(rows[0].order_id).toBe(order.id);
      expect(rows[0].amount_satang).toBe(6500);
      expect(rows[0].status).toBe("pending");

      const { rows: paymentsRows } = await client.query<{
        payee_alias: string;
        method: string;
        qr_payload: string;
        amount_satang: number;
      }>(
        "select payee_alias, method, qr_payload, amount_satang from payments where order_id = $1",
        [order.id],
      );
      expect(paymentsRows).toHaveLength(1);
      expect(paymentsRows[0].method).toBe("promptpay_direct");
      expect(paymentsRows[0].qr_payload).toBe("payload-happy-path");
      // amount_satang is read fresh from orders.total_satang inside the RPC
      // (no amount parameter exists on create_payment_charge at all), so
      // this also proves a client can never smuggle in an arbitrary amount.
      expect(paymentsRows[0].amount_satang).toBe(6500);
      // RL-1 evidence: the persisted payee is the STORE's own alias, never
      // any Brew Ledger identifier.
      expect(paymentsRows[0].payee_alias).toBe(VERIFIED_STORE_PROMPTPAY_ID);
    });
  });

  it("expires_at on the returned/persisted row is a fresh ~15-minute countdown from now(), not derived from orders.expires_at", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      if (!verifiedStoreId) throw new Error("verifiedStoreId fixture missing");
      const order = await insertOrder(client, { storeId: verifiedStoreId, status: "PENDING_PAYMENT", totalSatang: 100 });

      const before = Date.now();
      const rows = await callCreatePaymentCharge(client, order.orderCode, "payload-expiry-check");
      const after = Date.now();

      expect(rows).toHaveLength(1);
      const expiresAtMs = new Date(rows[0].expires_at).getTime();
      const fifteenMin = 15 * 60 * 1000;
      // Allow a small tolerance window around exactly now()+15min.
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + fifteenMin - 5000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + fifteenMin + 5000);
    });
  });
});

describe("WBS 5.5 — create_payment_charge: append-only reissue (\"ขอ QR ใหม่\")", () => {
  it("calling the RPC twice for the SAME still-PENDING_PAYMENT order succeeds both times and inserts two distinct payments rows, not an upsert", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      if (!verifiedStoreId) throw new Error("verifiedStoreId fixture missing");
      const order = await insertOrder(client, { storeId: verifiedStoreId, status: "PENDING_PAYMENT", totalSatang: 4200 });

      const first = await callCreatePaymentCharge(client, order.orderCode, "payload-issue-1");
      expect(first).toHaveLength(1);

      const second = await callCreatePaymentCharge(client, order.orderCode, "payload-reissue-2");
      expect(second).toHaveLength(1);

      // Distinct payment ids -- proves this is an INSERT, not an UPDATE
      // keyed on order_id (there is deliberately no unique constraint on
      // payments.order_id; see 0030's own header comment).
      expect(first[0].id).not.toBe(second[0].id);
      expect(first[0].order_id).toBe(order.id);
      expect(second[0].order_id).toBe(order.id);

      const { rows: allPayments } = await client.query<{ id: string; qr_payload: string }>(
        "select id, qr_payload from payments where order_id = $1 order by created_at asc",
        [order.id],
      );
      expect(allPayments).toHaveLength(2); // both rows persist -- neither was overwritten
      expect(allPayments.map((r) => r.qr_payload)).toEqual(["payload-issue-1", "payload-reissue-2"]);
    });
  });

  it("a third reissue on the same order still succeeds, inserting a third distinct row (proves the pattern holds beyond just twice)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      if (!verifiedStoreId) throw new Error("verifiedStoreId fixture missing");
      const order = await insertOrder(client, { storeId: verifiedStoreId, status: "PENDING_PAYMENT", totalSatang: 4200 });

      const one = await callCreatePaymentCharge(client, order.orderCode, "payload-a");
      const two = await callCreatePaymentCharge(client, order.orderCode, "payload-b");
      const three = await callCreatePaymentCharge(client, order.orderCode, "payload-c");

      const ids = new Set([one[0].id, two[0].id, three[0].id]);
      expect(ids.size).toBe(3);

      const { rows } = await client.query<{ n: string }>(
        "select count(*)::int as n from payments where order_id = $1",
        [order.id],
      );
      expect(Number(rows[0].n)).toBe(3);
    });
  });
});

describe("WBS 5.5 — create_payment_charge: function-level grants", () => {
  it("create_payment_charge is service_role-only -- anon and authenticated cannot execute it, same posture as reserve_pickup_slot/checkout_create_order", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query<{
        anon_can_call: boolean;
        authenticated_can_call: boolean;
        service_role_can_call: boolean;
      }>(
        `select
           has_function_privilege('anon', 'create_payment_charge(text, text)', 'execute') as anon_can_call,
           has_function_privilege('authenticated', 'create_payment_charge(text, text)', 'execute') as authenticated_can_call,
           has_function_privilege('service_role', 'create_payment_charge(text, text)', 'execute') as service_role_can_call`,
      );
      expect(rows[0]).toEqual({
        anon_can_call: false,
        authenticated_can_call: false,
        service_role_can_call: true,
      });
    } finally {
      await client.end();
    }
  });
});
