// WBS 5.6 qa_engineer leg — expiry sweep (worker/src/handlers/expireOrders.ts).
//
// This is the ONE WBS 5.6 Testing-block scenario that lives outside
// packages/db/tests/payment_confirmation.test.ts, because the sweep is a
// worker/ handler, not a Postgres function — it opens its own transaction
// on worker/src/db.ts's `pool` and self-perpetuates by re-enqueueing its
// own next run into job_queue.
//
// worker/ had NO test infrastructure before this file (no vitest devDep, no
// "test" script) — added alongside this file, mirroring packages/db's own
// bare `vitest run` setup (no vitest.config.ts there either). See
// worker/package.json.
//
// worker/src/db.ts calls loadWorkerConfig() (packages/shared/src/config.ts)
// SYNCHRONOUSLY at module load, which throws if SUPABASE_URL /
// SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL are unset — so those are set on
// process.env BEFORE the handler module is ever imported, via a dynamic
// import() inside beforeAll (a static top-of-file `import` would be hoisted
// above any process.env assignment in this same file and blow up before
// dbAvailable can even be checked). Values are the well-known local
// `supabase start` demo defaults, same ones packages/db/tests/helpers/
// supabase-clients.ts documents and uses.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "../src/handlers/types";

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

let dbAvailable = false;
let expireOrders: (job: Job) => Promise<void>;
let pool: import("pg").Pool;

let authUserId: string;
let merchantId: string;
let storeId: string;

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[expireOrders.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` first. This is a SKIP, not a pass.\n`,
    );
    return;
  }

  process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_DB_URL;

  const dbModule = await import("../src/db");
  const handlerModule = await import("../src/handlers/expireOrders");
  pool = dbModule.pool;
  expireOrders = handlerModule.expireOrders;

  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  try {
    authUserId = randomUUID();
    const phone = `+66903${Math.floor(Math.random() * 900000 + 100000)}`;
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
    // WBS 4.1's on_auth_user_created_provision_merchant trigger already
    // inserted a merchants row for authUserId -- upsert, same shape as
    // packages/db/tests/pickup_slots.test.ts's own fixture.
    const merchantResult = await client.query<{ id: string }>(
      `insert into merchants (id, auth_user_id, phone, subscription_tier)
       values (gen_random_uuid(), $1, $2, 'free')
       on conflict (auth_user_id) do update set phone = excluded.phone
       returning id`,
      [authUserId, phone],
    );
    merchantId = merchantResult.rows[0].id;

    const storeResult = await client.query<{ id: string }>(
      `insert into stores (merchant_id, slug, name) values ($1, $2, 'QA 5.6 Worker Store') returning id`,
      [merchantId, `qa-5-6-worker-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`],
    );
    storeId = storeResult.rows[0].id;
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  if (dbAvailable && authUserId) {
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      // Cascades merchants -> stores -> pickup_slots/orders. job_queue rows
      // created by real orders (store_id set) cascade too; the sweep's own
      // self-perpetuating next-run row (store_id NULL by construction,
      // worker/src/handlers/expireOrders.ts) is deleted explicitly inside
      // the test that produces it.
      //
      // WBS 5.7 regression note: expireOrders.ts now calls transition_order
      // per row (0032/§6), so every EXPIRED order here has a committed
      // order_status_history row by the time this runs. 0034 fixed the
      // append-only trigger to exempt cascade-originated UPDATE/DELETE
      // (pg_trigger_depth() > 1) and made order_status_history_order_id_fkey
      // deferrable to resolve a cascade ordering hazard between that FK and
      // the actor -> merchants ON DELETE SET NULL path — a plain cascading
      // delete now works.
      await client.query("delete from auth.users where id = $1", [authUserId]);
    } finally {
      await client.end();
    }
  }
  if (pool) await pool.end();
});

async function insertSlot(client: Client, opts: { capacity: number; bookedCount: number }): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
     values ($1, now() + interval '1 hour', now() + interval '2 hours', $2::int, $3::int, ($3::int < $2::int))
     returning id`,
    [storeId, opts.capacity, opts.bookedCount],
  );
  return rows[0].id;
}

async function insertOrder(
  client: Client,
  opts: { pickupSlotId: string; expiresAt: string; status?: string },
): Promise<string> {
  const orderCode = `W${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
  const { rows } = await client.query<{ id: string }>(
    `insert into orders (store_id, order_code, customer_name, pickup_slot_id, status, subtotal_satang, total_satang, expires_at)
     values ($1, $2, 'QA 5.6 Worker Customer', $3, $4, 5000, 5000, now() + ($5)::interval)
     returning id`,
    [storeId, orderCode, opts.pickupSlotId, opts.status ?? "PENDING_PAYMENT", opts.expiresAt],
  );
  return rows[0].id;
}

function fakeJob(): Job {
  return { id: randomUUID(), store_id: null, job_type: "expire_orders", payload: {}, attempts: 0 };
}

describe("WBS 5.6 — worker expireOrders: expiry sweep releases the slot", () => {
  it("REQUIRED: an unpaid order past expires_at moves to EXPIRED and its slot becomes available again", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      const slot = await insertSlot(client, { capacity: 1, bookedCount: 1 }); // held, is_open=false
      const expiredOrderId = await insertOrder(client, { pickupSlotId: slot, expiresAt: "-1 minute" }); // already past

      const { rows: before } = await client.query<{ booked_count: number; is_open: boolean }>(
        "select booked_count, is_open from pickup_slots where id = $1",
        [slot],
      );
      expect(before[0].booked_count).toBe(1);
      expect(before[0].is_open).toBe(false);

      await expireOrders(fakeJob());

      const { rows: orderAfter } = await client.query<{ status: string }>(
        "select status from orders where id = $1",
        [expiredOrderId],
      );
      expect(orderAfter[0].status).toBe("EXPIRED");

      // "reappears for customers": booked_count decremented and the slot
      // reopened — the same held/available state anon_read_open_pickup_slots
      // (0021_rls.sql) and public-slots key off of.
      const { rows: slotAfter } = await client.query<{ booked_count: number; is_open: boolean }>(
        "select booked_count, is_open from pickup_slots where id = $1",
        [slot],
      );
      expect(slotAfter[0].booked_count).toBe(0);
      expect(slotAfter[0].is_open).toBe(true);
    } finally {
      // The sweep's own self-perpetuating next-run row (store_id NULL —
      // never cascaded by the merchant cleanup above).
      await client.query(`delete from job_queue where job_type = 'expire_orders' and store_id is null`);
      await client.end();
    }
  });

  it("an order NOT yet past its window is left untouched (selectivity, not a blanket sweep)", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      const slot = await insertSlot(client, { capacity: 1, bookedCount: 1 });
      const stillPendingOrderId = await insertOrder(client, { pickupSlotId: slot, expiresAt: "+15 minutes" });

      await expireOrders(fakeJob());

      const { rows: orderAfter } = await client.query<{ status: string }>(
        "select status from orders where id = $1",
        [stillPendingOrderId],
      );
      expect(orderAfter[0].status).toBe("PENDING_PAYMENT"); // untouched

      const { rows: slotAfter } = await client.query<{ booked_count: number; is_open: boolean }>(
        "select booked_count, is_open from pickup_slots where id = $1",
        [slot],
      );
      expect(slotAfter[0].booked_count).toBe(1); // still held
      expect(slotAfter[0].is_open).toBe(false);
    } finally {
      await client.query(`delete from job_queue where job_type = 'expire_orders' and store_id is null`);
      await client.end();
    }
  });

  it("an order already CONFIRMED (ACCEPTED) past its old expires_at is left alone — a merchant's confirm between sweeps wins, no race", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      const slot = await insertSlot(client, { capacity: 1, bookedCount: 1 });
      const acceptedOrderId = await insertOrder(client, {
        pickupSlotId: slot,
        expiresAt: "-1 minute",
        status: "ACCEPTED",
      });

      await expireOrders(fakeJob());

      const { rows: orderAfter } = await client.query<{ status: string }>(
        "select status from orders where id = $1",
        [acceptedOrderId],
      );
      expect(orderAfter[0].status).toBe("ACCEPTED"); // the sweep's WHERE clause only matches PENDING_PAYMENT

      const { rows: slotAfter } = await client.query<{ booked_count: number }>(
        "select booked_count from pickup_slots where id = $1",
        [slot],
      );
      expect(slotAfter[0].booked_count).toBe(1); // NOT released — the confirmed order still holds it
    } finally {
      await client.query(`delete from job_queue where job_type = 'expire_orders' and store_id is null`);
      await client.end();
    }
  });

  it("the sweep is self-perpetuating: exactly one fresh 'expire_orders' job is enqueued ~1 minute out per run", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      await client.query(`delete from job_queue where job_type = 'expire_orders' and store_id is null`);

      await expireOrders(fakeJob());

      const { rows } = await client.query<{ n: string; run_after: Date }>(
        `select count(*)::int as n, min(run_after) as run_after
           from job_queue
          where job_type = 'expire_orders' and store_id is null and status = 'pending'`,
      );
      expect(Number(rows[0].n)).toBe(1);
      const deltaMs = new Date(rows[0].run_after).getTime() - Date.now();
      expect(deltaMs).toBeGreaterThan(30_000); // ~1 minute out, comfortably more than 30s
      expect(deltaMs).toBeLessThan(90_000); // and comfortably less than 90s
    } finally {
      await client.query(`delete from job_queue where job_type = 'expire_orders' and store_id is null`);
      await client.end();
    }
  });
});
