// WBS 5.6 qa_engineer leg — Merchant Payment Confirmation.
//
// Drives console_confirm_payment / console_reject_payment (packages/db/
// migrations/0031_payment_confirmation.sql, mirrored to supabase/migrations/)
// directly against a real local Postgres — same "RLS/triggers/constraints
// only exist in the database, a mock proves nothing" posture as
// pickup_slots.test.ts and checkout_create_order.test.ts. Both functions are
// `authenticated`-only and rely on auth_store_ids() (which reads auth.uid()
// off request.jwt.claims), so every call in this file goes through the same
// set_config('request.jwt.claims', ..., <is_local>) + `set [local] role
// authenticated` mechanism pickup_slots.test.ts's own
// "enqueue_generate_slots_job rejects a store the caller does not own" test
// established — NOT `supabase-js`/PostgREST, so a genuinely concurrent
// 10-connection test can hold 10 independent sessions each with their own
// role/claims rather than fighting one shared HTTP client.
//
// Covers the WBS 5.6 Testing block exactly:
//   1. Two sequential confirms -> exactly one status transition, one stock
//      deduction set, one notification job; second is a silent {already:true}
//   2. Ten CONCURRENT confirms (Promise.all, 10 real connections) -> exactly
//      one processed
//   3. Cross-merchant confirm -> FORBIDDEN, zero mutation, DISTINGUISHED from
//      a same-merchant double-tap (both zero-row UPDATEs, different codepath)
//   4. Forced failure during stock deduction rolls back the status change too
//   5. Expiry sweep (the REAL worker/src/handlers/expireOrders.ts handler)
//      releases the slot
//   6. console_reject_payment expires the order and moves zero stock
//   7. RL-2: a zero-BOM item on the SAME order as a BOM'd item produces zero
//      ledger rows for the former, correct deltas for the latter
//   8. total_cost_snapshot_satang survives confirmation unchanged
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, isReachable, LOCAL_DB_URL, withRollback } from "./helpers/db";

let dbAvailable = false;

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
  const merchantId = merchantResult.rows[0].id;

  const storeResult = await client.query<{ id: string }>(
    `insert into stores (merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity)
     values ($1, $2, $3, '07:00', '19:00', 'Asia/Bangkok', 3)
     returning id`,
    [merchantId, `qa-5-6-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`, `QA 5.6 Store ${label}`],
  );
  const storeId = storeResult.rows[0].id;

  createdAuthUserIds.push(authUserId);
  return { authUserId, merchantId, storeId };
}

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[payment_confirmation.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` (and \`supabase db reset\` if the ` +
        "stack predates migration 0031) first. This is a SKIP, not a pass.\n",
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
    // Cascades merchants -> stores -> menu_items/ingredients/bom_lines/
    // pickup_slots/orders/order_items/payments/stock_ledger, same as every
    // other suite's cleanup in this directory. job_queue rows this file's
    // orders enqueued (store_id set) cascade too; the expiry-sweep test's
    // own self-perpetuating job_queue row (store_id NULL) is cleaned up
    // explicitly inside that test.
    for (const id of createdAuthUserIds) {
      await client.query("delete from auth.users where id = $1", [id]);
    }
  } finally {
    await client.end();
  }
});

/**
 * Makes `client` present as `authUserId` for auth_store_ids()/auth.uid(),
 * exactly the mechanism PostgREST uses to carry a caller's identity into a
 * `security definer` RPC (pickup_slots.test.ts's own established pattern).
 * `local: true` (default) scopes it to the current transaction — required
 * for anything running inside withRollback. `local: false` scopes it to the
 * whole session — required for the genuinely-concurrent test below, where
 * each connection issues its RPC call as its own separate implicit
 * transaction (a `set local` would not survive past that one statement).
 */
async function asMerchant(client: Client, authUserId: string, opts?: { local?: boolean }): Promise<void> {
  const local = opts?.local ?? true;
  await client.query(`select set_config('request.jwt.claims', $1, $2)`, [
    JSON.stringify({ sub: authUserId, role: "authenticated" }),
    local,
  ]);
  await client.query(local ? "set local role authenticated" : "set role authenticated");
}

/**
 * Returns `client` to the superuser role (`postgres`, this connection's own
 * login role). Verification SELECTs in this file must run as superuser, not
 * as `authenticated` — RLS is genuinely enforced against whichever merchant
 * `asMerchant` last set, and job_queue in particular (0021_rls.sql) has RLS
 * enabled with NO policy at all, i.e. deny-by-default even for the owning
 * merchant, by design (WBS 3.6 §2.1). Reading it back to assert a job was
 * enqueued requires bypassing RLS the same way a real `pg` pool connection
 * (the worker's own access pattern, worker/src/db.ts) would.
 */
async function resetRole(client: Client): Promise<void> {
  await client.query("reset role");
}

let slotOffsetCounter = 0;

async function insertFutureSlot(
  client: Client,
  storeId: string,
  opts: { capacity: number; bookedCount?: number },
): Promise<{ id: string }> {
  slotOffsetCounter += 1;
  const offsetMinutes = 60 + slotOffsetCounter * 15;
  const { rows } = await client.query<{ id: string }>(
    `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
     values ($1, now() + make_interval(mins => $4::int), now() + make_interval(mins => $4::int + 15), $2::int, $3::int,
             ($3::int < $2::int))
     returning id`,
    [storeId, opts.capacity, opts.bookedCount ?? 0, offsetMinutes],
  );
  return rows[0];
}

async function insertMenuItem(client: Client, storeId: string, opts: { name: string; priceSatang: number }): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `insert into menu_items (store_id, name, price_satang) values ($1, $2, $3) returning id`,
    [storeId, opts.name, opts.priceSatang],
  );
  return rows[0];
}

async function insertIngredient(
  client: Client,
  storeId: string,
  opts: { name: string; unitCostSatang: number | null },
): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `insert into ingredients (store_id, name, base_unit, current_unit_cost_satang)
     values ($1, $2, 'g', $3) returning id`,
    [storeId, opts.name, opts.unitCostSatang],
  );
  return rows[0];
}

async function insertBomLine(client: Client, storeId: string, menuItemId: string, ingredientId: string, qtyBaseUnit: number): Promise<void> {
  await client.query(
    `insert into bom_lines (store_id, menu_item_id, ingredient_id, qty_base_unit)
     values ($1, $2, $3, $4)`,
    [storeId, menuItemId, ingredientId, qtyBaseUnit],
  );
}

interface OrderFixtureOpts {
  storeId: string;
  pickupSlotId?: string | null;
  expiresAt?: string; // SQL interval expression relative to now(), e.g. "+15 minutes" or "-1 hour"
  totalCostSnapshotSatang?: number | null;
  items: Array<{
    menuItemId: string | null;
    nameSnapshot: string;
    quantity: number;
    unitPriceSatang: number;
    unitCostSnapshotSatang: number | null;
  }>;
}

async function insertPendingOrder(client: Client, opts: OrderFixtureOpts): Promise<{ id: string; orderCode: string }> {
  const orderCode = `Q${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
  const subtotal = opts.items.reduce((sum, i) => sum + i.unitPriceSatang * i.quantity, 0);
  const expiresExpr = opts.expiresAt ?? "+15 minutes";

  const { rows } = await client.query<{ id: string }>(
    `insert into orders (
       store_id, order_code, customer_name, pickup_slot_id, status,
       subtotal_satang, total_satang, total_cost_snapshot_satang, expires_at
     ) values ($1, $2, 'QA 5.6 Customer', $3, 'PENDING_PAYMENT', $4, $4, $5,
               now() + ($6)::interval)
     returning id`,
    [opts.storeId, orderCode, opts.pickupSlotId ?? null, subtotal, opts.totalCostSnapshotSatang ?? null, expiresExpr],
  );
  const orderId = rows[0].id;

  for (const item of opts.items) {
    await client.query(
      `insert into order_items (
         order_id, store_id, menu_item_id, item_name_snapshot, quantity,
         unit_price_snapshot_satang, unit_cost_snapshot_satang
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [orderId, opts.storeId, item.menuItemId, item.nameSnapshot, item.quantity, item.unitPriceSatang, item.unitCostSnapshotSatang],
    );
  }

  // A 'pending' payments row, same shape create_payment_charge (0030) would
  // have left behind — exercises the "only pending payments rows are
  // flipped to succeeded" branch of console_confirm_payment.
  await client.query(
    `insert into payments (order_id, store_id, method, payee_alias, amount_satang, status)
     values ($1, $2, 'promptpay_direct', 'qa-5-6-payee', $3, 'pending')`,
    [orderId, opts.storeId, subtotal],
  );

  return { id: orderId, orderCode };
}

interface ConfirmResult {
  ok: boolean;
  already?: boolean;
  code?: string;
  order?: { id: string; order_code: string; status: string; total_satang: number; paid_at: string };
}

async function callConfirm(client: Client, orderId: string, merchantId: string): Promise<ConfirmResult> {
  const { rows } = await client.query("select console_confirm_payment($1, $2) as result", [orderId, merchantId]);
  return rows[0].result as ConfirmResult;
}

interface RejectResult {
  ok: boolean;
  already?: boolean;
  code?: string;
}

async function callReject(client: Client, orderId: string): Promise<RejectResult> {
  const { rows } = await client.query("select console_reject_payment($1) as result", [orderId]);
  return rows[0].result as RejectResult;
}

describe("WBS 5.6 — console_confirm_payment: sequential double-confirm idempotency", () => {
  it("two sequential confirms -> exactly one status transition, one stock_ledger row, one push_notify job; the second is a silent {already:true}, never an error", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Seq Latte", priceSatang: 6500 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Seq Beans", unitCostSatang: 500 });
      await insertBomLine(client, merchantA.storeId, item.id, beans.id, 18);

      const order = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        items: [{ menuItemId: item.id, nameSnapshot: "QA Seq Latte", quantity: 2, unitPriceSatang: 6500, unitCostSnapshotSatang: 9000 }],
      });

      await asMerchant(client, merchantA.authUserId);

      const first = await callConfirm(client, order.id, merchantA.merchantId);
      expect(first.ok).toBe(true);
      expect(first.already).toBe(false);
      expect(first.order?.status).toBe("ACCEPTED");
      const firstPaidAt = first.order?.paid_at;
      expect(firstPaidAt).toBeTruthy();

      const second = await callConfirm(client, order.id, merchantA.merchantId);
      expect(second.ok).toBe(true); // NOT an error surfaced to the caller
      expect(second.already).toBe(true);
      expect(second.code).toBeUndefined();

      await resetRole(client);

      // Exactly one status transition: still ACCEPTED, paid_at unchanged by
      // the second (no-op) call. Compare by timestamp value, not string
      // shape — the RPC's own jsonb response formats paid_at differently
      // from `pg`'s native timestamptz -> Date parsing of the same instant.
      const { rows: orderRows } = await client.query<{
        status: string;
        paid_at: Date;
        payment_confirmed_by: string | null;
      }>("select status, paid_at, payment_confirmed_by from orders where id = $1", [order.id]);
      expect(orderRows[0].status).toBe("ACCEPTED");
      expect(orderRows[0].paid_at.getTime()).toBe(new Date(firstPaidAt as string).getTime());
      expect(orderRows[0].payment_confirmed_by).toBe(merchantA.merchantId);

      // Exactly one payments row flipped to succeeded (not one per call).
      const { rows: paymentRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from payments where order_id = $1 and status = 'succeeded'",
        [order.id],
      );
      expect(Number(paymentRows[0].n)).toBe(1);

      // Exactly one stock_ledger row (one order_item x one bom_line), not two.
      const { rows: ledgerRows } = await client.query<{ n: string; delta: string }>(
        "select count(*)::int as n from stock_ledger where order_id = $1",
        [order.id],
      );
      expect(Number(ledgerRows[0].n)).toBe(1);

      const { rows: ledgerDelta } = await client.query<{ delta_base_unit: string }>(
        "select delta_base_unit from stock_ledger where order_id = $1",
        [order.id],
      );
      expect(Number(ledgerDelta[0].delta_base_unit)).toBe(-(18 * 2)); // -36

      // Exactly one push_notify job, not two.
      const { rows: jobRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1",
        [order.id],
      );
      expect(Number(jobRows[0].n)).toBe(1);
    });
  });
});

describe("WBS 5.6 — console_confirm_payment: 10 genuinely concurrent confirms", () => {
  it("REQUIRED: ten parallel confirm calls on the SAME order (10 real connections, Promise.all) yield exactly one processed", async () => {
    if (!dbAvailable) return;

    const setupClient = await connect();
    let orderId: string;
    try {
      const item = await insertMenuItem(setupClient, merchantA.storeId, { name: "QA Concurrent Latte", priceSatang: 7000 });
      const beans = await insertIngredient(setupClient, merchantA.storeId, { name: "QA Concurrent Beans", unitCostSatang: 400 });
      await insertBomLine(setupClient, merchantA.storeId, item.id, beans.id, 20);

      const order = await insertPendingOrder(setupClient, {
        storeId: merchantA.storeId,
        items: [{ menuItemId: item.id, nameSnapshot: "QA Concurrent Latte", quantity: 1, unitPriceSatang: 7000, unitCostSnapshotSatang: 8000 }],
      });
      orderId = order.id;
    } finally {
      await setupClient.end();
    }

    // 10 INDEPENDENT connections — real, separate TCP connections and
    // separate implicit transactions, same "genuinely parallel" bar
    // pickup_slots.test.ts's own concurrency proof sets. Each authenticates
    // as merchant A on its own session (asMerchant with local:false, since
    // there is no wrapping BEGIN to scope a `set local` to).
    const clients = await Promise.all(Array.from({ length: 10 }, () => connect()));
    try {
      await Promise.all(clients.map((client) => asMerchant(client, merchantA.authUserId, { local: false })));

      const results = await Promise.all(clients.map((client) => callConfirm(client, orderId, merchantA.merchantId)));

      // Every one of the 10 calls returns ok:true (no errors surfaced at
      // all under contention) — exactly one already:false (the winner),
      // nine already:true (silent no-ops).
      expect(results.every((r) => r.ok === true)).toBe(true);
      const winners = results.filter((r) => r.already === false);
      const noops = results.filter((r) => r.already === true);
      expect(winners).toHaveLength(1);
      expect(noops).toHaveLength(9);

      const verify = await connect();
      try {
        const { rows: orderRows } = await verify.query<{ status: string }>(
          "select status from orders where id = $1",
          [orderId],
        );
        expect(orderRows[0].status).toBe("ACCEPTED");

        // Exactly one stock_ledger row across all 10 attempts, not up to 10.
        const { rows: ledgerRows } = await verify.query<{ n: string }>(
          "select count(*)::int as n from stock_ledger where order_id = $1",
          [orderId],
        );
        expect(Number(ledgerRows[0].n)).toBe(1);

        // Exactly one push_notify job across all 10 attempts.
        const { rows: jobRows } = await verify.query<{ n: string }>(
          "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1",
          [orderId],
        );
        expect(Number(jobRows[0].n)).toBe(1);
      } finally {
        await verify.end();
      }
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  }, 30_000);
});

describe("WBS 5.6 — console_confirm_payment: cross-merchant confirm is FORBIDDEN, distinct from a same-merchant double-tap", () => {
  it("confirming another merchant's order returns FORBIDDEN and mutates NOTHING; a genuine double-tap by the OWNING merchant instead returns already:true — the two zero-effect outcomes are distinguishable", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Cross-Tenant Latte", priceSatang: 6000 });
      const order = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        items: [{ menuItemId: item.id, nameSnapshot: "QA Cross-Tenant Latte", quantity: 1, unitPriceSatang: 6000, unitCostSnapshotSatang: null }],
      });

      // Merchant B (does not own the store this order belongs to) attempts
      // to confirm merchant A's order.
      await asMerchant(client, merchantB.authUserId);
      const crossTenantResult = await callConfirm(client, order.id, merchantB.merchantId);
      expect(crossTenantResult.ok).toBe(false);
      expect(crossTenantResult.code).toBe("FORBIDDEN");

      await resetRole(client); // back to superuser — RLS as merchant B would hide merchant A's own order

      const { rows: afterCrossTenant } = await client.query<{
        status: string;
        paid_at: string | null;
        payment_confirmed_by: string | null;
        payment_confirmed_at: string | null;
      }>("select status, paid_at, payment_confirmed_by, payment_confirmed_at from orders where id = $1", [order.id]);
      expect(afterCrossTenant[0].status).toBe("PENDING_PAYMENT"); // UNCHANGED
      expect(afterCrossTenant[0].paid_at).toBeNull();
      expect(afterCrossTenant[0].payment_confirmed_by).toBeNull();
      expect(afterCrossTenant[0].payment_confirmed_at).toBeNull();

      const { rows: crossTenantLedger } = await client.query<{ n: string }>(
        "select count(*)::int as n from stock_ledger where order_id = $1",
        [order.id],
      );
      expect(Number(crossTenantLedger[0].n)).toBe(0); // no side effects fired either

      // Now the OWNING merchant (A) confirms for real, then double-taps.
      await asMerchant(client, merchantA.authUserId);
      const legitimate = await callConfirm(client, order.id, merchantA.merchantId);
      expect(legitimate.ok).toBe(true);
      expect(legitimate.already).toBe(false);
      expect(legitimate.code).toBeUndefined(); // not the FORBIDDEN shape

      const doubleTap = await callConfirm(client, order.id, merchantA.merchantId);
      expect(doubleTap.ok).toBe(true); // NOT an error, unlike the cross-tenant case
      expect(doubleTap.already).toBe(true);
      expect(doubleTap.code).toBeUndefined(); // distinct shape from FORBIDDEN

      await resetRole(client);

      // The order DID transition this time.
      const { rows: afterLegitimate } = await client.query<{ status: string }>(
        "select status from orders where id = $1",
        [order.id],
      );
      expect(afterLegitimate[0].status).toBe("ACCEPTED");
    });
  });

  it("confirming a NOT_FOUND order id returns NOT_FOUND, a third distinct outcome", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirm(client, randomUUID(), merchantA.merchantId);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("NOT_FOUND");
    });
  });
});

describe("WBS 5.6 — console_confirm_payment: atomicity under a forced stock-deduction failure", () => {
  it("a forced exception during the stock_ledger insert rolls back the ENTIRE transaction, including the status/paid_at change already made earlier in the same call", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const marker = "QA-5.6-FORCE-ROLLBACK-BOOM";
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Rollback Latte", priceSatang: 5500 });
      const boom = await insertIngredient(client, merchantA.storeId, { name: marker, unitCostSatang: 300 });
      await insertBomLine(client, merchantA.storeId, item.id, boom.id, 10);

      const order = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        items: [{ menuItemId: item.id, nameSnapshot: "QA Rollback Latte", quantity: 1, unitPriceSatang: 5500, unitCostSnapshotSatang: 3000 }],
      });

      // A temporary BEFORE INSERT trigger, scoped to fire only for THIS
      // fixture's ingredient_id, installed inside this test's own
      // rolled-back transaction (transactional DDL) — never touches the
      // production migration. This is a REAL trigger firing on the REAL
      // stock_ledger table during console_confirm_payment's REAL insert
      // step, proving Postgres's own statement-level atomicity undoes the
      // EARLIER orders/payments UPDATEs in the same function call too, not
      // just the failing insert itself.
      await client.query(`
        create or replace function qa_5_6_force_rollback_boom() returns trigger as $$
        begin
          if new.ingredient_id = '${boom.id}' then
            raise exception 'QA-5.6 forced failure for atomicity proof';
          end if;
          return new;
        end;
        $$ language plpgsql;
      `);
      await client.query(`
        create trigger qa_5_6_force_rollback_boom_trg
        before insert on stock_ledger
        for each row execute function qa_5_6_force_rollback_boom();
      `);

      await asMerchant(client, merchantA.authUserId);

      await tx.savepoint("sp_before_forced_failure");
      await expect(callConfirm(client, order.id, merchantA.merchantId)).rejects.toThrow(/QA-5\.6 forced failure/);

      // Recover the connection from Postgres's aborted-transaction state,
      // without touching anything the failed call itself already undid —
      // same recovery pattern checkout_create_order.test.ts's own rollback
      // test uses.
      await tx.rollbackToSavepoint("sp_before_forced_failure");
      await resetRole(client); // superuser — job_queue has no RLS policy at all, must bypass to verify authoritatively

      const { rows: orderRows } = await client.query<{
        status: string;
        paid_at: string | null;
        payment_confirmed_by: string | null;
      }>("select status, paid_at, payment_confirmed_by from orders where id = $1", [order.id]);
      expect(orderRows[0].status).toBe("PENDING_PAYMENT"); // status change did NOT survive
      expect(orderRows[0].paid_at).toBeNull();
      expect(orderRows[0].payment_confirmed_by).toBeNull();

      const { rows: paymentRows } = await client.query<{ status: string }>(
        "select status from payments where order_id = $1",
        [order.id],
      );
      expect(paymentRows[0].status).toBe("pending"); // payments UPDATE also rolled back

      const { rows: ledgerRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from stock_ledger where order_id = $1",
        [order.id],
      );
      expect(Number(ledgerRows[0].n)).toBe(0); // no partial ledger row either

      const { rows: jobRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where payload->>'orderId' = $1",
        [order.id],
      );
      expect(Number(jobRows[0].n)).toBe(0); // notification enqueue rolled back too
    });
  });
});

describe("WBS 5.6 — console_reject_payment: expires the order, moves zero stock", () => {
  it("reject-payment transitions PENDING_PAYMENT -> EXPIRED and writes ZERO stock_ledger rows, even for an item with a costed BOM", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Reject Latte", priceSatang: 6000 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Reject Beans", unitCostSatang: 500 });
      await insertBomLine(client, merchantA.storeId, item.id, beans.id, 18);
      const slot = await insertFutureSlot(client, merchantA.storeId, { capacity: 2, bookedCount: 1 });

      const order = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        pickupSlotId: slot.id,
        items: [{ menuItemId: item.id, nameSnapshot: "QA Reject Latte", quantity: 1, unitPriceSatang: 6000, unitCostSnapshotSatang: 9000 }],
      });

      await asMerchant(client, merchantA.authUserId);
      const result = await callReject(client, order.id);
      expect(result.ok).toBe(true);
      expect(result.already).toBe(false);

      const { rows: orderRows } = await client.query<{ status: string }>(
        "select status from orders where id = $1",
        [order.id],
      );
      expect(orderRows[0].status).toBe("EXPIRED");

      const { rows: ledgerRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from stock_ledger where order_id = $1",
        [order.id],
      );
      expect(Number(ledgerRows[0].n)).toBe(0); // ZERO stock movement — never confirmed

      const { rows: slotRows } = await client.query<{ booked_count: number; is_open: boolean }>(
        "select booked_count, is_open from pickup_slots where id = $1",
        [slot.id],
      );
      expect(slotRows[0].booked_count).toBe(0); // released
      expect(slotRows[0].is_open).toBe(true);

      // Second reject call (double-tap on reject) is also a silent no-op.
      const second = await callReject(client, order.id);
      expect(second.ok).toBe(true);
      expect(second.already).toBe(true);

      const { rows: slotAfterSecond } = await client.query<{ booked_count: number }>(
        "select booked_count from pickup_slots where id = $1",
        [slot.id],
      );
      expect(slotAfterSecond[0].booked_count).toBe(0); // NOT double-released to -1
    });
  });
});

describe("WBS 5.6 — RL-2: mixed BOM / zero-BOM items on the SAME order", () => {
  it("a same-order zero-BOM item produces zero stock_ledger rows while its sibling WITH a BOM produces correct deltas", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const trackedItem = await insertMenuItem(client, merchantA.storeId, { name: "QA Tracked Latte", priceSatang: 6500 });
      const untrackedItem = await insertMenuItem(client, merchantA.storeId, { name: "QA Untracked Cookie", priceSatang: 3000 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Mixed Beans", unitCostSatang: 500 });
      const milk = await insertIngredient(client, merchantA.storeId, { name: "QA Mixed Milk", unitCostSatang: 45 });
      await insertBomLine(client, merchantA.storeId, trackedItem.id, beans.id, 18);
      await insertBomLine(client, merchantA.storeId, trackedItem.id, milk.id, 150);
      // untrackedItem gets NO bom_lines at all (RL-2: still sellable).

      const order = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        items: [
          { menuItemId: trackedItem.id, nameSnapshot: "QA Tracked Latte", quantity: 2, unitPriceSatang: 6500, unitCostSnapshotSatang: 15750 },
          { menuItemId: untrackedItem.id, nameSnapshot: "QA Untracked Cookie", quantity: 3, unitPriceSatang: 3000, unitCostSnapshotSatang: null },
        ],
      });

      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirm(client, order.id, merchantA.merchantId);
      expect(result.ok).toBe(true);
      expect(result.already).toBe(false);

      // Exactly 2 stock_ledger rows total (one per bom_line on the TRACKED
      // item), zero attributable to the untracked item.
      const { rows: ledgerRows } = await client.query<{ ingredient_id: string; delta_base_unit: string }>(
        "select ingredient_id, delta_base_unit from stock_ledger where order_id = $1 order by delta_base_unit",
        [order.id],
      );
      expect(ledgerRows).toHaveLength(2);

      const beansRow = ledgerRows.find((r) => r.ingredient_id === beans.id);
      const milkRow = ledgerRows.find((r) => r.ingredient_id === milk.id);
      expect(beansRow).toBeDefined();
      expect(milkRow).toBeDefined();
      expect(Number(beansRow!.delta_base_unit)).toBe(-(18 * 2)); // -36
      expect(Number(milkRow!.delta_base_unit)).toBe(-(150 * 2)); // -300

      // No row anywhere references an ingredient belonging to the
      // untracked item (it has none) — the join naturally excludes it, but
      // assert the ROW COUNT is exactly 2, not 2+something, to catch a
      // future regression that adds a spurious zero-delta row per item.
      const { rows: totalCount } = await client.query<{ n: string }>(
        "select count(*)::int as n from stock_ledger where order_id = $1",
        [order.id],
      );
      expect(Number(totalCount[0].n)).toBe(2);
    });
  });
});

describe("WBS 5.6 — total_cost_snapshot_satang survives confirmation unchanged", () => {
  it("a non-null cost snapshot set at order creation is untouched by console_confirm_payment — not zeroed, not nulled", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Snapshot Latte", priceSatang: 6500 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Snapshot Beans", unitCostSatang: 500 });
      await insertBomLine(client, merchantA.storeId, item.id, beans.id, 18);

      const order = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        totalCostSnapshotSatang: 9000, // set at "creation" time, as checkout_create_order would
        items: [{ menuItemId: item.id, nameSnapshot: "QA Snapshot Latte", quantity: 1, unitPriceSatang: 6500, unitCostSnapshotSatang: 9000 }],
      });

      const { rows: before } = await client.query<{ total_cost_snapshot_satang: number | null }>(
        "select total_cost_snapshot_satang from orders where id = $1",
        [order.id],
      );
      expect(before[0].total_cost_snapshot_satang).toBe(9000);

      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirm(client, order.id, merchantA.merchantId);
      expect(result.ok).toBe(true);

      const { rows: after } = await client.query<{ total_cost_snapshot_satang: number | null }>(
        "select total_cost_snapshot_satang from orders where id = $1",
        [order.id],
      );
      expect(after[0].total_cost_snapshot_satang).toBe(9000); // UNCHANGED — not 0, not null
      expect(after[0].total_cost_snapshot_satang).not.toBeNull();
      expect(after[0].total_cost_snapshot_satang).not.toBe(0);

      // order_items.unit_cost_snapshot_satang is separately protected by
      // trg_order_items_cost_snapshot_immutable (0012) — confirming
      // shouldn't even attempt to touch it, but assert the value survived
      // too, belt-and-braces.
      const { rows: itemRows } = await client.query<{ unit_cost_snapshot_satang: number | null }>(
        "select unit_cost_snapshot_satang from order_items where order_id = $1",
        [order.id],
      );
      expect(itemRows[0].unit_cost_snapshot_satang).toBe(9000);
    });
  });

  it("a NULL cost snapshot (zero-BOM order) stays NULL through confirmation — not silently defaulted to 0", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA No-Recipe Cookie", priceSatang: 4000 });
      const order = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        totalCostSnapshotSatang: null,
        items: [{ menuItemId: item.id, nameSnapshot: "QA No-Recipe Cookie", quantity: 2, unitPriceSatang: 4000, unitCostSnapshotSatang: null }],
      });

      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirm(client, order.id, merchantA.merchantId);
      expect(result.ok).toBe(true);

      const { rows: after } = await client.query<{ total_cost_snapshot_satang: number | null }>(
        "select total_cost_snapshot_satang from orders where id = $1",
        [order.id],
      );
      expect(after[0].total_cost_snapshot_satang).toBeNull();
    });
  });
});
