// WBS 5.11 qa_engineer leg — Order Cancellation and Merchant-Initiated Refund.
//
// Drives console_cancel_order / console_resolve_refund (packages/db/
// migrations/0051_console_cancel_order_refund.sql, mirrored byte-identical
// to supabase/migrations/) and the widened public_order_status /
// public_order_lookup RPCs directly against a real local Postgres — same
// "RLS/triggers/constraints only exist in the database, a mock proves
// nothing" posture as console_advance_order.test.ts and
// console_cash_sale.test.ts. Fixtures and the asMerchant/resetRole
// mechanism are copied from those files' own established pattern
// (set_config('request.jwt.claims', ...) + `set [local] role authenticated`,
// NOT supabase-js/PostgREST), matching this directory's existing convention
// of not sharing fixtures across files.
//
// Scope, per the WBS 5.11 Claude Code Prompt's own step 7 Tests list, plus
// docs/db/wbs_5_11_refund_design.md §5's risks explicitly flagged for
// qa_engineer:
//   1. Stock reversal creates a NEW stock_ledger row (reason=
//      'cancellation_reversal'); the original 'sale' row is never edited;
//      net stock (via ingredient_stock_levels) returns to its pre-order
//      level.
//   2. The pickup slot's booked_count/is_open flip back to available after
//      cancellation, and a NEW reservation against the same slot actually
//      succeeds afterward — proves genuine availability, not just a flag.
//   3. A cancelled ACCEPTED order appears in the pending-refund query
//      (store_id + refund_status='pending', the orders_refund_pending_idx
//      predicate) and the ONLY way it leaves that list is
//      console_resolve_refund succeeding.
//   4. A cancelled PENDING_PAYMENT order does NOT appear there —
//      refund_status stays NULL (design doc §5, explicitly flagged).
//   5. console_resolve_refund is idempotent under a sequential double-tap
//      AND under genuine concurrency (10 parallel calls, one winner).
//   6. THE CRITICAL BL001 check (design doc §5): a COLLECTED order cannot
//      be cancelled through console_cancel_order — must come back as
//      {ok:false, code:'ILLEGAL_TRANSITION'}, NEVER {ok:true, already:true}.
//      A version that treats every BL001 as "already at target" would
//      silently swallow this and let a bypassed-UI cancel of a COLLECTED
//      order through undetected.
//   7. The mirror case for resolve: an order cancelled while
//      PENDING_PAYMENT (refund_status stays null) can never be "resolved"
//      — transition_order's own CANCELLED->REFUNDED extra invariant BL001s,
//      and console_resolve_refund must report ILLEGAL_TRANSITION, not
//      already:true, and must not flip refund_status to 'done'.
//   8. cancel_reason persists unchanged across CANCELLED -> REFUNDED, and a
//      double-tapped cancel does not clobber an already-set reason.
//   9. public_order_status / public_order_lookup return cancel_reason and
//      refund_status (RL-3-safe operational fields) and do NOT leak
//      refund_resolved_by/refund_resolved_at.
//   10. Grants: both new RPCs are authenticated-only.
//
// What this file does NOT re-cover: transition_order's full ten-row
// legality matrix (WBS 5.7's own testing responsibility) or
// console_advance_order's forward-hop behaviour (WBS 5.9's own).
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
  const merchantId = merchantResult.rows[0].id;

  const storeResult = await client.query<{ id: string }>(
    `insert into stores (merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity)
     values ($1, $2, $3, '07:00', '19:00', 'Asia/Bangkok', 3)
     returning id`,
    [merchantId, `qa-5-11-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`, `QA 5.11 Store ${label}`],
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
      "\n[console_cancel_order_refund.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` (and \`supabase db reset\` if the stack ` +
        "predates migration 0051) first. This is a SKIP, not a pass.\n",
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

let slotOffsetCounter = 0;

async function insertFutureSlot(client: Client, storeId: string, opts: { capacity: number; bookedCount?: number }): Promise<{ id: string }> {
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
    `insert into bom_lines (store_id, menu_item_id, ingredient_id, qty_base_unit)
     values ($1, $2, $3, $4)`,
    [storeId, menuItemId, ingredientId, qtyBaseUnit],
  );
}

/** A 'purchase' stock_ledger row establishing a known pre-order stock level,
 * so a later reversal test can assert the level returns to THIS exact
 * number, not merely "back to zero". */
async function insertPurchaseLedgerRow(client: Client, storeId: string, ingredientId: string, deltaBaseUnit: number): Promise<void> {
  await client.query(
    `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason) values ($1, $2, $3, 'purchase')`,
    [storeId, ingredientId, deltaBaseUnit],
  );
}

interface OrderFixtureOpts {
  storeId: string;
  merchantId: string;
  status: string;
  pickupSlotId?: string | null;
  paid?: boolean; // sets paid_at/payment_confirmed_by, as a real ACCEPTED+ order would carry
}

async function insertOrder(client: Client, opts: OrderFixtureOpts): Promise<{ id: string; orderCode: string }> {
  const orderCode = `Q${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
  const { rows } = await client.query<{ id: string }>(
    `insert into orders (
       store_id, order_code, customer_name, customer_phone, pickup_slot_id, status,
       subtotal_satang, total_satang, paid_at, payment_confirmed_by, payment_confirmed_at
     ) values ($1, $2, 'QA 5.11 Customer', '+66811110000', $3, $4, 6000, 6000,
               case when $5 then now() else null end,
               case when $5 then $6 else null end,
               case when $5 then now() else null end)
     returning id`,
    [opts.storeId, orderCode, opts.pickupSlotId ?? null, opts.status, opts.paid ?? false, opts.merchantId],
  );
  const orderId = rows[0].id;
  // A minimal order_items row — public_order_status/public_order_lookup
  // INNER JOIN order_items, so a row-less order is invisible to them.
  await client.query(
    `insert into order_items (order_id, store_id, item_name_snapshot, quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang)
     values ($1, $2, 'QA 5.11 Latte', 1, 6000, null)`,
    [orderId, opts.storeId],
  );
  return { id: orderId, orderCode };
}

/** Simulates the 'sale' stock_ledger row transition_order's own
 * PENDING_PAYMENT->ACCEPTED branch would have written, so this file's
 * fixtures can start an order directly at ACCEPTED (matching every other
 * file's convention) while still giving console_cancel_order's reversal
 * logic a real row to reverse. */
async function insertSaleLedgerRow(client: Client, storeId: string, ingredientId: string, orderId: string, deltaBaseUnit: number): Promise<void> {
  await client.query(
    `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, order_id) values ($1, $2, $3, 'sale', $4)`,
    [storeId, ingredientId, deltaBaseUnit, orderId],
  );
}

interface CancelResult {
  ok: boolean;
  already?: boolean;
  code?: string;
  message?: string;
  order?: { id: string; order_code: string; status: string; refund_status: string | null; cancel_reason: string | null };
}

async function callCancel(client: Client, orderId: string, reason: string): Promise<CancelResult> {
  const { rows } = await client.query("select console_cancel_order($1, $2) as result", [orderId, reason]);
  return rows[0].result as CancelResult;
}

interface ResolveResult {
  ok: boolean;
  already?: boolean;
  code?: string;
  order?: { id: string; order_code: string; status: string; refund_status: string | null; refund_resolved_at: string | null };
}

async function callResolve(client: Client, orderId: string): Promise<ResolveResult> {
  const { rows } = await client.query("select console_resolve_refund($1) as result", [orderId]);
  return rows[0].result as ResolveResult;
}

/** Mirrors apps/console's own fetchRefundPending.ts query exactly —
 * store_id + refund_status='pending', the orders_refund_pending_idx
 * predicate — as the merchant would see it under RLS. */
async function queryPendingRefundOrderIds(client: Client, storeId: string): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(
    `select id from orders where store_id = $1 and refund_status = 'pending' order by created_at desc`,
    [storeId],
  );
  return rows.map((r) => r.id);
}

describe("WBS 5.11 — console_cancel_order: stock reversal", () => {
  it("writes a NEW cancellation_reversal row, leaves the original sale row untouched, and net stock (ingredient_stock_levels) returns to its pre-order level", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Cancel Latte", priceSatang: 6000 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Cancel Beans", unitCostSatang: 500 });
      await insertBomLine(client, merchantA.storeId, item.id, beans.id, 18);

      // Pre-order stock level: a 1000g purchase, established BEFORE the
      // order — this is the level a correct reversal must land back on.
      await insertPurchaseLedgerRow(client, merchantA.storeId, beans.id, 1000);

      const order = await insertOrder(client, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "ACCEPTED", paid: true });
      await insertSaleLedgerRow(client, merchantA.storeId, beans.id, order.id, -18); // 1 cup, 18g/cup

      const { rows: beforeLevel } = await client.query<{ stock_base_unit: string }>(
        "select stock_base_unit from ingredient_stock_levels($1) where ingredient_id = $2",
        [merchantA.storeId, beans.id],
      );
      expect(Number(beforeLevel[0].stock_base_unit)).toBe(982); // 1000 - 18, mid-order

      await asMerchant(client, merchantA.authUserId);
      const result = await callCancel(client, order.id, "out_of_stock");
      expect(result.ok).toBe(true);
      expect(result.already).toBe(false);
      expect(result.order?.status).toBe("CANCELLED");
      expect(result.order?.refund_status).toBe("pending"); // was ACCEPTED (paid) -> refund owed
      expect(result.order?.cancel_reason).toBe("out_of_stock");

      await resetRole(client);

      const { rows: ledgerRows } = await client.query<{ id: string; reason: string; delta_base_unit: string }>(
        "select id, reason, delta_base_unit from stock_ledger where order_id = $1 order by created_at asc",
        [order.id],
      );
      expect(ledgerRows).toHaveLength(2);
      expect(ledgerRows[0].reason).toBe("sale");
      expect(Number(ledgerRows[0].delta_base_unit)).toBe(-18); // ORIGINAL row, untouched
      expect(ledgerRows[1].reason).toBe("cancellation_reversal");
      expect(Number(ledgerRows[1].delta_base_unit)).toBe(18); // exact mirror, positive

      const { rows: afterLevel } = await client.query<{ stock_base_unit: string }>(
        "select stock_base_unit from ingredient_stock_levels($1) where ingredient_id = $2",
        [merchantA.storeId, beans.id],
      );
      expect(Number(afterLevel[0].stock_base_unit)).toBe(1000); // back to EXACT pre-order level
    });
  });
});

describe("WBS 5.11 — console_cancel_order: slot release", () => {
  it("releases the pickup slot (booked_count/is_open flip back), and a fresh reservation against the SAME slot succeeds afterward", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const slot = await insertFutureSlot(client, merchantA.storeId, { capacity: 1, bookedCount: 1 }); // full
      const order = await insertOrder(client, {
        storeId: merchantA.storeId,
        merchantId: merchantA.merchantId,
        status: "ACCEPTED",
        pickupSlotId: slot.id,
        paid: true,
      });

      await asMerchant(client, merchantA.authUserId);
      const result = await callCancel(client, order.id, "customer_request");
      expect(result.ok).toBe(true);

      await resetRole(client);

      const { rows: slotAfter } = await client.query<{ booked_count: number; is_open: boolean }>(
        "select booked_count, is_open from pickup_slots where id = $1",
        [slot.id],
      );
      expect(slotAfter[0].booked_count).toBe(0);
      expect(slotAfter[0].is_open).toBe(true);

      // Prove GENUINE availability, not just a flag: a new reservation
      // against this exact slot actually succeeds (service_role, same
      // primitive checkout would call).
      const { rows: reserveRows } = await client.query<{ id: string; booked_count: number }>(
        "select * from reserve_pickup_slot($1)",
        [slot.id],
      );
      expect(reserveRows).toHaveLength(1); // non-empty = the conditional UPDATE applied
      expect(reserveRows[0].booked_count).toBe(1);
    });
  });
});

describe("WBS 5.11 — pending-refund list membership", () => {
  it("a cancelled ACCEPTED order appears in the pending-refund query and is removed ONLY once console_resolve_refund succeeds", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertOrder(client, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "ACCEPTED", paid: true });

      await asMerchant(client, merchantA.authUserId);
      const cancel = await callCancel(client, order.id, "equipment_failure");
      expect(cancel.ok).toBe(true);
      expect(cancel.order?.refund_status).toBe("pending");

      let pendingIds = await queryPendingRefundOrderIds(client, merchantA.storeId);
      expect(pendingIds).toContain(order.id);

      // Not removable by re-cancelling (double-tap) — only resolving takes
      // it off the list.
      const doubleCancel = await callCancel(client, order.id, "equipment_failure");
      expect(doubleCancel.ok).toBe(true);
      expect(doubleCancel.already).toBe(true);
      pendingIds = await queryPendingRefundOrderIds(client, merchantA.storeId);
      expect(pendingIds).toContain(order.id); // STILL there — a double-tap cancel does not resolve it

      const resolve = await callResolve(client, order.id);
      expect(resolve.ok).toBe(true);
      expect(resolve.already).toBe(false);

      pendingIds = await queryPendingRefundOrderIds(client, merchantA.storeId);
      expect(pendingIds).not.toContain(order.id); // resolving is the ONLY way out
    });
  });

  it("a cancelled PENDING_PAYMENT order does NOT appear there — refund_status stays NULL", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertOrder(client, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "PENDING_PAYMENT" });

      await asMerchant(client, merchantA.authUserId);
      const cancel = await callCancel(client, order.id, "customer_request");
      expect(cancel.ok).toBe(true);
      expect(cancel.order?.status).toBe("CANCELLED");
      expect(cancel.order?.refund_status).toBeNull(); // nothing was ever paid, nothing is owed
      expect(cancel.order?.cancel_reason).toBe("customer_request"); // reason IS still recorded

      await resetRole(client);
      const { rows } = await client.query<{ refund_status: string | null }>("select refund_status from orders where id = $1", [order.id]);
      expect(rows[0].refund_status).toBeNull();

      await asMerchant(client, merchantA.authUserId);
      const pendingIds = await queryPendingRefundOrderIds(client, merchantA.storeId);
      expect(pendingIds).not.toContain(order.id);
    });
  });
});

describe("WBS 5.11 — CRITICAL: a COLLECTED order cannot be cancelled through the API", () => {
  it("returns {ok:false, code:'ILLEGAL_TRANSITION'} — NEVER {ok:true, already:true} — and leaves the row completely unchanged", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertOrder(client, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "COLLECTED", paid: true });

      await asMerchant(client, merchantA.authUserId);
      const result = await callCancel(client, order.id, "out_of_stock");

      // The exact failure mode wbs_5_11_refund_design.md §5 warns about: a
      // BL001 handler that treats ANY caught BL001 as "already at target"
      // would wrongly report {ok:true, already:true} here, silently
      // swallowing an attempted illegal cancel of a COLLECTED order.
      expect(result.ok).toBe(false);
      expect(result.already).toBeUndefined();
      expect(result.code).toBe("ILLEGAL_TRANSITION");

      await resetRole(client);
      const { rows } = await client.query<{ status: string; cancel_reason: string | null; refund_status: string | null }>(
        "select status, cancel_reason, refund_status from orders where id = $1",
        [order.id],
      );
      expect(rows[0].status).toBe("COLLECTED"); // unchanged
      expect(rows[0].cancel_reason).toBeNull(); // never written
      expect(rows[0].refund_status).toBeNull();

      const { rows: ledgerRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from stock_ledger where order_id = $1 and reason = 'cancellation_reversal'",
        [order.id],
      );
      expect(Number(ledgerRows[0].n)).toBe(0); // no reversal fired for a rejected attempt
    });
  });
});

describe("WBS 5.11 — console_resolve_refund: the mirror BL001 case (never-owed refund cannot be 'resolved')", () => {
  it("an order cancelled while PENDING_PAYMENT (refund_status stayed null) returns ILLEGAL_TRANSITION on resolve, not already:true, and refund_status stays null", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertOrder(client, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "PENDING_PAYMENT" });

      await asMerchant(client, merchantA.authUserId);
      const cancel = await callCancel(client, order.id, "unexpected_closure");
      expect(cancel.ok).toBe(true);
      expect(cancel.order?.refund_status).toBeNull();

      const resolve = await callResolve(client, order.id);
      // transition_order's CANCELLED->REFUNDED extra invariant (refund_status
      // must be 'pending') fails here, so this BL001s too — and the SAME
      // re-read-and-compare bug class applies: current status is CANCELLED,
      // not REFUNDED, so this must NOT be reported as already:true.
      expect(resolve.ok).toBe(false);
      expect(resolve.already).toBeUndefined();
      expect(resolve.code).toBe("ILLEGAL_TRANSITION");

      await resetRole(client);
      const { rows } = await client.query<{ status: string; refund_status: string | null; refund_resolved_by: string | null; refund_resolved_at: string | null }>(
        "select status, refund_status, refund_resolved_by, refund_resolved_at from orders where id = $1",
        [order.id],
      );
      expect(rows[0].status).toBe("CANCELLED"); // unchanged
      expect(rows[0].refund_status).toBeNull(); // NEVER flipped to 'done'
      expect(rows[0].refund_resolved_by).toBeNull();
      expect(rows[0].refund_resolved_at).toBeNull();
    });
  });
});

describe("WBS 5.11 — console_resolve_refund: sequential double-tap idempotency", () => {
  it("the second call returns already:true, does not re-stamp refund_resolved_at, and cancel_reason survives unchanged into REFUNDED", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertOrder(client, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "ACCEPTED", paid: true });

      await asMerchant(client, merchantA.authUserId);
      const cancel = await callCancel(client, order.id, "other");
      expect(cancel.ok).toBe(true);

      const first = await callResolve(client, order.id);
      expect(first.ok).toBe(true);
      expect(first.already).toBe(false);
      expect(first.order?.status).toBe("REFUNDED");
      expect(first.order?.refund_status).toBe("done");
      const firstResolvedAt = first.order?.refund_resolved_at;
      expect(firstResolvedAt).toBeTruthy();

      const second = await callResolve(client, order.id);
      expect(second.ok).toBe(true); // NOT surfaced as an error to the caller
      expect(second.already).toBe(true);
      expect(second.code).toBeUndefined(); // distinct shape from ILLEGAL_TRANSITION

      await resetRole(client);

      const { rows } = await client.query<{
        status: string;
        refund_status: string | null;
        refund_resolved_by: string | null;
        refund_resolved_at: string;
        cancel_reason: string | null;
      }>("select status, refund_status, refund_resolved_by, refund_resolved_at, cancel_reason from orders where id = $1", [order.id]);
      expect(rows[0].status).toBe("REFUNDED");
      expect(rows[0].refund_status).toBe("done");
      expect(rows[0].refund_resolved_by).toBe(merchantA.merchantId);
      expect(new Date(rows[0].refund_resolved_at).toISOString()).toBe(new Date(firstResolvedAt!).toISOString()); // NOT re-stamped by the second call
      expect(rows[0].cancel_reason).toBe("other"); // persists across CANCELLED -> REFUNDED, never cleared

      const { rows: historyRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from order_status_history where order_id = $1 and to_status = 'REFUNDED'",
        [order.id],
      );
      expect(Number(historyRows[0].n)).toBe(1); // exactly one REFUNDED history row, not two
    });
  });
});

describe("WBS 5.11 — console_resolve_refund: 10 genuinely concurrent double-tap calls", () => {
  it("ten parallel resolve calls on the SAME order (10 real connections, Promise.all) yield exactly one real transition and nine already:true", async () => {
    if (!dbAvailable) return;

    const setupClient = await connect();
    let orderId: string;
    try {
      const order = await insertOrder(setupClient, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "ACCEPTED", paid: true });
      await asMerchant(setupClient, merchantA.authUserId, { local: false });
      const cancel = await callCancel(setupClient, order.id, "other");
      expect(cancel.ok).toBe(true);
      await setupClient.query("reset role");
      orderId = order.id;
    } finally {
      await setupClient.end();
    }

    const clients = await Promise.all(Array.from({ length: 10 }, () => connect()));
    try {
      await Promise.all(clients.map((client) => asMerchant(client, merchantA.authUserId, { local: false })));

      const results = await Promise.all(clients.map((client) => callResolve(client, orderId)));

      expect(results.every((r) => r.ok === true)).toBe(true); // no errors surfaced under contention
      const winners = results.filter((r) => r.already === false);
      const noops = results.filter((r) => r.already === true);
      expect(winners).toHaveLength(1);
      expect(noops).toHaveLength(9);

      const verify = await connect();
      try {
        const { rows: orderRows } = await verify.query<{ status: string; refund_status: string | null }>(
          "select status, refund_status from orders where id = $1",
          [orderId],
        );
        expect(orderRows[0].status).toBe("REFUNDED");
        expect(orderRows[0].refund_status).toBe("done");

        const { rows: historyRows } = await verify.query<{ n: string }>(
          "select count(*)::int as n from order_status_history where order_id = $1 and to_status = 'REFUNDED'",
          [orderId],
        );
        expect(Number(historyRows[0].n)).toBe(1); // exactly one, across all 10 attempts
      } finally {
        await verify.end();
      }
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  }, 30_000);
});

describe("WBS 5.11 — console_cancel_order: input validation runs before the order lookup", () => {
  it("an invalid reason code returns VALIDATION_ERROR even for a nonexistent order id", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      await asMerchant(client, merchantA.authUserId);
      const result = await callCancel(client, randomUUID(), "not_a_real_reason");
      expect(result.ok).toBe(false);
      expect(result.code).toBe("VALIDATION_ERROR");
    });
  });
});

describe("WBS 5.11 — ownership: NOT_FOUND vs FORBIDDEN, mutating nothing", () => {
  it("console_cancel_order: a nonexistent order id returns NOT_FOUND", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      await asMerchant(client, merchantA.authUserId);
      const result = await callCancel(client, randomUUID(), "other");
      expect(result.ok).toBe(false);
      expect(result.code).toBe("NOT_FOUND");
    });
  });

  it("console_cancel_order: merchant B cancelling merchant A's order returns FORBIDDEN and mutates zero rows", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertOrder(client, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "ACCEPTED", paid: true });

      await asMerchant(client, merchantB.authUserId);
      const result = await callCancel(client, order.id, "other");
      expect(result.ok).toBe(false);
      expect(result.code).toBe("FORBIDDEN");

      await resetRole(client);
      const { rows } = await client.query<{ status: string; cancel_reason: string | null }>(
        "select status, cancel_reason from orders where id = $1",
        [order.id],
      );
      expect(rows[0].status).toBe("ACCEPTED");
      expect(rows[0].cancel_reason).toBeNull();
    });
  });

  it("console_resolve_refund: a nonexistent order id returns NOT_FOUND, and merchant B resolving merchant A's order returns FORBIDDEN", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      await asMerchant(client, merchantA.authUserId);
      const notFound = await callResolve(client, randomUUID());
      expect(notFound.ok).toBe(false);
      expect(notFound.code).toBe("NOT_FOUND");

      const order = await insertOrder(client, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "ACCEPTED", paid: true });
      const cancel = await callCancel(client, order.id, "other");
      expect(cancel.ok).toBe(true);

      await asMerchant(client, merchantB.authUserId);
      const forbidden = await callResolve(client, order.id);
      expect(forbidden.ok).toBe(false);
      expect(forbidden.code).toBe("FORBIDDEN");

      await resetRole(client);
      const { rows } = await client.query<{ status: string; refund_status: string | null }>(
        "select status, refund_status from orders where id = $1",
        [order.id],
      );
      expect(rows[0].status).toBe("CANCELLED"); // unchanged by the rejected resolve attempt
      expect(rows[0].refund_status).toBe("pending");
    });
  });
});

describe("WBS 5.11 — grants: both new RPCs are authenticated-only", () => {
  it("anon and service_role cannot execute console_cancel_order or console_resolve_refund; authenticated can", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query<{
        anon_can_cancel: boolean;
        authenticated_can_cancel: boolean;
        service_role_can_cancel: boolean;
        anon_can_resolve: boolean;
        authenticated_can_resolve: boolean;
        service_role_can_resolve: boolean;
      }>(
        `select
           has_function_privilege('anon', 'console_cancel_order(uuid, text)', 'execute') as anon_can_cancel,
           has_function_privilege('authenticated', 'console_cancel_order(uuid, text)', 'execute') as authenticated_can_cancel,
           has_function_privilege('service_role', 'console_cancel_order(uuid, text)', 'execute') as service_role_can_cancel,
           has_function_privilege('anon', 'console_resolve_refund(uuid)', 'execute') as anon_can_resolve,
           has_function_privilege('authenticated', 'console_resolve_refund(uuid)', 'execute') as authenticated_can_resolve,
           has_function_privilege('service_role', 'console_resolve_refund(uuid)', 'execute') as service_role_can_resolve`,
      );
      expect(rows[0]).toEqual({
        anon_can_cancel: false,
        authenticated_can_cancel: true,
        service_role_can_cancel: false,
        anon_can_resolve: false,
        authenticated_can_resolve: true,
        service_role_can_resolve: false,
      });
    } finally {
      await client.end();
    }
  });
});

describe("WBS 5.11 — orders_refund_pending_idx exists", () => {
  it("the partial index backing the never-aging-out pending-refund list is present", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::int as n from pg_indexes where schemaname = 'public' and indexname = 'orders_refund_pending_idx'`,
      );
      expect(Number(rows[0].n)).toBe(1);
    } finally {
      await client.end();
    }
  });
});

describe("WBS 5.11 — public_order_status / public_order_lookup: widened with cancel_reason/refund_status, never leaking resolution audit fields", () => {
  it("public_order_status returns cancel_reason and refund_status for a pending-refund cancelled order, and the raw row has no refund_resolved_by/at columns", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertOrder(client, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "ACCEPTED", paid: true });
      await asMerchant(client, merchantA.authUserId);
      const cancel = await callCancel(client, order.id, "equipment_failure");
      expect(cancel.ok).toBe(true);
      await resetRole(client);

      const { rows } = await client.query<Record<string, unknown>>(
        "select * from public_order_status($1)",
        [order.orderCode],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("CANCELLED");
      expect(rows[0].cancel_reason).toBe("equipment_failure");
      expect(rows[0].refund_status).toBe("pending");
      // RL-3: the two merchant-internal resolution audit columns are
      // deliberately excluded from this RPC's RETURNS TABLE — assert they
      // are absent from the row shape entirely, not merely null.
      expect(Object.prototype.hasOwnProperty.call(rows[0], "refund_resolved_by")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(rows[0], "refund_resolved_at")).toBe(false);
    });
  });

  it("public_order_status reflects refund_status='done' once resolved, via public_order_lookup(phone, code) too", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertOrder(client, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "ACCEPTED", paid: true });
      await asMerchant(client, merchantA.authUserId);
      const cancel = await callCancel(client, order.id, "customer_request");
      expect(cancel.ok).toBe(true);
      const resolve = await callResolve(client, order.id);
      expect(resolve.ok).toBe(true);
      await resetRole(client);

      const { rows: statusRows } = await client.query<{ status: string; cancel_reason: string; refund_status: string }>(
        "select status, cancel_reason, refund_status from public_order_status($1)",
        [order.orderCode],
      );
      expect(statusRows[0].status).toBe("REFUNDED");
      expect(statusRows[0].cancel_reason).toBe("customer_request"); // still there
      expect(statusRows[0].refund_status).toBe("done");

      const { rows: lookupRows } = await client.query<{ status: string; refund_status: string }>(
        "select status, refund_status from public_order_lookup($1, $2)",
        ["+66811110000", order.orderCode],
      );
      expect(lookupRows).toHaveLength(1);
      expect(lookupRows[0].status).toBe("REFUNDED");
      expect(lookupRows[0].refund_status).toBe("done");
    });
  });

  it("a PENDING_PAYMENT-cancelled order's public_order_status shows refund_status=null alongside a non-null cancel_reason — the load-bearing gating field the frontend must branch on", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const order = await insertOrder(client, { storeId: merchantA.storeId, merchantId: merchantA.merchantId, status: "PENDING_PAYMENT" });
      await asMerchant(client, merchantA.authUserId);
      const cancel = await callCancel(client, order.id, "out_of_stock");
      expect(cancel.ok).toBe(true);
      await resetRole(client);

      const { rows } = await client.query<{ status: string; cancel_reason: string; refund_status: string | null }>(
        "select status, cancel_reason, refund_status from public_order_status($1)",
        [order.orderCode],
      );
      expect(rows[0].status).toBe("CANCELLED");
      expect(rows[0].cancel_reason).toBe("out_of_stock"); // reason present
      expect(rows[0].refund_status).toBeNull(); // but refund_status is the ONLY field allowed to gate refund copy
    });
  });

  it("anon retains execute on both widened RPCs after the DROP + CREATE (the revoke/grant pair was correctly repeated)", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query<{ anon_status: boolean; anon_lookup: boolean }>(
        `select
           has_function_privilege('anon', 'public_order_status(text)', 'execute') as anon_status,
           has_function_privilege('anon', 'public_order_lookup(text, text)', 'execute') as anon_lookup`,
      );
      expect(rows[0]).toEqual({ anon_status: true, anon_lookup: true });
    } finally {
      await client.end();
    }
  });
});
