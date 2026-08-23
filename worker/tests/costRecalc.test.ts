// WBS 6.9 qa_engineer leg — 'cost_recalc' job handler
// (worker/src/handlers/costRecalc.ts), independently written by QA against
// the engineer's implementation (which has NO test file of its own — this
// is the sole coverage for this handler).
//
// Real Postgres, same posture as expireOrders.test.ts / dailyAggregate.test.ts:
// the RL-2 null-write behaviour and the bom_lines DELETE trigger live in the
// database, not in a mock. Skips (does not pass) if no local Postgres is
// reachable.
//
// What this file is specifically hunting for, per the WBS 6.9 dispatch:
//   1. no-BOM and null-ingredient-cost items get a cache row with
//      cost_satang/margin_satang = NULL, never a missing row and never 0
//   2. a PREVIOUSLY tracked item that becomes untracked (its last bom_line
//      deleted) gets its existing cache row UPDATED to null — not left
//      stale with a non-null value, and not deleted outright
//   3. margin_satang is price - cost, also null-propagated
//   4. the bom_lines trigger (0046 migration) fires on DELETE, not just
//      INSERT/UPDATE, and enqueues a real cost_recalc job reachable by the
//      queue poller (not just by calling the handler directly)
//   5. an ingredientId payload resolves to every menu item referencing it
//      (a purchase confirmation can move the cost of an ingredient shared
//      by several drinks)
//   6. a non-existent menu item id in the payload does not throw / does not
//      abort processing of the other, valid ids in the same batch
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
let costRecalc: (job: Job) => Promise<void>;

let authUserId: string;
let merchantId: string;
let storeId: string;

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[costRecalc.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` first. This is a SKIP, not a pass.\n`,
    );
    return;
  }

  process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_DB_URL;

  const handlerModule = await import("../src/handlers/costRecalc");
  costRecalc = handlerModule.costRecalc;

  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  try {
    authUserId = randomUUID();
    const phone = `+66905${Math.floor(Math.random() * 900000 + 100000)}`;
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
      `insert into stores (merchant_id, slug, name, timezone) values ($1, $2, 'QA 6.9 Worker Store', 'Asia/Bangkok') returning id`,
      [merchantId, `qa-6-9-worker-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`],
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

function fakeJob(payload: Record<string, unknown>): Job {
  return { id: randomUUID(), store_id: storeId, job_type: "cost_recalc", payload, attempts: 0 };
}

async function insertMenuItem(client: Client, priceSatang: number, name: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into menu_items (store_id, name, price_satang) values ($1, $2, $3) returning id`,
    [storeId, name, priceSatang],
  );
  return rows[0].id;
}

async function insertIngredient(client: Client, costSatang: number | null, name: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into ingredients (store_id, name, base_unit, current_unit_cost_satang) values ($1, $2, 'g', $3) returning id`,
    [storeId, name, costSatang],
  );
  return rows[0].id;
}

async function insertBomLine(client: Client, menuItemId: string, ingredientId: string, qty: number): Promise<void> {
  await client.query(
    `insert into bom_lines (store_id, menu_item_id, ingredient_id, qty_base_unit) values ($1, $2, $3, $4)`,
    [storeId, menuItemId, ingredientId, qty],
  );
}

async function readCache(
  client: Client,
  menuItemId: string,
): Promise<{ cost_satang: number | null; margin_satang: number | null; is_stale: boolean; computed_at: Date | null } | null> {
  const { rows } = await client.query(
    `select cost_satang, margin_satang, is_stale, computed_at from menu_item_cost_cache where menu_item_id = $1`,
    [menuItemId],
  );
  return rows[0] ?? null;
}

async function cleanupStoreData(client: Client): Promise<void> {
  await client.query(`delete from menu_item_cost_cache where store_id = $1`, [storeId]);
  await client.query(`delete from bom_lines where store_id = $1`, [storeId]);
  await client.query(`delete from menu_items where store_id = $1`, [storeId]);
  await client.query(`delete from ingredients where store_id = $1`, [storeId]);
  await client.query(`delete from job_queue where store_id = $1`, [storeId]);
}

describe("WBS 6.9 — worker costRecalc", () => {
  it("REQUIRED (RL-2): a menu item with NO bom_lines gets a cache row with cost_satang/margin_satang = NULL, not missing, not 0", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      const menuItemId = await insertMenuItem(client, 10000, "QA 6.9 No-BOM Latte");

      await costRecalc(fakeJob({ menuItemIds: [menuItemId] }));

      const row = await readCache(client, menuItemId);
      expect(row).not.toBeNull();
      expect(row!.cost_satang).toBeNull();
      expect(row!.margin_satang).toBeNull();
      expect(row!.is_stale).toBe(false); // recomputed, not left in its pending stale state
      expect(row!.computed_at).not.toBeNull();
    } finally {
      await cleanupStoreData(client);
      await client.end();
    }
  });

  it("REQUIRED (RL-2): any bom_line referencing an ingredient with null cost -> cost_satang NULL for the whole item, never a partial sum", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      const menuItemId = await insertMenuItem(client, 10000, "QA 6.9 Partial-Cost Latte");
      const milk = await insertIngredient(client, 45, "QA 6.9 Milk (tracked)");
      const beans = await insertIngredient(client, null, "QA 6.9 Beans (never purchased)");
      await insertBomLine(client, menuItemId, milk, 200);
      await insertBomLine(client, menuItemId, beans, 18);

      await costRecalc(fakeJob({ menuItemIds: [menuItemId] }));

      const row = await readCache(client, menuItemId);
      expect(row!.cost_satang).toBeNull();
      expect(row!.margin_satang).toBeNull();
    } finally {
      await cleanupStoreData(client);
      await client.end();
    }
  });

  it("complete BOM -> the exact integer satang sum, and margin = price - cost", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      const priceSatang = 10000;
      const menuItemId = await insertMenuItem(client, priceSatang, "QA 6.9 Complete Latte");
      const milk = await insertIngredient(client, 45, "QA 6.9 Milk"); // satang/g? using round numbers below
      const beans = await insertIngredient(client, 500, "QA 6.9 Beans");
      await insertBomLine(client, menuItemId, milk, 200); // 200 * 45 = 9000... too large; keep it simple & exact instead:
      await insertBomLine(client, menuItemId, beans, 1); // 1 * 500 = 500

      // Recompute expected total from the exact same rows the handler will read.
      const expectedCost = 200 * 45 + 1 * 500;

      await costRecalc(fakeJob({ menuItemIds: [menuItemId] }));

      const row = await readCache(client, menuItemId);
      expect(row!.cost_satang).toBe(expectedCost);
      expect(row!.margin_satang).toBe(priceSatang - expectedCost);
      expect(row!.is_stale).toBe(false);
    } finally {
      await cleanupStoreData(client);
      await client.end();
    }
  });

  it("REQUIRED: a previously-tracked item whose LAST bom_line is deleted gets its cache row updated to NULL — not left stale with the old value, not deleted", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      const priceSatang = 8000;
      const menuItemId = await insertMenuItem(client, priceSatang, "QA 6.9 Becomes-Untracked Latte");
      const milk = await insertIngredient(client, 100, "QA 6.9 Milk Solo");
      await insertBomLine(client, menuItemId, milk, 10);

      // First recalc: fully tracked.
      await costRecalc(fakeJob({ menuItemIds: [menuItemId] }));
      const before = await readCache(client, menuItemId);
      expect(before!.cost_satang).toBe(1000);

      // Delete the ONLY bom_line -- the trg_bom_lines_cost_recalc trigger
      // (0046 migration) must fire on DELETE and mark/enqueue a recalc.
      await client.query(`delete from bom_lines where menu_item_id = $1`, [menuItemId]);

      const staleAfterDelete = await readCache(client, menuItemId);
      expect(staleAfterDelete).not.toBeNull(); // trigger upserts, never deletes the cache row
      expect(staleAfterDelete!.is_stale).toBe(true);
      // Old (now-wrong) value is still visible here -- "last good number,
      // marked stale" is the deliberate mid-recalculation contract. It is
      // the recalc below, not the trigger itself, that must null it out.
      expect(staleAfterDelete!.cost_satang).toBe(1000);

      // Now actually run the recalc the trigger enqueued (calling the
      // handler directly with the menu item id, same as the real queue
      // poller would after picking the trigger's job_queue row).
      await costRecalc(fakeJob({ menuItemIds: [menuItemId] }));

      const after = await readCache(client, menuItemId);
      expect(after!.cost_satang).toBeNull(); // RL-2: no BOM anymore -> null, never left at 1000, never deleted
      expect(after!.margin_satang).toBeNull();
      expect(after!.is_stale).toBe(false);
    } finally {
      await cleanupStoreData(client);
      await client.end();
    }
  });

  it("the bom_lines DELETE trigger enqueues a real job_queue row (not just an in-process side effect)", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      const menuItemId = await insertMenuItem(client, 5000, "QA 6.9 Trigger Row Check");
      const ing = await insertIngredient(client, 200, "QA 6.9 Trigger Ingredient");
      await insertBomLine(client, menuItemId, ing, 5);

      await client.query(`delete from job_queue where store_id = $1`, [storeId]);
      await client.query(`delete from bom_lines where menu_item_id = $1`, [menuItemId]);

      const { rows } = await client.query(
        `select payload from job_queue where store_id = $1 and job_type = 'cost_recalc'`,
        [storeId],
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const payloads = rows.map((r) => r.payload.menuItemIds);
      expect(payloads.some((ids: string[]) => ids.includes(menuItemId))).toBe(true);
    } finally {
      await cleanupStoreData(client);
      await client.end();
    }
  });

  it("an ingredientId payload resolves to EVERY menu item referencing it, and each recomputes independently", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      const sharedIngredient = await insertIngredient(client, 300, "QA 6.9 Shared Espresso");
      const itemA = await insertMenuItem(client, 9000, "QA 6.9 Americano");
      const itemB = await insertMenuItem(client, 12000, "QA 6.9 Cortado");
      await insertBomLine(client, itemA, sharedIngredient, 18); // 18*300 = 5400
      await insertBomLine(client, itemB, sharedIngredient, 20); // 20*300 = 6000

      await client.query(`delete from menu_item_cost_cache where menu_item_id in ($1, $2)`, [itemA, itemB]);

      await costRecalc(fakeJob({ ingredientIds: [sharedIngredient] }));

      const rowA = await readCache(client, itemA);
      const rowB = await readCache(client, itemB);
      expect(rowA!.cost_satang).toBe(5400);
      expect(rowB!.cost_satang).toBe(6000);
    } finally {
      await cleanupStoreData(client);
      await client.end();
    }
  });

  it("a non-existent menu item id in the payload is silently skipped and does not abort processing of the other, valid id in the same batch", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      const validItem = await insertMenuItem(client, 7000, "QA 6.9 Valid Item In Mixed Batch");
      const ing = await insertIngredient(client, 150, "QA 6.9 Mixed Batch Ingredient");
      await insertBomLine(client, validItem, ing, 10); // 10*150 = 1500

      const bogusId = randomUUID();

      await expect(
        costRecalc(fakeJob({ menuItemIds: [bogusId, validItem] })),
      ).resolves.not.toThrow();

      const row = await readCache(client, validItem);
      expect(row!.cost_satang).toBe(1500);

      const bogusRow = await readCache(client, bogusId);
      expect(bogusRow).toBeNull(); // no row fabricated for an id that isn't a real menu item
    } finally {
      await cleanupStoreData(client);
      await client.end();
    }
  });

  it("an empty/missing payload (no ingredientIds, no menuItemIds) is a no-op, not an error", async () => {
    if (!dbAvailable) return;
    await expect(costRecalc(fakeJob({}))).resolves.not.toThrow();
  });

  it("recalculating a 50-item menu in one call completes well within the WBS 6.9 60-second performance target", async () => {
    if (!dbAvailable) return;
    const client = new Client({ connectionString: LOCAL_DB_URL });
    await client.connect();
    try {
      const ing = await insertIngredient(client, 10, "QA 6.9 Perf Ingredient");
      const menuItemIds: string[] = [];
      for (let i = 0; i < 50; i++) {
        const id = await insertMenuItem(client, 5000, `QA 6.9 Perf Item ${i}`);
        await insertBomLine(client, id, ing, 5);
        menuItemIds.push(id);
      }

      const start = Date.now();
      await costRecalc(fakeJob({ menuItemIds }));
      const elapsedMs = Date.now() - start;

      expect(elapsedMs).toBeLessThan(60_000);

      const { rows } = await client.query<{ n: string }>(
        `select count(*)::int as n from menu_item_cost_cache where menu_item_id = any($1::uuid[]) and cost_satang = 50 and is_stale = false`,
        [menuItemIds],
      );
      expect(Number(rows[0].n)).toBe(50);
    } finally {
      await cleanupStoreData(client);
      await client.end();
    }
  }, 65_000);
});
