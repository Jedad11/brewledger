// WBS 5.7 qa_engineer leg — Order Status Lifecycle.
//
// Drives transition_order() (packages/db/migrations/0032_order_status_history.sql)
// directly against a real local Postgres, same "RLS/triggers/constraints only
// exist in the database, a mock proves nothing" posture as
// payment_confirmation.test.ts and rls.test.ts. transition_order() is
// service_role-only (granted, revoked from anon/authenticated) — this file
// calls it over a raw superuser `pg` connection, exactly the access pattern
// the worker's own DATABASE_URL connection uses (worker/src/db.ts's header
// comment), which bypasses PostgREST/RLS/grants entirely.
//
// Covers the WBS 5.7 Testing block (BrewLedger_WBS_Dictionary.md lines
// ~3876-3960) and docs/db/wbs_5_7_lifecycle_design.md:
//   1. Full illegal-pair matrix: all 54 disallowed (from,to) pairs (64 total
//      minus the 10 legal ones), including all 8 self-transitions, throw
//      errcode 'BL001' — looped over the full matrix, not hand-picked.
//   2. Every one of the 10 legal transitions fires its side effects exactly
//      once, verified under a forced retry (sequential self-transition
//      retry, PLUS a genuinely concurrent Promise.all retry against the raw
//      guard for two transitions with no console wrapper).
//   3. Expiry sweep (the real worker/src/handlers/expireOrders.ts handler)
//      releases the slot AND the slot becomes visible/bookable again via the
//      real anon-facing RLS policy, not just raw column assertions; a
//      system-actor history row is written.
//   4. History rows: order_id/from/to/actor/actor_type/created_at correct
//      for every transition tested above, folded into each transition's own
//      assertions rather than a separate pass.
//   5. order_status_history RLS: owning merchant reads it, a different
//      merchant does not, anon does not — cross-checked against
//      service_role so a zero-row result can't be mistaken for an empty
//      table.
//   6. RL-1: refund_status is a flag-only column (check constraint
//      'pending'|'done', no balance/wallet/escrow table anywhere near it),
//      CANCELLED -> REFUNDED is blocked unless refund_status = 'pending'.
//   7. scripts/scan-order-status-bypass.mjs: catches a deliberately
//      introduced direct orders.status write, and does not false-positive on
//      the legitimate exclusions (lifecycle.ts, test files, migrations) —
//      this half needs no DB and always runs.
//   8. console_confirm_payment / console_reject_payment regression: now that
//      they delegate to transition_order (0033), they still write a correct
//      order_status_history row. The full WBS 5.6 idempotency/concurrency/
//      cross-tenant/rollback regression suite already lives in
//      payment_confirmation.test.ts and is unchanged by this file — run it
//      alongside this one, not duplicated here.
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, isReachable, LOCAL_DB_URL } from "./helpers/db";
import { anonClient, authenticatedClient, isApiReachable, serviceClient } from "./helpers/supabase-clients";
// scripts/scan-order-status-bypass.mjs ships no .d.ts (it's a standalone
// CLI script, not a package export) — vitest/esbuild resolves and runs it
// fine at test time; this suppresses only tsc's static "no declaration
// file" complaint (TS7016), not a real type-safety gap.
// @ts-expect-error -- no .d.ts for this plain .mjs script, see comment above
import { scanForOrderStatusBypass } from "../../../scripts/scan-order-status-bypass.mjs";

let dbAvailable = false;
let apiAvailable = false;

interface MerchantFixture {
  authUserId: string;
  merchantId: string;
  storeId: string;
}

let merchantA: MerchantFixture;
let merchantB: MerchantFixture;
const createdAuthUserIds: string[] = [];

async function createMerchantFixture(client: Client, label: string): Promise<MerchantFixture> {
  const authUserId = randomUUID();
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
  const merchantId = merchantResult.rows[0].id;

  const storeResult = await client.query<{ id: string }>(
    `insert into stores (merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity, is_published, promptpay_id, promptpay_type, promptpay_verified_at)
     values ($1, $2, $3, '07:00', '19:00', 'Asia/Bangkok', 3, true, '0899999999', 'msisdn', now())
     returning id`,
    [merchantId, `qa-5-7-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`, `QA 5.7 Store ${label}`],
  );
  const storeId = storeResult.rows[0].id;

  createdAuthUserIds.push(authUserId);
  return { authUserId, merchantId, storeId };
}

beforeAll(async () => {
  dbAvailable = await isReachable();
  apiAvailable = dbAvailable && (await isApiReachable());
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[order_lifecycle.test.ts] SKIPPING DB-backed suites — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` (and \`supabase db reset\` to guarantee 0032/0033 are ` +
        "applied) first. This is a SKIP, not a pass. The CI-scanner suite below needs no DB and still runs.\n",
    );
    return;
  }

  const client = await connect();
  try {
    merchantA = await createMerchantFixture(client, "a");
    merchantB = await createMerchantFixture(client, "b");
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  if (!dbAvailable || createdAuthUserIds.length === 0) return;
  const client = await connect();
  try {
    // WBS 5.7 regression note: this suite's original afterAll disabled
    // trg_order_status_history_append_only for the duration of teardown —
    // that was the workaround for the bug reported against 0032 (see git
    // history). 0034 fixed the trigger itself (pg_trigger_depth() > 1 exempts
    // cascade-originated UPDATE/DELETE) and made
    // order_status_history_order_id_fkey deferrable, so a plain cascading
    // delete now works with no trigger disabled. See the dedicated
    // "cascade delete through auth.users" describe block below for the
    // assertion that this is actually clean (zero orphans), not just
    // non-throwing.
    for (const id of createdAuthUserIds) {
      await client.query("delete from auth.users where id = $1", [id]);
    }
  } finally {
    await client.end();
  }
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function insertMenuItem(client: Client, storeId: string, opts: { name: string; priceSatang: number }): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `insert into menu_items (store_id, name, price_satang) values ($1, $2, $3) returning id`,
    [storeId, opts.name, opts.priceSatang],
  );
  return rows[0];
}

async function insertIngredient(client: Client, storeId: string, opts: { name: string; unitCostSatang: number | null }): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `insert into ingredients (store_id, name, base_unit, current_unit_cost_satang)
     values ($1, $2, 'g', $3) returning id`,
    [storeId, opts.name, opts.unitCostSatang],
  );
  return rows[0];
}

async function insertBomLine(client: Client, storeId: string, menuItemId: string, ingredientId: string, qtyBaseUnit: number): Promise<void> {
  await client.query(
    `insert into bom_lines (store_id, menu_item_id, ingredient_id, qty_base_unit) values ($1, $2, $3, $4)`,
    [storeId, menuItemId, ingredientId, qtyBaseUnit],
  );
}

let slotOffsetCounter = 0;

async function insertFutureSlot(client: Client, storeId: string, opts: { capacity: number; bookedCount: number }): Promise<{ id: string }> {
  slotOffsetCounter += 1;
  const offsetMinutes = 60 + slotOffsetCounter * 15;
  const { rows } = await client.query<{ id: string }>(
    `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
     values ($1, now() + make_interval(mins => $4::int), now() + make_interval(mins => $4::int + 15), $2::int, $3::int,
             ($3::int < $2::int))
     returning id`,
    [storeId, opts.capacity, opts.bookedCount, offsetMinutes],
  );
  return rows[0];
}

interface SeedOrderOpts {
  storeId: string;
  status: string;
  pickupSlotId?: string | null;
  refundStatus?: "pending" | "done" | null;
  expiresAt?: string; // SQL interval expr, e.g. "-1 minute"
  items?: Array<{ menuItemId: string; nameSnapshot: string; quantity: number; unitPriceSatang: number; unitCostSnapshotSatang: number | null }>;
}

/**
 * Inserts an order DIRECTLY at the given `status`, bypassing transition_order
 * entirely — this file's whole point is to test transition_order as the
 * guard, so fixtures must be able to place an order at an arbitrary starting
 * state without having walked the state machine to get there (e.g. seeding a
 * COLLECTED order to prove every outgoing transition from it is illegal).
 * This is exactly the "test-fixture case" scripts/scan-order-status-bypass.mjs
 * deliberately excludes (test files are skipped by its own scanner).
 */
async function seedOrderInStatus(client: Client, opts: SeedOrderOpts): Promise<{ id: string; orderCode: string }> {
  const orderCode = `L${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
  const items = opts.items ?? [];
  const subtotal = items.reduce((sum, i) => sum + i.unitPriceSatang * i.quantity, 0) || 5000;
  const expiresExpr = opts.expiresAt ?? "+15 minutes";

  const { rows } = await client.query<{ id: string }>(
    `insert into orders (
       store_id, order_code, customer_name, pickup_slot_id, status, refund_status,
       subtotal_satang, total_satang, expires_at
     ) values ($1, $2, 'QA 5.7 Customer', $3, $4, $5, $6, $6, now() + ($7)::interval)
     returning id`,
    [opts.storeId, orderCode, opts.pickupSlotId ?? null, opts.status, opts.refundStatus ?? null, subtotal, expiresExpr],
  );
  const orderId = rows[0].id;

  for (const item of items) {
    await client.query(
      `insert into order_items (order_id, store_id, menu_item_id, item_name_snapshot, quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [orderId, opts.storeId, item.menuItemId, item.nameSnapshot, item.quantity, item.unitPriceSatang, item.unitCostSnapshotSatang],
    );
  }

  return { id: orderId, orderCode };
}

/** Inserts a 'sale' stock_ledger row directly, simulating what an earlier
 * PENDING_PAYMENT -> ACCEPTED transition would have left behind, so a
 * *->CANCELLED reversal transition has something real to reverse. */
async function insertSaleLedgerRow(client: Client, storeId: string, orderId: string, ingredientId: string, deltaBaseUnit: number): Promise<void> {
  await client.query(
    `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, order_id) values ($1, $2, $3, 'sale', $4)`,
    [storeId, ingredientId, deltaBaseUnit, orderId],
  );
}

interface TransitionError extends Error {
  code?: string;
  detail?: string;
}

async function callTransitionOrder(
  client: Client,
  orderId: string,
  to: string,
  actor: string | null,
  actorType: "merchant" | "system",
): Promise<void> {
  await client.query("select transition_order($1, $2, $3, $4)", [orderId, to, actor, actorType]);
}

async function getOrderStatus(client: Client, orderId: string): Promise<string> {
  const { rows } = await client.query<{ status: string }>("select status from orders where id = $1", [orderId]);
  return rows[0].status;
}

async function getHistoryRows(
  client: Client,
  orderId: string,
): Promise<Array<{ from_status: string; to_status: string; actor: string | null; actor_type: string; created_at: Date }>> {
  const { rows } = await client.query(
    "select from_status, to_status, actor, actor_type, created_at from order_status_history where order_id = $1 order by created_at",
    [orderId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// 1. Full illegal-pair matrix
// ---------------------------------------------------------------------------

const ALL_STATES = [
  "PENDING_PAYMENT",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "COLLECTED",
  "CANCELLED",
  "REFUNDED",
  "EXPIRED",
] as const;

const LEGAL_PAIRS = new Set<string>([
  "PENDING_PAYMENT>ACCEPTED",
  "PENDING_PAYMENT>EXPIRED",
  "PENDING_PAYMENT>CANCELLED",
  "ACCEPTED>PREPARING",
  "ACCEPTED>CANCELLED",
  "PREPARING>READY",
  "PREPARING>CANCELLED",
  "READY>COLLECTED",
  "READY>CANCELLED",
  "CANCELLED>REFUNDED",
]);

// Sanity on the matrix itself: 8x8 = 64 pairs, 10 legal, 54 illegal
// (including the 8 self-pairs, none of which are legal).
describe("WBS 5.7 — transition matrix sanity", () => {
  it("8 states x 8 states = 64 pairs, exactly 10 legal, 54 illegal, all 8 self-pairs illegal", () => {
    expect(ALL_STATES).toHaveLength(8);
    expect(LEGAL_PAIRS.size).toBe(10);
    let illegalCount = 0;
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        if (!LEGAL_PAIRS.has(`${from}>${to}`)) illegalCount++;
      }
    }
    expect(illegalCount).toBe(54);
    for (const s of ALL_STATES) {
      expect(LEGAL_PAIRS.has(`${s}>${s}`)).toBe(false);
    }
  });
});

describe("WBS 5.7 — full illegal-pair matrix: every disallowed pair throws BL001, looped over all 54", () => {
  for (const from of ALL_STATES) {
    it(`REQUIRED: every illegal target from ${from} throws errcode BL001; order status is untouched by any of them`, async () => {
      if (!dbAvailable) return;
      const client = await connect();
      try {
        const refundStatus = from === "CANCELLED" ? null : undefined; // null: not owed, isolates this from CANCELLED->REFUNDED's own gating test below
        const order = await seedOrderInStatus(client, {
          storeId: merchantA.storeId,
          status: from,
          refundStatus,
        });

        const illegalTargets = ALL_STATES.filter((to) => !LEGAL_PAIRS.has(`${from}>${to}`));
        expect(illegalTargets.length).toBeGreaterThan(0);

        for (const to of illegalTargets) {
          let threw = false;
          try {
            await callTransitionOrder(client, order.id, to, merchantA.merchantId, "merchant");
          } catch (err) {
            threw = true;
            expect((err as TransitionError).code).toBe("BL001");
          }
          expect(threw).toBe(true);
        }

        // Never silently ignored, and never partially applied: status is
        // exactly what it started as after all illegal attempts.
        expect(await getOrderStatus(client, order.id)).toBe(from);

        // No history row was written for any of the rejected attempts.
        const history = await getHistoryRows(client, order.id);
        expect(history).toHaveLength(0);
      } finally {
        await client.end();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Every legal transition: side effects fire exactly once, verified under
//    a forced retry (self-transition, per docs/db/wbs_5_7_lifecycle_design.md
//    §4 — transition_order() itself never silently no-ops; a retry is an
//    unmapped self-pair and must throw BL001, not double-apply).
// ---------------------------------------------------------------------------

describe("WBS 5.7 — legal transitions: side effects fire exactly once, forced retry throws BL001 and does not double-apply", () => {
  it("PENDING_PAYMENT -> ACCEPTED: deducts stock (one row per bom_line), enqueues merchant push_notify, writes one history row; retry throws BL001, no duplication", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Lifecycle Latte", priceSatang: 6500 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Lifecycle Beans", unitCostSatang: 500 });
      const milk = await insertIngredient(client, merchantA.storeId, { name: "QA Lifecycle Milk", unitCostSatang: 45 });
      await insertBomLine(client, merchantA.storeId, item.id, beans.id, 18);
      await insertBomLine(client, merchantA.storeId, item.id, milk.id, 150);

      const order = await seedOrderInStatus(client, {
        storeId: merchantA.storeId,
        status: "PENDING_PAYMENT",
        items: [{ menuItemId: item.id, nameSnapshot: "QA Lifecycle Latte", quantity: 2, unitPriceSatang: 6500, unitCostSnapshotSatang: 15750 }],
      });

      await callTransitionOrder(client, order.id, "ACCEPTED", merchantA.merchantId, "merchant");
      expect(await getOrderStatus(client, order.id)).toBe("ACCEPTED");

      const { rows: ledgerAfterFirst } = await client.query<{ n: string }>(
        "select count(*)::int as n from stock_ledger where order_id = $1",
        [order.id],
      );
      expect(Number(ledgerAfterFirst[0].n)).toBe(2); // one per bom_line

      const { rows: jobsAfterFirst } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1 and payload->>'kind' = 'merchant_new_order'",
        [order.id],
      );
      expect(Number(jobsAfterFirst[0].n)).toBe(1);

      const historyAfterFirst = await getHistoryRows(client, order.id);
      expect(historyAfterFirst).toHaveLength(1);
      expect(historyAfterFirst[0].from_status).toBe("PENDING_PAYMENT");
      expect(historyAfterFirst[0].to_status).toBe("ACCEPTED");
      expect(historyAfterFirst[0].actor).toBe(merchantA.merchantId);
      expect(historyAfterFirst[0].actor_type).toBe("merchant");
      expect(historyAfterFirst[0].created_at).toBeInstanceOf(Date);

      // Forced retry: same call again.
      await expect(callTransitionOrder(client, order.id, "ACCEPTED", merchantA.merchantId, "merchant")).rejects.toMatchObject({
        code: "BL001",
      });

      const { rows: ledgerAfterRetry } = await client.query<{ n: string }>(
        "select count(*)::int as n from stock_ledger where order_id = $1",
        [order.id],
      );
      expect(Number(ledgerAfterRetry[0].n)).toBe(2); // still 2, not 4

      const { rows: jobsAfterRetry } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1",
        [order.id],
      );
      expect(Number(jobsAfterRetry[0].n)).toBe(1); // still 1, not 2

      const historyAfterRetry = await getHistoryRows(client, order.id);
      expect(historyAfterRetry).toHaveLength(1); // still 1, not 2
    } finally {
      await client.end();
    }
  });

  it("PENDING_PAYMENT -> EXPIRED: releases the slot, no stock movement, one history row; retry throws BL001", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const slot = await insertFutureSlot(client, merchantA.storeId, { capacity: 2, bookedCount: 1 });
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "PENDING_PAYMENT", pickupSlotId: slot.id });

      await callTransitionOrder(client, order.id, "EXPIRED", null, "system");
      expect(await getOrderStatus(client, order.id)).toBe("EXPIRED");

      const { rows: slotAfterFirst } = await client.query<{ booked_count: number; is_open: boolean }>(
        "select booked_count, is_open from pickup_slots where id = $1",
        [slot.id],
      );
      expect(slotAfterFirst[0].booked_count).toBe(0);
      expect(slotAfterFirst[0].is_open).toBe(true);

      const historyAfterFirst = await getHistoryRows(client, order.id);
      expect(historyAfterFirst).toHaveLength(1);
      expect(historyAfterFirst[0].actor).toBeNull();
      expect(historyAfterFirst[0].actor_type).toBe("system");

      await expect(callTransitionOrder(client, order.id, "EXPIRED", null, "system")).rejects.toMatchObject({ code: "BL001" });

      const { rows: slotAfterRetry } = await client.query<{ booked_count: number }>(
        "select booked_count from pickup_slots where id = $1",
        [slot.id],
      );
      expect(slotAfterRetry[0].booked_count).toBe(0); // not double-released to -1

      expect(await getHistoryRows(client, order.id)).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it("PENDING_PAYMENT -> CANCELLED: releases the slot, refund_status stays NULL (never charged), one history row; retry throws BL001", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const slot = await insertFutureSlot(client, merchantA.storeId, { capacity: 1, bookedCount: 1 });
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "PENDING_PAYMENT", pickupSlotId: slot.id });

      await callTransitionOrder(client, order.id, "CANCELLED", merchantA.merchantId, "merchant");
      expect(await getOrderStatus(client, order.id)).toBe("CANCELLED");

      const { rows: slotAfter } = await client.query<{ booked_count: number; is_open: boolean }>(
        "select booked_count, is_open from pickup_slots where id = $1",
        [slot.id],
      );
      expect(slotAfter[0].booked_count).toBe(0);
      expect(slotAfter[0].is_open).toBe(true);

      const { rows: orderAfter } = await client.query<{ refund_status: string | null }>(
        "select refund_status from orders where id = $1",
        [order.id],
      );
      expect(orderAfter[0].refund_status).toBeNull(); // RL-1: nothing was ever owed, no refund flag set

      expect(await getHistoryRows(client, order.id)).toHaveLength(1);

      await expect(callTransitionOrder(client, order.id, "CANCELLED", merchantA.merchantId, "merchant")).rejects.toMatchObject({
        code: "BL001",
      });
      expect(await getHistoryRows(client, order.id)).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it("ACCEPTED -> PREPARING: enqueues customer push_notify, one history row; retry throws BL001, not a second job", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "ACCEPTED" });

      await callTransitionOrder(client, order.id, "PREPARING", merchantA.merchantId, "merchant");
      expect(await getOrderStatus(client, order.id)).toBe("PREPARING");

      const { rows: jobsAfterFirst } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1 and payload->>'kind' = 'customer_status_update'",
        [order.id],
      );
      expect(Number(jobsAfterFirst[0].n)).toBe(1);
      expect(await getHistoryRows(client, order.id)).toHaveLength(1);

      await expect(callTransitionOrder(client, order.id, "PREPARING", merchantA.merchantId, "merchant")).rejects.toMatchObject({
        code: "BL001",
      });

      const { rows: jobsAfterRetry } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1",
        [order.id],
      );
      expect(Number(jobsAfterRetry[0].n)).toBe(1);
      expect(await getHistoryRows(client, order.id)).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it("PREPARING -> READY: enqueues customer push_notify, one history row; retry throws BL001", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "PREPARING" });

      await callTransitionOrder(client, order.id, "READY", merchantA.merchantId, "merchant");
      expect(await getOrderStatus(client, order.id)).toBe("READY");

      const { rows: jobsAfterFirst } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1",
        [order.id],
      );
      expect(Number(jobsAfterFirst[0].n)).toBe(1);
      expect(await getHistoryRows(client, order.id)).toHaveLength(1);

      await expect(callTransitionOrder(client, order.id, "READY", merchantA.merchantId, "merchant")).rejects.toMatchObject({
        code: "BL001",
      });

      const { rows: jobsAfterRetry } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1",
        [order.id],
      );
      expect(Number(jobsAfterRetry[0].n)).toBe(1);
      expect(await getHistoryRows(client, order.id)).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it("READY -> COLLECTED: no side effect beyond the history row; retry throws BL001", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "READY" });

      await callTransitionOrder(client, order.id, "COLLECTED", merchantA.merchantId, "merchant");
      expect(await getOrderStatus(client, order.id)).toBe("COLLECTED");
      expect(await getHistoryRows(client, order.id)).toHaveLength(1);

      await expect(callTransitionOrder(client, order.id, "COLLECTED", merchantA.merchantId, "merchant")).rejects.toMatchObject({
        code: "BL001",
      });
      expect(await getHistoryRows(client, order.id)).toHaveLength(1);
      expect(await getOrderStatus(client, order.id)).toBe("COLLECTED");
    } finally {
      await client.end();
    }
  });

  it("CANCELLED -> REFUNDED: requires refund_status='pending' already set, no further side effect, one history row; retry throws BL001", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "CANCELLED", refundStatus: "pending" });

      await callTransitionOrder(client, order.id, "REFUNDED", merchantA.merchantId, "merchant");
      expect(await getOrderStatus(client, order.id)).toBe("REFUNDED");
      expect(await getHistoryRows(client, order.id)).toHaveLength(1);

      await expect(callTransitionOrder(client, order.id, "REFUNDED", merchantA.merchantId, "merchant")).rejects.toMatchObject({
        code: "BL001",
      });
      expect(await getHistoryRows(client, order.id)).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  for (const from of ["ACCEPTED", "PREPARING", "READY"] as const) {
    it(`${from} -> CANCELLED: sets refund_status='pending', reverses stock (sign-flipped 'cancellation_reversal' rows), releases the slot, one history row; retry throws BL001 and does not double-reverse`, async () => {
      if (!dbAvailable) return;
      const client = await connect();
      try {
        const beans = await insertIngredient(client, merchantA.storeId, { name: `QA ${from} Cancel Beans`, unitCostSatang: 500 });
        const slot = await insertFutureSlot(client, merchantA.storeId, { capacity: 1, bookedCount: 1 });
        const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: from, pickupSlotId: slot.id });
        // Simulate the earlier PENDING_PAYMENT -> ACCEPTED deduction this
        // order would really have accrued before reaching `from`.
        await insertSaleLedgerRow(client, merchantA.storeId, order.id, beans.id, -36);

        await callTransitionOrder(client, order.id, "CANCELLED", merchantA.merchantId, "merchant");
        expect(await getOrderStatus(client, order.id)).toBe("CANCELLED");

        const { rows: orderAfter } = await client.query<{ refund_status: string | null }>(
          "select refund_status from orders where id = $1",
          [order.id],
        );
        expect(orderAfter[0].refund_status).toBe("pending"); // RL-1 flag only — see §6 below for the "no money moves" proof

        const { rows: ledgerAfterFirst } = await client.query<{ reason: string; delta_base_unit: string }>(
          "select reason, delta_base_unit from stock_ledger where order_id = $1 order by created_at",
          [order.id],
        );
        expect(ledgerAfterFirst).toHaveLength(2); // original 'sale' + one 'cancellation_reversal'
        const reversalRow = ledgerAfterFirst.find((r) => r.reason === "cancellation_reversal");
        expect(reversalRow).toBeDefined();
        expect(Number(reversalRow!.delta_base_unit)).toBe(36); // sign-flipped from -36

        const { rows: slotAfter } = await client.query<{ booked_count: number; is_open: boolean }>(
          "select booked_count, is_open from pickup_slots where id = $1",
          [slot.id],
        );
        expect(slotAfter[0].booked_count).toBe(0);
        expect(slotAfter[0].is_open).toBe(true);

        expect(await getHistoryRows(client, order.id)).toHaveLength(1);

        await expect(callTransitionOrder(client, order.id, "CANCELLED", merchantA.merchantId, "merchant")).rejects.toMatchObject({
          code: "BL001",
        });

        const { rows: ledgerAfterRetry } = await client.query<{ n: string }>(
          "select count(*)::int as n from stock_ledger where order_id = $1",
          [order.id],
        );
        expect(Number(ledgerAfterRetry[0].n)).toBe(2); // still 2, not 3 — no second reversal

        const { rows: slotAfterRetry } = await client.query<{ booked_count: number }>(
          "select booked_count from pickup_slots where id = $1",
          [slot.id],
        );
        expect(slotAfterRetry[0].booked_count).toBe(0); // not double-released to -1

        expect(await getHistoryRows(client, order.id)).toHaveLength(1);
      } finally {
        await client.end();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2b. Genuinely concurrent forced retry against the raw guard (not just the
//     console wrapper, which payment_confirmation.test.ts already covers for
//     PENDING_PAYMENT -> ACCEPTED). Proves transition_order's own FOR UPDATE
//     lock — not a wrapper's ownership-check dance — is what makes this safe.
// ---------------------------------------------------------------------------

describe("WBS 5.7 — transition_order itself is safe under genuine concurrency (real parallel connections, no wrapper)", () => {
  it("REQUIRED: 10 parallel ACCEPTED -> PREPARING calls on the SAME order yield exactly one success and 9 BL001 rejections; exactly one history row, one notify job", async () => {
    if (!dbAvailable) return;
    const setup = await connect();
    let orderId: string;
    try {
      const order = await seedOrderInStatus(setup, { storeId: merchantA.storeId, status: "ACCEPTED" });
      orderId = order.id;
    } finally {
      await setup.end();
    }

    const clients = await Promise.all(Array.from({ length: 10 }, () => connect()));
    try {
      const results = await Promise.allSettled(
        clients.map((client) => callTransitionOrder(client, orderId, "PREPARING", merchantA.merchantId, "merchant")),
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(9);
      for (const r of rejected) {
        expect((r.reason as TransitionError).code).toBe("BL001");
      }

      const verify = await connect();
      try {
        expect(await getOrderStatus(verify, orderId)).toBe("PREPARING");
        expect(await getHistoryRows(verify, orderId)).toHaveLength(1); // not 10

        const { rows: jobs } = await verify.query<{ n: string }>(
          "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1",
          [orderId],
        );
        expect(Number(jobs[0].n)).toBe(1); // not 10
      } finally {
        await verify.end();
      }
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  }, 30_000);

  it("REQUIRED: 10 parallel READY -> CANCELLED calls on the SAME order yield exactly one success; refund_status set exactly once, exactly one stock reversal row", async () => {
    if (!dbAvailable) return;
    const setup = await connect();
    let orderId: string;
    let beansId: string;
    try {
      beansId = (await insertIngredient(setup, merchantA.storeId, { name: "QA Concurrent Cancel Beans", unitCostSatang: 500 })).id;
      const order = await seedOrderInStatus(setup, { storeId: merchantA.storeId, status: "READY" });
      orderId = order.id;
      await insertSaleLedgerRow(setup, merchantA.storeId, orderId, beansId, -18);
    } finally {
      await setup.end();
    }

    const clients = await Promise.all(Array.from({ length: 10 }, () => connect()));
    try {
      const results = await Promise.allSettled(
        clients.map((client) => callTransitionOrder(client, orderId, "CANCELLED", merchantA.merchantId, "merchant")),
      );
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled).toHaveLength(1);

      const verify = await connect();
      try {
        expect(await getOrderStatus(verify, orderId)).toBe("CANCELLED");
        const { rows: orderAfter } = await verify.query<{ refund_status: string }>(
          "select refund_status from orders where id = $1",
          [orderId],
        );
        expect(orderAfter[0].refund_status).toBe("pending");

        const { rows: ledger } = await verify.query<{ n: string }>(
          "select count(*)::int as n from stock_ledger where order_id = $1 and reason = 'cancellation_reversal'",
          [orderId],
        );
        expect(Number(ledger[0].n)).toBe(1); // not 10

        expect(await getHistoryRows(verify, orderId)).toHaveLength(1);
      } finally {
        await verify.end();
      }
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// 3. Expiry sweep: worker handler, verified against the real slot
//    capacity/availability mechanism (booked_count/is_open — WBS 5.3), AND
//    against the real anon-facing RLS policy so "becomes bookable again"
//    means what a customer would actually observe, not just a raw column.
// ---------------------------------------------------------------------------

describe("WBS 5.7 — expiry sweep releases the slot and it becomes visible to customers again (real worker handler + real anon RLS)", () => {
  let expireOrdersHandler: (job: { id: string; store_id: string | null; job_type: string; payload: Record<string, unknown>; attempts: number }) => Promise<void>;
  let workerPool: import("pg").Pool | undefined;

  beforeAll(async () => {
    if (!dbAvailable) return;
    process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
    process.env.SUPABASE_SERVICE_ROLE_KEY =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? LOCAL_DB_URL;
    const dbModule = await import("../../../worker/src/db");
    const handlerModule = await import("../../../worker/src/handlers/expireOrders");
    workerPool = dbModule.pool;
    expireOrdersHandler = handlerModule.expireOrders;
  });

  afterAll(async () => {
    if (workerPool) await workerPool.end();
  });

  it("REQUIRED: an order past expires_at is swept to EXPIRED by the real worker handler, the slot reopens, anon can see it again via PostgREST, and a system-actor history row exists", async () => {
    if (!dbAvailable || !apiAvailable) return;
    const client = await connect();
    let slotId: string;
    let orderId: string;
    try {
      const slot = await insertFutureSlot(client, merchantA.storeId, { capacity: 1, bookedCount: 1 });
      slotId = slot.id;
      const order = await seedOrderInStatus(client, {
        storeId: merchantA.storeId,
        status: "PENDING_PAYMENT",
        pickupSlotId: slot.id,
        expiresAt: "-1 minute",
      });
      orderId = order.id;

      // Before the sweep: not visible to anon (held/full — same is_open
      // gate anon_read_open_pickup_slots checks, WBS 3.6/5.3).
      const anonBefore = anonClient();
      const { data: beforeData } = await anonBefore.from("pickup_slots").select("id").eq("id", slotId);
      expect((beforeData ?? []).length).toBe(0);

      await client.query(`delete from job_queue where job_type = 'expire_orders' and store_id is null`);
      await expireOrdersHandler({ id: randomUUID(), store_id: null, job_type: "expire_orders", payload: {}, attempts: 0 });

      expect(await getOrderStatus(client, orderId)).toBe("EXPIRED");

      const { rows: slotAfter } = await client.query<{ booked_count: number; is_open: boolean }>(
        "select booked_count, is_open from pickup_slots where id = $1",
        [slotId],
      );
      expect(slotAfter[0].booked_count).toBe(0);
      expect(slotAfter[0].is_open).toBe(true);

      // The real product-facing proof: anon, through the actual PostgREST
      // API and the actual RLS policy, can see the slot again.
      const anonAfter = anonClient();
      const { data: afterData, error: afterError } = await anonAfter.from("pickup_slots").select("id, booked_count, is_open").eq("id", slotId);
      expect(afterError).toBeNull();
      expect(afterData).toHaveLength(1);
      expect(afterData![0].is_open).toBe(true);
      expect(afterData![0].booked_count).toBe(0);

      const history = await getHistoryRows(client, orderId);
      expect(history).toHaveLength(1);
      expect(history[0].from_status).toBe("PENDING_PAYMENT");
      expect(history[0].to_status).toBe("EXPIRED");
      expect(history[0].actor).toBeNull();
      expect(history[0].actor_type).toBe("system");
    } finally {
      await client.query(`delete from job_queue where job_type = 'expire_orders' and store_id is null`);
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. order_status_history RLS
// ---------------------------------------------------------------------------

describe("WBS 5.7 — order_status_history RLS: owning merchant only, never anon, never a different merchant", () => {
  it("REQUIRED: anon sees zero rows while service_role proves rows exist for this order", async () => {
    if (!dbAvailable || !apiAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "PENDING_PAYMENT" });
      await callTransitionOrder(client, order.id, "CANCELLED", merchantA.merchantId, "merchant");

      const anon = anonClient();
      const { data: asAnon, error: anonError } = await anon.from("order_status_history").select("*").eq("order_id", order.id);
      expect(anonError).toBeNull();
      expect((asAnon ?? []).length).toBe(0);

      const svc = serviceClient();
      const { data: asAdmin, error: adminError } = await svc.from("order_status_history").select("*").eq("order_id", order.id);
      expect(adminError).toBeNull();
      expect((asAdmin ?? []).length).toBeGreaterThan(0);
    } finally {
      await client.end();
    }
  });

  it("REQUIRED: merchant B (does not own the store) sees zero rows for merchant A's order, even though it genuinely exists", async () => {
    if (!dbAvailable || !apiAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "PENDING_PAYMENT" });
      await callTransitionOrder(client, order.id, "CANCELLED", merchantA.merchantId, "merchant");

      const clientB = authenticatedClient(merchantB.authUserId);
      const { data, error } = await clientB.from("order_status_history").select("*").eq("order_id", order.id);
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(0);

      const svc = serviceClient();
      const { data: asAdmin } = await svc.from("order_status_history").select("*").eq("order_id", order.id);
      expect((asAdmin ?? []).length).toBeGreaterThan(0);
    } finally {
      await client.end();
    }
  });

  it("merchant A (the owning store's merchant) CAN read the history row for their own order", async () => {
    if (!dbAvailable || !apiAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "PENDING_PAYMENT" });
      await callTransitionOrder(client, order.id, "CANCELLED", merchantA.merchantId, "merchant");

      const clientA = authenticatedClient(merchantA.authUserId);
      const { data, error } = await clientA.from("order_status_history").select("from_status, to_status").eq("order_id", order.id);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0]).toMatchObject({ from_status: "PENDING_PAYMENT", to_status: "CANCELLED" });
    } finally {
      await client.end();
    }
  });

  it("order_status_history is append-only: UPDATE and DELETE both raise, even for service_role's own direct pg write", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "PENDING_PAYMENT" });
      await callTransitionOrder(client, order.id, "CANCELLED", merchantA.merchantId, "merchant");

      await expect(
        client.query("update order_status_history set to_status = 'HACKED' where order_id = $1", [order.id]),
      ).rejects.toThrow(/append-only/);

      await expect(client.query("delete from order_status_history where order_id = $1", [order.id])).rejects.toThrow(/append-only/);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 6. RL-1: refund_status is a flag only, never a money-movement path;
//    CANCELLED -> REFUNDED gated on refund_status = 'pending'.
// ---------------------------------------------------------------------------

describe("WBS 5.7 — RL-1: refund_status is a flag column only, CANCELLED->REFUNDED gated on it", () => {
  it("refund_status is a text column with a check constraint restricted to ('pending','done') — not a numeric balance, not a FK to any wallet/escrow/payout table", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows: colRows } = await client.query<{ data_type: string }>(
        `select data_type from information_schema.columns where table_name = 'orders' and column_name = 'refund_status'`,
      );
      expect(colRows[0].data_type).toBe("text");

      const { rows: constraintRows } = await client.query<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint
          where conrelid = 'orders'::regclass and conname = 'orders_refund_status_check'`,
      );
      expect(constraintRows).toHaveLength(1);
      expect(constraintRows[0].def).toMatch(/'pending'::text, 'done'::text/);

      // No FK on refund_status, and no balance/wallet/escrow/payout table
      // exists anywhere in the schema (RL-1 structural proof, 0020) — this
      // file's own narrower check: refund_status carries no foreign key at
      // all, i.e. it cannot even point at such a table if one existed.
      const { rows: fkRows } = await client.query<{ n: string }>(
        `select count(*)::int as n from information_schema.key_column_usage
          where table_name = 'orders' and column_name = 'refund_status'`,
      );
      expect(Number(fkRows[0].n)).toBe(0);
    } finally {
      await client.end();
    }
  });

  it("transition_order's own function body contains no reference to a balance/wallet/escrow/payout table or column", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query<{ def: string }>(
        `select pg_get_functiondef(oid) as def from pg_proc where proname = 'transition_order'`,
      );
      const body = rows[0].def.toLowerCase();
      expect(body).not.toMatch(/\bbalance\b/);
      expect(body).not.toMatch(/\bescrow\b/);
      expect(body).not.toMatch(/\bwallet\b/);
      expect(body).not.toMatch(/\bpayout\b/);
      // What it DOES do: write exactly the flag.
      expect(body).toMatch(/refund_status = 'pending'/);
    } finally {
      await client.end();
    }
  });

  it("REQUIRED: CANCELLED -> REFUNDED is blocked (BL001) when refund_status is NULL — an order cancelled while still PENDING_PAYMENT, where nothing was ever owed", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "CANCELLED", refundStatus: null });
      await expect(callTransitionOrder(client, order.id, "REFUNDED", merchantA.merchantId, "merchant")).rejects.toMatchObject({
        code: "BL001",
      });
      expect(await getOrderStatus(client, order.id)).toBe("CANCELLED"); // unchanged
      expect(await getHistoryRows(client, order.id)).toHaveLength(0);
    } finally {
      await client.end();
    }
  });

  it("CANCELLED -> REFUNDED is blocked (BL001) when refund_status is 'done' (already resolved — resolving twice is also illegal)", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "CANCELLED", refundStatus: "done" });
      await expect(callTransitionOrder(client, order.id, "REFUNDED", merchantA.merchantId, "merchant")).rejects.toMatchObject({
        code: "BL001",
      });
    } finally {
      await client.end();
    }
  });

  it("CANCELLED -> REFUNDED succeeds when refund_status = 'pending' (a genuinely owed refund)", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "CANCELLED", refundStatus: "pending" });
      await callTransitionOrder(client, order.id, "REFUNDED", merchantA.merchantId, "merchant");
      expect(await getOrderStatus(client, order.id)).toBe("REFUNDED");
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 6b. 0034 regression pass — re-verifying the cascade-delete fix itself, not
//     just re-running the suite it used to break. Three claims from 0034's
//     own migration header, each checked independently rather than trusted:
//       (a) `delete from auth.users` cascades cleanly through merchants ->
//           stores -> orders -> order_status_history with zero orphans and
//           with trg_order_status_history_append_only left ENABLED
//           throughout — no ALTER TABLE ... DISABLE TRIGGER anywhere, unlike
//           this file's own former afterAll workaround (see git history).
//       (b) the append-only guarantee still holds for what it's SUPPOSED to
//           block: a direct, non-cascade UPDATE/DELETE. Already proven above
//           in "order_status_history is append-only: UPDATE and DELETE both
//           raise, even for service_role's own direct pg write" — that test
//           runs unchanged against 0034 and still passes, so it is not
//           duplicated here.
//       (c) order_status_history_order_id_fkey's new DEFERRABLE INITIALLY
//           DEFERRED only moves the check to end-of-transaction; it must not
//           have weakened what gets enforced AT commit.
// ---------------------------------------------------------------------------

describe("WBS 5.7 follow-up (0034) — cascade delete through auth.users needs no trigger disabled", () => {
  it("REQUIRED: delete from auth.users cascades through merchants -> stores -> orders -> order_status_history with zero orphaned rows, trigger left ENABLED throughout", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const fixture = await createMerchantFixture(client, "cascade-orphan-check");

      // Exercise BOTH cascade paths that 0034 had to reconcile: order_id ->
      // orders -> stores -> merchants (ON DELETE CASCADE) AND actor ->
      // merchants directly (ON DELETE SET NULL). Using this merchant as the
      // transition's actor puts a row through the second path.
      const order = await seedOrderInStatus(client, { storeId: fixture.storeId, status: "PENDING_PAYMENT" });
      await callTransitionOrder(client, order.id, "ACCEPTED", fixture.merchantId, "merchant");
      await callTransitionOrder(client, order.id, "PREPARING", fixture.merchantId, "merchant");

      // Prove the data exists before deletion (the adversarial-test
      // discipline this repo uses elsewhere: a zero-row result after
      // deletion is meaningless unless a nonzero count was confirmed first).
      const countsQuery = `select
           (select count(*) from merchants where id = $1) as merchants,
           (select count(*) from stores where merchant_id = $1) as stores,
           (select count(*) from orders where id = $2) as orders,
           (select count(*) from order_status_history where order_id = $2) as history`;
      const before = await client.query<{ merchants: string; stores: string; orders: string; history: string }>(countsQuery, [
        fixture.merchantId,
        order.id,
      ]);
      expect(Number(before.rows[0].merchants)).toBe(1);
      expect(Number(before.rows[0].stores)).toBe(1);
      expect(Number(before.rows[0].orders)).toBe(1);
      expect(Number(before.rows[0].history)).toBe(2); // PENDING_PAYMENT->ACCEPTED, ACCEPTED->PREPARING

      const { rows: trigBefore } = await client.query<{ tgenabled: string }>(
        `select tgenabled from pg_trigger where tgname = 'trg_order_status_history_append_only'`,
      );
      expect(trigBefore[0].tgenabled).toBe("O"); // 'O' = enabled, origin/local role

      // The thing that was actually broken: no DISABLE TRIGGER, no
      // workaround — a plain cascading delete must just work.
      await expect(client.query("delete from auth.users where id = $1", [fixture.authUserId])).resolves.toBeDefined();

      const { rows: trigAfter } = await client.query<{ tgenabled: string }>(
        `select tgenabled from pg_trigger where tgname = 'trg_order_status_history_append_only'`,
      );
      expect(trigAfter[0].tgenabled).toBe("O"); // still enabled — never touched

      const after = await client.query<{ merchants: string; stores: string; orders: string; history: string }>(countsQuery, [
        fixture.merchantId,
        order.id,
      ]);
      expect(Number(after.rows[0].merchants)).toBe(0);
      expect(Number(after.rows[0].stores)).toBe(0);
      expect(Number(after.rows[0].orders)).toBe(0);
      expect(Number(after.rows[0].history)).toBe(0); // REQUIRED: zero orphaned history rows
    } finally {
      await client.end();
    }
  });

  it("REQUIRED: order_status_history_order_id_fkey is DEFERRABLE INITIALLY DEFERRED, and a transaction that does NOT end in a valid state still fails at COMMIT", async () => {
    if (!dbAvailable) return;
    const introspectClient = await connect();
    try {
      const { rows } = await introspectClient.query<{ condeferrable: boolean; condeferred: boolean }>(
        `select condeferrable, condeferred from pg_constraint
          where conrelid = 'order_status_history'::regclass
            and conname = 'order_status_history_order_id_fkey'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].condeferrable).toBe(true);
      expect(rows[0].condeferred).toBe(true); // INITIALLY DEFERRED, not just DEFERRABLE
    } finally {
      await introspectClient.end();
    }

    if (!dbAvailable) return;
    const txClient = await connect();
    try {
      await txClient.query("BEGIN");
      const bogusOrderId = randomUUID(); // deliberately references no row in orders
      // Deferred means this INSERT itself must NOT throw — the FK check is
      // postponed, not skipped.
      await expect(
        txClient.query(
          `insert into order_status_history (order_id, from_status, to_status, actor_type) values ($1, 'PENDING_PAYMENT', 'ACCEPTED', 'system')`,
          [bogusOrderId],
        ),
      ).resolves.toBeDefined();

      // The transaction never fixes the dangling reference, so it must fail
      // at COMMIT — proving the deferral changed only *when* the FK is
      // checked, not *whether* an ultimately-invalid state is rejected.
      let commitError: TransitionError | undefined;
      try {
        await txClient.query("COMMIT");
      } catch (err) {
        commitError = err as TransitionError;
      }
      expect(commitError).toBeDefined();
      expect(commitError?.code).toBe("23503"); // foreign_key_violation
      expect(commitError?.message).toMatch(/order_status_history_order_id_fkey/);
    } finally {
      await txClient.end(); // COMMIT failure leaves the session aborted; ending it is the cleanup, matching the standard pg client discard-on-abort pattern
    }

    // Confirm on a fresh connection that the failed COMMIT left no trace —
    // the deferred check did not let a bad row slip through to disk.
    const verifyClient = await connect();
    try {
      const { rows } = await verifyClient.query<{ n: string }>(
        `select count(*) as n from order_status_history where from_status = 'PENDING_PAYMENT' and to_status = 'ACCEPTED' and actor_type = 'system' and actor is null`,
      );
      // This predicate could in principle match an unrelated legitimate row;
      // in this suite's fixtures every system-actor row comes from the
      // expiry-sweep test (PENDING_PAYMENT -> EXPIRED), never
      // PENDING_PAYMENT -> ACCEPTED, so a nonzero count here would only mean
      // the deferred FK failed to roll back the bogus insert.
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      await verifyClient.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 6c. redline_reviewer finding on 0034, fixed by 0035: `pg_trigger_depth() >
//     1` alone exempted ANY nested-trigger context, not specifically the two
//     legitimate RI-cascade shapes. Reproducing the reviewer's exact
//     mechanism — an ordinary, unrelated trigger nested one level deep that
//     tampers with order_status_history — must still be blocked.
// ---------------------------------------------------------------------------

describe("WBS 5.7 follow-up (0035) — narrowed cascade exemption still blocks an innocent-looking nested trigger's tampering write", () => {
  it("REQUIRED: an unrelated AFTER INSERT trigger on a scratch table that directly UPDATEs order_status_history.to_status at pg_trigger_depth() 2 is blocked, not just depth-1 direct writes", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    const suffix = randomUUID().replace(/-/g, "");
    const scratchTable = `qa_5_7_scratch_${suffix}`;
    const scratchFn = `qa_5_7_scratch_fn_${suffix}`;
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "PENDING_PAYMENT" });
      await callTransitionOrder(client, order.id, "CANCELLED", merchantA.merchantId, "merchant");
      const before = await getHistoryRows(client, order.id);
      expect(before).toHaveLength(1);
      expect(before[0].to_status).toBe("CANCELLED");

      // Same mechanism the reviewer proved live: a scratch table with a
      // plain AFTER INSERT trigger whose body UPDATEs order_status_history
      // as a side effect. Firing it via a normal INSERT runs that UPDATE at
      // pg_trigger_depth() 2 — the same depth a genuine RI cascade runs at —
      // but it is not one, and 0034's blanket depth > 1 exemption let it
      // through unblocked.
      await client.query(`create table ${scratchTable} (id uuid primary key default gen_random_uuid(), order_id uuid not null)`);
      await client.query(`
        create function ${scratchFn}() returns trigger language plpgsql as $fn$
        begin
          update order_status_history set to_status = 'HACKED' where order_id = NEW.order_id;
          return NEW;
        end;
        $fn$;
      `);
      await client.query(`create trigger trg_${scratchFn} after insert on ${scratchTable} for each row execute function ${scratchFn}()`);

      await expect(client.query(`insert into ${scratchTable} (order_id) values ($1)`, [order.id])).rejects.toThrow(/append-only/);

      const after = await getHistoryRows(client, order.id);
      expect(after).toHaveLength(1);
      expect(after[0].to_status).toBe("CANCELLED"); // unchanged — never became "HACKED"
    } finally {
      await client.query(`drop table if exists ${scratchTable} cascade`);
      await client.query(`drop function if exists ${scratchFn}()`);
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. CI scanner: scripts/scan-order-status-bypass.mjs. No DB needed — always
//    runs regardless of dbAvailable.
// ---------------------------------------------------------------------------

describe("WBS 5.7 — scripts/scan-order-status-bypass.mjs", () => {
  it("REQUIRED: the real repo (apps, supabase/functions, worker) is currently clean — zero hits", () => {
    const hits = scanForOrderStatusBypass(["apps", "supabase/functions", "worker"]);
    expect(hits).toEqual([]);
  });

  it("REQUIRED: catches a deliberately introduced direct `.update({ status: 'ACCEPTED' })` write outside lifecycle.ts", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-5-7-scan-bypass-"));
    try {
      const badFile = join(dir, "badRoute.ts");
      writeFileSync(
        badFile,
        `import { supabase } from "./client";\nexport async function bypass(orderId: string) {\n  await supabase.from("orders").update({ status: 'ACCEPTED' }).eq("id", orderId);\n}\n`,
      );
      const hits = scanForOrderStatusBypass([dir]);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.some((h: { file: string }) => h.file.includes("badRoute.ts"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("REQUIRED: catches a deliberately introduced direct SQL `update orders ... set status = ...` in application code", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-5-7-scan-bypass-sql-"));
    try {
      const badFile = join(dir, "badSql.ts");
      writeFileSync(
        badFile,
        `export const q = \`\n  update orders\n     set status = 'CANCELLED'\n   where id = $1\n\`;\n`,
      );
      const hits = scanForOrderStatusBypass([dir]);
      expect(hits.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT false-positive on a legitimate read-filter (`.eq('status', 'PENDING_PAYMENT')` / `WHERE status = ...` for a SELECT, not a write)", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-5-7-scan-bypass-readfilter-"));
    try {
      const goodFile = join(dir, "readFilter.ts");
      writeFileSync(
        goodFile,
        `export async function listPending(supabase: any) {\n  return supabase.from("orders").select("*").eq("status", "PENDING_PAYMENT");\n}\n` +
          `export const sweepQuery = \`select id from orders where status = 'PENDING_PAYMENT' and expires_at < now() limit 100\`;\n`,
      );
      const hits = scanForOrderStatusBypass([dir]);
      expect(hits).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT false-positive on a test-fixture helper building a mock order row with a given status", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-5-7-scan-bypass-fixture-"));
    try {
      // Mirrors worker/tests/expireOrders.test.ts's own insertOrder({ status: "ACCEPTED" }).
      const fixtureFile = join(dir, "fixture.test.ts");
      writeFileSync(
        fixtureFile,
        `export function insertOrder(opts: { status?: string }) {\n  return { status: opts.status ?? "ACCEPTED" };\n}\n`,
      );
      const hits = scanForOrderStatusBypass([dir]);
      expect(hits).toEqual([]); // test files are skipped by isTestFile()
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does NOT false-positive on the allow-listed lifecycle.ts file itself", () => {
    // Real file, real path relative to repo root — exercises the ALLOWED_FILES set directly.
    const hits = scanForOrderStatusBypass(["supabase/functions/_shared/orders"]);
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 8. console_confirm_payment / console_reject_payment regression: they now
//    delegate to transition_order (0033) and must still write a correct
//    order_status_history row as a NEW consequence of that delegation. The
//    exhaustive WBS 5.6 behavior regression (idempotency, 10-concurrent,
//    cross-tenant, rollback) already lives in payment_confirmation.test.ts —
//    run alongside this file, not re-asserted here.
// ---------------------------------------------------------------------------

describe("WBS 5.7 — console_confirm_payment / console_reject_payment now write order_status_history via transition_order", () => {
  it("console_confirm_payment writes one PENDING_PAYMENT -> ACCEPTED history row with actor_type='merchant'", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "PENDING_PAYMENT" });
      await client.query(
        `insert into payments (order_id, store_id, method, payee_alias, amount_satang, status) values ($1, $2, 'promptpay_direct', 'qa-5-7-payee', 5000, 'pending')`,
        [order.id, merchantA.storeId],
      );

      // NOT inside withRollback/BEGIN, so `local: true` would only scope to
      // a single implicit-transaction statement and be gone by the next
      // query (packages/db/tests/payment_confirmation.test.ts's own
      // asMerchant() docstring makes this exact distinction) — use the
      // session-scoped form throughout.
      await client.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ sub: merchantA.authUserId, role: "authenticated" }),
      ]);
      await client.query("set role authenticated");
      const { rows } = await client.query("select console_confirm_payment($1, $2) as result", [order.id, merchantA.merchantId]);
      expect(rows[0].result.ok).toBe(true);
      await client.query("reset role");

      const history = await getHistoryRows(client, order.id);
      expect(history).toHaveLength(1);
      expect(history[0].from_status).toBe("PENDING_PAYMENT");
      expect(history[0].to_status).toBe("ACCEPTED");
      expect(history[0].actor).toBe(merchantA.merchantId);
      expect(history[0].actor_type).toBe("merchant");
    } finally {
      await client.end();
    }
  });

  it("console_reject_payment writes one PENDING_PAYMENT -> EXPIRED history row with actor_type='merchant'", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const order = await seedOrderInStatus(client, { storeId: merchantA.storeId, status: "PENDING_PAYMENT" });

      await client.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ sub: merchantA.authUserId, role: "authenticated" }),
      ]);
      await client.query("set role authenticated");
      const { rows } = await client.query("select console_reject_payment($1) as result", [order.id]);
      expect(rows[0].result.ok).toBe(true);
      await client.query("reset role");

      const history = await getHistoryRows(client, order.id);
      expect(history).toHaveLength(1);
      expect(history[0].from_status).toBe("PENDING_PAYMENT");
      expect(history[0].to_status).toBe("EXPIRED");
      expect(history[0].actor_type).toBe("merchant");
    } finally {
      await client.end();
    }
  });
});
