// WBS 7.5 qa_engineer leg — nightly daily_aggregate job
// (worker/src/handlers/dailyAggregate.ts).
//
// Real Postgres, same posture as expireOrders.test.ts (WBS 5.6): a real
// aggregation SQL statement and a real immutability guarantee live in the
// database, not in a mock. Skips (does not pass) if no local Postgres is
// reachable.
//
// aggregateStore() is not exported — it is only reachable through the
// dailyAggregate(job) handler, which always targets "yesterday" relative to
// the real clock (previousBusinessDateBoundsUtc(timezone), computed from
// `now()` — there is no date parameter on the job). So every fixture order
// here is inserted with an explicit created_at inside *yesterday's*
// Asia/Bangkok business-date window, computed via the same
// previousBusinessDateBoundsUtc helper the handler itself uses.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "../src/handlers/types";
import { previousBusinessDateBoundsUtc } from "../src/businessDate";

const LOCAL_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TIMEZONE = "Asia/Bangkok";
const REVENUE_STATUSES = ["ACCEPTED", "PREPARING", "READY", "COLLECTED"];

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
let dailyAggregate: (job: Job) => Promise<void>;

let authUserId: string;
let merchantId: string;
let storeId: string;

const YESTERDAY = previousBusinessDateBoundsUtc(TIMEZONE);

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[dailyAggregate.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` first. This is a SKIP, not a pass.\n`,
    );
    return;
  }

  process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_DB_URL;

  const handlerModule = await import("../src/handlers/dailyAggregate");
  dailyAggregate = handlerModule.dailyAggregate;

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
      `insert into stores (merchant_id, slug, name, timezone) values ($1, $2, 'QA 7.5 Worker Store', $3) returning id`,
      [merchantId, `qa-7-5-worker-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`, TIMEZONE],
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
      await client.query("delete from auth.users where id = $1", [authUserId]);
    } finally {
      await client.end();
    }
  }
});

async function cleanupJobQueue(client: Client): Promise<void> {
  await client.query(`delete from job_queue where job_type = 'daily_aggregate' and store_id is null`);
}

async function insertOrderWithItems(
  client: Client,
  opts: {
    status: string;
    channel?: "online" | "cash";
    totalSatang: number;
    items: Array<{ qty: number; priceSatang: number; costSatang: number | null }>;
  },
): Promise<string> {
  const orderCode = `Y${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
  // Placed comfortably inside yesterday's business-date window, per the
  // store's own timezone (not "now() - 1 day", which could straddle the
  // boundary depending on wall-clock time at test-run).
  const createdAt = new Date(YESTERDAY.startUtc.getTime() + 12 * 60 * 60 * 1000); // yesterday, local noon
  const { rows } = await client.query<{ id: string }>(
    `insert into orders (store_id, order_code, customer_name, channel, status, subtotal_satang, total_satang, created_at)
     values ($1, $2, 'QA 7.5 Customer', $3, $4, $5, $5, $6)
     returning id`,
    [storeId, orderCode, opts.channel ?? "online", opts.status, opts.totalSatang, createdAt.toISOString()],
  );
  const orderId = rows[0].id;
  for (const item of opts.items) {
    await client.query(
      `insert into order_items (order_id, store_id, item_name_snapshot, quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang)
       values ($1, $2, 'QA 7.5 Item', $3, $4, $5)`,
      [orderId, storeId, item.qty, item.priceSatang, item.costSatang],
    );
  }
  return orderId;
}

async function insertConfirmedInvoice(client: Client, totalSatang: number): Promise<void> {
  await client.query(
    `insert into purchase_invoices (store_id, image_path, invoice_date, total_satang, review_status)
     values ($1, 'qa/7.5-fixture.jpg', $2::date, $3, 'confirmed')`,
    [storeId, YESTERDAY.businessDate, totalSatang],
  );
}

async function readDailyFinancials(client: Client): Promise<{
  gross_revenue_satang: number;
  total_cogs_satang: number | null;
  untracked_item_count: number;
  other_expense_satang: number;
  net_profit_satang: number | null;
  order_count: number;
} | null> {
  const { rows } = await client.query(
    `select gross_revenue_satang, total_cogs_satang, untracked_item_count, other_expense_satang, net_profit_satang, order_count
       from daily_financials where store_id = $1 and business_date = $2::date`,
    [storeId, YESTERDAY.businessDate],
  );
  return rows[0] ?? null;
}

function fakeJob(): Job {
  return { id: randomUUID(), store_id: storeId, job_type: "daily_aggregate", payload: {}, attempts: 0 };
}

describe("WBS 7.5 — worker dailyAggregate", () => {
  it("REQUIRED: reconciles exactly in integer satang — gross_revenue - total_cogs - other_expense === net_profit, no rounding drift", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      // Two tracked-cost sales, one confirmed expense. Deliberately odd
      // satang amounts (not round baht) to catch any float/rounding drift.
      await insertOrderWithItems(client, {
        status: "COLLECTED",
        totalSatang: 12345,
        items: [{ qty: 1, priceSatang: 12345, costSatang: 4321 }],
      });
      await insertOrderWithItems(client, {
        status: "ACCEPTED",
        totalSatang: 6789,
        items: [{ qty: 3, priceSatang: 2263, costSatang: 777 }], // 3*2263=6789, 3*777=2331
      });
      await insertConfirmedInvoice(client, 1500);

      await dailyAggregate(fakeJob());

      const row = await readDailyFinancials(client);
      expect(row).not.toBeNull();
      const r = row!;

      expect(r.gross_revenue_satang).toBe(12345 + 6789);
      expect(r.total_cogs_satang).toBe(4321 + 2331);
      expect(r.other_expense_satang).toBe(1500);
      expect(r.untracked_item_count).toBe(0);
      expect(r.order_count).toBe(2);

      // The exact reconciliation the WBS Acceptance criterion requires.
      expect(r.net_profit_satang).toBe(
        r.gross_revenue_satang - (r.total_cogs_satang as number) - r.other_expense_satang,
      );
      expect(r.net_profit_satang).toBe(12345 + 6789 - (4321 + 2331) - 1500);
    } finally {
      await client.query(`delete from order_items where store_id = $1`, [storeId]);
      await client.query(`delete from orders where store_id = $1`, [storeId]);
      await client.query(`delete from purchase_invoices where store_id = $1`, [storeId]);
      await client.query(`delete from daily_financials where store_id = $1`, [storeId]);
      await cleanupJobQueue(client);
      await client.end();
    }
  });

  it("RL-2: an all-untracked day stores NULL cogs/profit, never 0, with the untracked count set", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      await insertOrderWithItems(client, {
        status: "COLLECTED",
        totalSatang: 5000,
        items: [{ qty: 1, priceSatang: 5000, costSatang: null }],
      });

      await dailyAggregate(fakeJob());

      const row = await readDailyFinancials(client);
      expect(row).not.toBeNull();
      expect(row!.gross_revenue_satang).toBe(5000); // revenue still shown, never hidden
      expect(row!.total_cogs_satang).toBeNull(); // NOT 0
      expect(row!.net_profit_satang).toBeNull(); // NOT 0
      expect(row!.untracked_item_count).toBe(1);
    } finally {
      await client.query(`delete from order_items where store_id = $1`, [storeId]);
      await client.query(`delete from orders where store_id = $1`, [storeId]);
      await client.query(`delete from daily_financials where store_id = $1`, [storeId]);
      await cleanupJobQueue(client);
      await client.end();
    }
  });

  it("cash-channel sales are included in revenue exactly like online sales (no channel special-casing)", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      await insertOrderWithItems(client, {
        status: "COLLECTED",
        channel: "cash",
        totalSatang: 3000,
        items: [{ qty: 1, priceSatang: 3000, costSatang: 1000 }],
      });

      await dailyAggregate(fakeJob());

      const row = await readDailyFinancials(client);
      expect(row).not.toBeNull();
      expect(row!.gross_revenue_satang).toBe(3000);
      expect(row!.order_count).toBe(1);
    } finally {
      await client.query(`delete from order_items where store_id = $1`, [storeId]);
      await client.query(`delete from orders where store_id = $1`, [storeId]);
      await client.query(`delete from daily_financials where store_id = $1`, [storeId]);
      await cleanupJobQueue(client);
      await client.end();
    }
  });

  it("REQUIRED: re-running the job for the same business_date is idempotent (ON CONFLICT DO UPDATE), not additive", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      await insertOrderWithItems(client, {
        status: "COLLECTED",
        totalSatang: 8000,
        items: [{ qty: 1, priceSatang: 8000, costSatang: 2500 }],
      });
      await insertConfirmedInvoice(client, 500);

      await dailyAggregate(fakeJob());
      const firstRun = await readDailyFinancials(client);
      expect(firstRun).not.toBeNull();

      await dailyAggregate(fakeJob());
      const secondRun = await readDailyFinancials(client);

      // Not doubled: exactly one row, same figures as the first run.
      const { rows: countRows } = await client.query(
        `select count(*)::int as n from daily_financials where store_id = $1 and business_date = $2::date`,
        [storeId, YESTERDAY.businessDate],
      );
      expect(countRows[0].n).toBe(1);
      expect(secondRun).toEqual(firstRun);
      expect(secondRun!.gross_revenue_satang).toBe(8000);
      expect(secondRun!.net_profit_satang).toBe(8000 - 2500 - 500);
    } finally {
      await client.query(`delete from order_items where store_id = $1`, [storeId]);
      await client.query(`delete from orders where store_id = $1`, [storeId]);
      await client.query(`delete from purchase_invoices where store_id = $1`, [storeId]);
      await client.query(`delete from daily_financials where store_id = $1`, [storeId]);
      await cleanupJobQueue(client);
      await client.end();
    }
  });

  it("REQUIRED: historical immutability — re-aggregating the same day after an ingredient's current_unit_cost_satang changes produces a byte-identical row", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    let ingredientId: string | undefined;
    try {
      await insertOrderWithItems(client, {
        status: "COLLECTED",
        totalSatang: 9000,
        items: [{ qty: 1, priceSatang: 9000, costSatang: 3000 }], // frozen snapshot, not linked to any ingredient row
      });

      const ingredientResult = await client.query<{ id: string }>(
        `insert into ingredients (store_id, name, base_unit, current_unit_cost_satang)
         values ($1, 'QA 7.5 Milk', 'ml', 1000) returning id`,
        [storeId],
      );
      ingredientId = ingredientResult.rows[0].id;

      await dailyAggregate(fakeJob());
      const before = await readDailyFinancials(client);
      expect(before).not.toBeNull();
      expect(before!.net_profit_satang).toBe(9000 - 3000);

      // Milk price rises sharply, afterwards.
      await client.query(`update ingredients set current_unit_cost_satang = 9999 where id = $1`, [ingredientId]);

      // Re-run the SAME nightly job for the SAME business_date.
      await dailyAggregate(fakeJob());
      const after = await readDailyFinancials(client);

      // Byte-identical: the aggregate SQL never reads ingredients at all,
      // only order_items.unit_cost_snapshot_satang (trigger-frozen at sale).
      expect(after).toEqual(before);
      expect(after!.net_profit_satang).toBe(9000 - 3000);
    } finally {
      if (ingredientId) await client.query(`delete from ingredients where id = $1`, [ingredientId]);
      await client.query(`delete from order_items where store_id = $1`, [storeId]);
      await client.query(`delete from orders where store_id = $1`, [storeId]);
      await client.query(`delete from daily_financials where store_id = $1`, [storeId]);
      await cleanupJobQueue(client);
      await client.end();
    }
  });

  it("the sweep is self-perpetuating: exactly one fresh 'daily_aggregate' job is enqueued for the next 01:00 Asia/Bangkok run", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      await cleanupJobQueue(client);

      // Scoped to this fixture's own store_id (not null/all-stores) so this
      // assertion doesn't also sweep an unrelated perf fixture that may be
      // loaded locally — the self-perpetuating re-enqueue below is always
      // global by construction (job_queue insert never sets store_id),
      // regardless of which store this run's own job targeted.
      await dailyAggregate(fakeJob());

      const { rows } = await client.query<{ n: string; run_after: Date }>(
        `select count(*)::int as n, min(run_after) as run_after
           from job_queue
          where job_type = 'daily_aggregate' and store_id is null and status = 'pending'`,
      );
      expect(Number(rows[0].n)).toBe(1);
      expect(new Date(rows[0].run_after).getTime()).toBeGreaterThan(Date.now());
    } finally {
      await cleanupJobQueue(client);
      await client.end();
    }
  });
});
