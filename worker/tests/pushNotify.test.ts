// WBS 5.8 — worker push_notify handler (worker/src/handlers/pushNotify.ts).
//
// Follows expireOrders.test.ts's own shape exactly: real local Postgres
// (skip, not fail, if unreachable), env vars set on process.env BEFORE any
// dynamic import of the handler/db modules (loadWorkerConfig() runs
// synchronously at db.ts's module load). web-push itself is mocked — this
// suite proves the handler's OWN behaviour (which kind it acts on, which
// subscriptions it reads, that a 410 deletes the row, that other errors
// don't), not that a real push service accepts a real request.
import { randomUUID, createECDH } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../src/handlers/types";

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();
vi.mock("web-push", () => ({
  default: { sendNotification: (...args: unknown[]) => sendNotification(...args), setVapidDetails: (...args: unknown[]) => setVapidDetails(...args) },
}));

const LOCAL_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function isReachable(): Promise<boolean> {
  const client = new Client({ connectionString: LOCAL_DB_URL });
  try {
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}

// A real P-256 private scalar so derivePublicKeyFromPrivateKey's ECDH call
// doesn't throw on malformed input — the VAPID key's actual validity is not
// what this suite tests (web-push itself is mocked out).
function generateVapidPrivateKeyB64Url(): string {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return ecdh.getPrivateKey().toString("base64url");
}

let dbAvailable = false;
let pushNotify: (job: Job) => Promise<void>;
let pool: import("pg").Pool;

let authUserId: string;
let merchantId: string;
let storeId: string;
let orderId: string;

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[pushNotify.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` first. This is a SKIP, not a pass.\n`,
    );
    return;
  }

  process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_DB_URL;
  process.env.VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? generateVapidPrivateKeyB64Url();

  const dbModule = await import("../src/db");
  const handlerModule = await import("../src/handlers/pushNotify");
  pool = dbModule.pool;
  pushNotify = handlerModule.pushNotify;

  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  try {
    authUserId = randomUUID();
    const phone = `+66904${Math.floor(Math.random() * 900000 + 100000)}`;
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

    const storeResult = await client.query<{ id: string }>(
      `insert into stores (merchant_id, slug, name) values ($1, $2, 'QA 5.8 Worker Store') returning id`,
      [merchantId, `qa-5-8-worker-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`],
    );
    storeId = storeResult.rows[0].id;

    const orderResult = await client.query<{ id: string }>(
      `insert into orders (store_id, order_code, customer_name, status, subtotal_satang, total_satang)
       values ($1, 'W00001', 'QA 5.8 Customer', 'ACCEPTED', 6000, 6000)
       returning id`,
      [storeId],
    );
    orderId = orderResult.rows[0].id;
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  if (dbAvailable && authUserId) {
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      await client.query("delete from auth.users where id = $1", [authUserId]);
    } finally {
      await client.end();
    }
  }
  if (pool) await pool.end();
});

beforeEach(() => {
  sendNotification.mockReset();
  setVapidDetails.mockReset();
});

function fakeJob(overrides: Partial<Job>): Job {
  return { id: randomUUID(), store_id: storeId, job_type: "push_notify", payload: {}, attempts: 0, ...overrides };
}

async function insertSubscription(endpoint: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `insert into push_subscriptions (store_id, endpoint, p256dh, auth_key)
     values ($1, $2, 'fake-p256dh', 'fake-auth')
     returning id`,
    [storeId, endpoint],
  );
  return rows[0].id;
}

describe("WBS 5.8 — worker pushNotify", () => {
  it("REQUIRED: kind other than 'merchant_new_order' is a no-op — never calls web-push", async () => {
    if (!dbAvailable) return;
    const subId = await insertSubscription(`https://push.example/${randomUUID()}`);

    try {
      await pushNotify(fakeJob({ payload: { orderId, kind: "customer_status_update" } }));
      expect(sendNotification).not.toHaveBeenCalled();
    } finally {
      // Real DB, shared across this file's tests — an uncleaned row here
      // would otherwise inflate the NEXT test's subscription count (this
      // regressed the 410 test below when first written: it saw 3 sends,
      // not 2, because this row was still sitting in push_subscriptions).
      await pool.query(`delete from push_subscriptions where id = $1`, [subId]);
    }
  });

  it("REQUIRED: a 410 from the push service deletes that subscription row, and only that one", async () => {
    if (!dbAvailable) return;
    const deadEndpoint = `https://push.example/dead-${randomUUID()}`;
    const liveEndpoint = `https://push.example/live-${randomUUID()}`;
    const deadId = await insertSubscription(deadEndpoint);
    const liveId = await insertSubscription(liveEndpoint);

    sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint === deadEndpoint) {
        const err = new Error("Gone") as Error & { statusCode: number };
        err.statusCode = 410;
        throw err;
      }
      return { statusCode: 201 };
    });

    try {
      await pushNotify(fakeJob({ payload: { orderId, kind: "merchant_new_order" } }));

      const { rows } = await pool.query<{ id: string }>(
        `select id from push_subscriptions where id = any($1::uuid[])`,
        [[deadId, liveId]],
      );
      const remainingIds = rows.map((r) => r.id);
      expect(remainingIds).not.toContain(deadId);
      expect(remainingIds).toContain(liveId);
      expect(sendNotification).toHaveBeenCalledTimes(2);
    } finally {
      await pool.query(`delete from push_subscriptions where id = $1`, [liveId]);
    }
  });

  it("a non-410/404 send failure is logged and skipped, not thrown — one bad subscription must not fail the job", async () => {
    if (!dbAvailable) return;
    const flakyEndpoint = `https://push.example/flaky-${randomUUID()}`;
    const flakyId = await insertSubscription(flakyEndpoint);

    sendNotification.mockRejectedValue(new Error("ECONNRESET"));

    try {
      await expect(
        pushNotify(fakeJob({ payload: { orderId, kind: "merchant_new_order" } })),
      ).resolves.toBeUndefined();

      const { rows } = await pool.query<{ id: string }>(
        `select id from push_subscriptions where id = $1`,
        [flakyId],
      );
      expect(rows).toHaveLength(1); // NOT deleted — only 404/410 deletes
    } finally {
      await pool.query(`delete from push_subscriptions where id = $1`, [flakyId]);
    }
  });

  it("no subscriptions for the store is a silent no-op, not an error", async () => {
    if (!dbAvailable) return;
    await expect(
      pushNotify(fakeJob({ payload: { orderId, kind: "merchant_new_order" } })),
    ).resolves.toBeUndefined();
    expect(sendNotification).not.toHaveBeenCalled();
  });
});
