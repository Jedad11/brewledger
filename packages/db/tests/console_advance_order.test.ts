// WBS 5.9 qa_engineer leg — Order Status Update (Merchant Actions), the DB
// wrapper half. Drives console_advance_order (packages/db/migrations/
// 0040_console_advance_order.sql, mirrored to supabase/migrations/) directly
// against a real local Postgres — same "RLS/triggers/constraints only exist
// in the database, a mock proves nothing" posture as
// payment_confirmation.test.ts and pickup_slots.test.ts. Fixtures and the
// asMerchant/resetRole mechanism are copied from payment_confirmation.
// test.ts's own established pattern (set_config('request.jwt.claims', ...)
// + `set role authenticated`, NOT supabase-js/PostgREST) rather than shared
// across files, matching this directory's existing convention.
//
// Scope, per this entry's own WBS 5.9 Claude Code Prompt point 6 and the
// qa_engineer task's point 5 ("does a merchant get rejected — not silently
// no-op, not a 500 — when trying to advance an order belonging to a
// different store?"):
//   1. The legal forward chain (ACCEPTED->PREPARING->READY->COLLECTED)
//      actually calls through to transition_order — status advances, the
//      right job_queue/order_status_history side effects fire.
//   2. p_to outside the allow-list (PREPARING/READY/COLLECTED) is rejected
//      as INVALID_TARGET before any order lookup at all.
//   3. An illegal hop (skipping a step, or acting on a terminal order) comes
//      back as {ok:false, code:'ILLEGAL_TRANSITION'} — a real 409 at the
//      Edge Function layer, never an unhandled 500, and the row is
//      unchanged.
//   4. NOT_FOUND for a nonexistent order id.
//   5. FORBIDDEN for a cross-store attempt — proven distinct from NOT_FOUND,
//      and proven to mutate ZERO rows (status, order_status_history,
//      job_queue all unchanged) — a rejection, not a silent no-op.
//   6. Idempotent double-tap: calling the SAME hop again once the order is
//      already at the target returns {ok:true, already:true}, not an error
//      surfaced to the caller — this is what makes a retried Edge Function
//      call (or a second open tab) safe.
//   7. Ten genuinely concurrent calls (Promise.all, 10 real connections)
//      advancing the SAME order to the SAME target hop yield exactly one
//      real transition and nine already:true — the wrapper this entry adds
//      must not weaken WBS 5.7's own concurrency guarantee.
//
// What this file does NOT re-cover: the full ten-row transition_order
// legality matrix (WBS 5.7's own testing responsibility). console-*
// Edge Function HTTP-status mapping IS covered, live, over real HTTP —
// see supabase/functions/_tests/tenant_isolation.test.ts's
// console-advance-order/console-bulk-ready-orders entries.
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
    [merchantId, `qa-5-9-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`, `QA 5.9 Store ${label}`],
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
      "\n[console_advance_order.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` (and apply migration 0040) first. This is a SKIP, not a pass.\n`,
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
    for (const id of createdAuthUserIds) {
      await client.query("delete from auth.users where id = $1", [id]);
    }
  } finally {
    await client.end();
  }
});

/** Same mechanism payment_confirmation.test.ts's own asMerchant establishes. */
async function asMerchant(client: Client, authUserId: string, opts?: { local?: boolean }): Promise<void> {
  const local = opts?.local ?? true;
  await client.query(`select set_config('request.jwt.claims', $1, $2)`, [
    JSON.stringify({ sub: authUserId, role: "authenticated" }),
    local,
  ]);
  await client.query(local ? "set local role authenticated" : "set role authenticated");
}

async function resetRole(client: Client): Promise<void> {
  await client.query("reset role");
}

/** Inserts an order already sitting at ACCEPTED — this file tests the three
 * forward hops console_advance_order owns (PREPARING/READY/COLLECTED), which
 * all start from a paid order; how an order GETS to ACCEPTED is WBS 5.6/5.7's
 * own testing responsibility, not re-proven here. */
async function insertAcceptedOrder(client: Client, storeId: string, merchantId: string): Promise<{ id: string; orderCode: string }> {
  const orderCode = `Q${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
  const { rows } = await client.query<{ id: string }>(
    `insert into orders (
       store_id, order_code, customer_name, status,
       subtotal_satang, total_satang, paid_at, payment_confirmed_by, payment_confirmed_at
     ) values ($1, $2, 'QA 5.9 Customer', 'ACCEPTED', 6000, 6000, now(), $3, now())
     returning id`,
    [storeId, orderCode, merchantId],
  );
  return { id: rows[0].id, orderCode };
}

async function insertOrderAtStatus(client: Client, storeId: string, merchantId: string, status: string): Promise<{ id: string }> {
  const orderCode = `Q${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
  const { rows } = await client.query<{ id: string }>(
    `insert into orders (
       store_id, order_code, customer_name, status,
       subtotal_satang, total_satang, paid_at, payment_confirmed_by, payment_confirmed_at
     ) values ($1, $2, 'QA 5.9 Customer', $3, 6000, 6000, now(), $4, now())
     returning id`,
    [storeId, orderCode, status, merchantId],
  );
  return { id: rows[0].id };
}

interface AdvanceResult {
  ok: boolean;
  already?: boolean;
  code?: string;
  order?: { id: string; order_code: string; status: string };
}

async function callAdvance(client: Client, orderId: string, to: string): Promise<AdvanceResult> {
  const { rows } = await client.query("select console_advance_order($1, $2) as result", [orderId, to]);
  return rows[0].result as AdvanceResult;
}

describe("WBS 5.9 — console_advance_order: legal forward chain", () => {
  it("ACCEPTED -> PREPARING -> READY -> COLLECTED advances the row and fires the right side effects at each hop", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertAcceptedOrder(client, merchantA.storeId, merchantA.merchantId);
      await asMerchant(client, merchantA.authUserId);

      const toPreparing = await callAdvance(client, order.id, "PREPARING");
      expect(toPreparing.ok).toBe(true);
      expect(toPreparing.already).toBe(false);
      expect(toPreparing.order?.status).toBe("PREPARING");

      const toReady = await callAdvance(client, order.id, "READY");
      expect(toReady.ok).toBe(true);
      expect(toReady.already).toBe(false);
      expect(toReady.order?.status).toBe("READY");

      const toCollected = await callAdvance(client, order.id, "COLLECTED");
      expect(toCollected.ok).toBe(true);
      expect(toCollected.already).toBe(false);
      expect(toCollected.order?.status).toBe("COLLECTED");

      await resetRole(client);

      const { rows: orderRows } = await client.query<{ status: string }>("select status from orders where id = $1", [order.id]);
      expect(orderRows[0].status).toBe("COLLECTED");

      // order_status_history: one row per hop, in order, PREPARING/READY/COLLECTED.
      const { rows: historyRows } = await client.query<{ from_status: string; to_status: string }>(
        "select from_status, to_status from order_status_history where order_id = $1 order by created_at asc",
        [order.id],
      );
      expect(historyRows.map((r) => `${r.from_status}->${r.to_status}`)).toEqual([
        "ACCEPTED->PREPARING",
        "PREPARING->READY",
        "READY->COLLECTED",
      ]);

      // job_queue push_notify: fired for ACCEPTED->PREPARING and
      // PREPARING->READY (transition_order's own "customer_status_update"
      // branch), NOT for READY->COLLECTED (no side-effect branch matches it)
      // — exactly 2 rows, not 3.
      const { rows: jobRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1",
        [order.id],
      );
      expect(Number(jobRows[0].n)).toBe(2);
    });
  });
});

describe("WBS 5.9 — console_advance_order: p_to outside the allow-list is INVALID_TARGET", () => {
  it("rejects a target not in (PREPARING, READY, COLLECTED) before even looking up the order", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      await asMerchant(client, merchantA.authUserId);
      // A nonexistent order id AND an out-of-range target: INVALID_TARGET
      // must win, proving the allow-list check runs before the order lookup
      // (this wrapper is scoped to WBS 5.9's three forward hops only —
      // CANCELLED/REFUNDED belong exclusively to WBS 5.11's own functions).
      const result = await callAdvance(client, randomUUID(), "CANCELLED");
      expect(result.ok).toBe(false);
      expect(result.code).toBe("INVALID_TARGET");
    });
  });

  it("also rejects INVALID_TARGET for a REAL order the caller owns", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertAcceptedOrder(client, merchantA.storeId, merchantA.merchantId);
      await asMerchant(client, merchantA.authUserId);
      const result = await callAdvance(client, order.id, "REFUNDED");
      expect(result.ok).toBe(false);
      expect(result.code).toBe("INVALID_TARGET");

      await resetRole(client);
      const { rows } = await client.query<{ status: string }>("select status from orders where id = $1", [order.id]);
      expect(rows[0].status).toBe("ACCEPTED"); // unchanged
    });
  });
});

describe("WBS 5.9 — console_advance_order: illegal hops are rejected, never a silent no-op, never a 500", () => {
  it("skipping PREPARING (ACCEPTED -> READY directly) returns ILLEGAL_TRANSITION and leaves the row unchanged", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertAcceptedOrder(client, merchantA.storeId, merchantA.merchantId);
      await asMerchant(client, merchantA.authUserId);

      const result = await callAdvance(client, order.id, "READY");
      expect(result.ok).toBe(false);
      expect(result.code).toBe("ILLEGAL_TRANSITION");

      await resetRole(client);
      const { rows: orderRows } = await client.query<{ status: string }>("select status from orders where id = $1", [order.id]);
      expect(orderRows[0].status).toBe("ACCEPTED"); // unchanged — no partial advance

      const { rows: historyRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from order_status_history where order_id = $1",
        [order.id],
      );
      expect(Number(historyRows[0].n)).toBe(0); // no history row for a rejected attempt
    });
  });

  it("advancing a terminal (COLLECTED) order returns ILLEGAL_TRANSITION, not a crash", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertOrderAtStatus(client, merchantA.storeId, merchantA.merchantId, "COLLECTED");
      await asMerchant(client, merchantA.authUserId);

      const result = await callAdvance(client, order.id, "READY");
      expect(result.ok).toBe(false);
      expect(result.code).toBe("ILLEGAL_TRANSITION");

      await resetRole(client);
      const { rows } = await client.query<{ status: string }>("select status from orders where id = $1", [order.id]);
      expect(rows[0].status).toBe("COLLECTED");
    });
  });

  it("advancing a CANCELLED order returns ILLEGAL_TRANSITION, not a crash", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertOrderAtStatus(client, merchantA.storeId, merchantA.merchantId, "CANCELLED");
      await asMerchant(client, merchantA.authUserId);

      const result = await callAdvance(client, order.id, "PREPARING");
      expect(result.ok).toBe(false);
      expect(result.code).toBe("ILLEGAL_TRANSITION");
    });
  });
});

describe("WBS 5.9 — console_advance_order: NOT_FOUND vs FORBIDDEN are distinguishable, and FORBIDDEN mutates nothing", () => {
  it("a nonexistent order id returns NOT_FOUND", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      await asMerchant(client, merchantA.authUserId);
      const result = await callAdvance(client, randomUUID(), "PREPARING");
      expect(result.ok).toBe(false);
      expect(result.code).toBe("NOT_FOUND");
    });
  });

  it("merchant B advancing merchant A's order returns FORBIDDEN — not NOT_FOUND, not a 500, and mutates ZERO rows", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertAcceptedOrder(client, merchantA.storeId, merchantA.merchantId);

      await asMerchant(client, merchantB.authUserId);
      const result = await callAdvance(client, order.id, "PREPARING");
      expect(result.ok).toBe(false);
      expect(result.code).toBe("FORBIDDEN");
      // Distinct outcome from NOT_FOUND — a cross-store id resolves to a
      // real store_id, fails the auth_store_ids() membership check, and is
      // reported as FORBIDDEN rather than pretending the order doesn't exist.

      await resetRole(client); // superuser — RLS as merchant B would hide merchant A's own order entirely

      const { rows: orderRows } = await client.query<{
        status: string;
      }>("select status from orders where id = $1", [order.id]);
      expect(orderRows[0].status).toBe("ACCEPTED"); // UNCHANGED

      const { rows: historyRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from order_status_history where order_id = $1",
        [order.id],
      );
      expect(Number(historyRows[0].n)).toBe(0); // no history row written on a rejected cross-store attempt

      const { rows: jobRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where payload->>'orderId' = $1",
        [order.id],
      );
      expect(Number(jobRows[0].n)).toBe(0); // no side effect fired either

      // Now prove the OWNING merchant can do what B was rejected for, on
      // the exact same row — the FORBIDDEN result was a real rejection, not
      // evidence the row is broken or unreachable.
      await asMerchant(client, merchantA.authUserId);
      const legitimate = await callAdvance(client, order.id, "PREPARING");
      expect(legitimate.ok).toBe(true);
      expect(legitimate.code).toBeUndefined();

      await resetRole(client);
      const { rows: afterLegitimate } = await client.query<{ status: string }>("select status from orders where id = $1", [order.id]);
      expect(afterLegitimate[0].status).toBe("PREPARING");
    });
  });
});

describe("WBS 5.9 — console_advance_order: idempotent double-tap on the same hop", () => {
  it("calling the SAME target twice in a row returns already:true the second time, not an error", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertAcceptedOrder(client, merchantA.storeId, merchantA.merchantId);
      await asMerchant(client, merchantA.authUserId);

      const first = await callAdvance(client, order.id, "PREPARING");
      expect(first.ok).toBe(true);
      expect(first.already).toBe(false);

      const second = await callAdvance(client, order.id, "PREPARING");
      expect(second.ok).toBe(true); // NOT surfaced as an error to the caller
      expect(second.already).toBe(true);
      expect(second.code).toBeUndefined(); // distinct shape from ILLEGAL_TRANSITION/FORBIDDEN

      await resetRole(client);

      // Exactly one history row and one job_queue row, not two.
      const { rows: historyRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from order_status_history where order_id = $1",
        [order.id],
      );
      expect(Number(historyRows[0].n)).toBe(1);

      const { rows: jobRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1",
        [order.id],
      );
      expect(Number(jobRows[0].n)).toBe(1);
    });
  });
});

describe("WBS 5.9 — console_advance_order: 10 genuinely concurrent calls to the same hop", () => {
  it("REQUIRED: ten parallel PREPARING calls on the SAME order (10 real connections, Promise.all) yield exactly one real transition", async () => {
    if (!dbAvailable) return;

    const setupClient = await connect();
    let orderId: string;
    try {
      const order = await insertAcceptedOrder(setupClient, merchantA.storeId, merchantA.merchantId);
      orderId = order.id;
    } finally {
      await setupClient.end();
    }

    // 10 independent connections/sessions — genuinely parallel, same bar
    // payment_confirmation.test.ts's own concurrency proof sets, not 10
    // sequential calls in a loop against one shared client.
    const clients = await Promise.all(Array.from({ length: 10 }, () => connect()));
    try {
      await Promise.all(clients.map((client) => asMerchant(client, merchantA.authUserId, { local: false })));

      const results = await Promise.all(clients.map((client) => callAdvance(client, orderId, "PREPARING")));

      expect(results.every((r) => r.ok === true)).toBe(true); // no errors surfaced under contention
      const winners = results.filter((r) => r.already === false);
      const noops = results.filter((r) => r.already === true);
      expect(winners).toHaveLength(1);
      expect(noops).toHaveLength(9);

      const verify = await connect();
      try {
        const { rows: orderRows } = await verify.query<{ status: string }>("select status from orders where id = $1", [orderId]);
        expect(orderRows[0].status).toBe("PREPARING");

        const { rows: historyRows } = await verify.query<{ n: string }>(
          "select count(*)::int as n from order_status_history where order_id = $1",
          [orderId],
        );
        expect(Number(historyRows[0].n)).toBe(1); // exactly one history row across all 10 attempts

        const { rows: jobRows } = await verify.query<{ n: string }>(
          "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1",
          [orderId],
        );
        expect(Number(jobRows[0].n)).toBe(1); // exactly one notification job, not up to 10
      } finally {
        await verify.end();
      }
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  }, 30_000);
});
