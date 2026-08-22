// WBS 6.6 -- Unit Cost Update Engine, qa_engineer leg.
//
// Drives packages/db/migrations/0045_ingredient_cost_history.sql (mirrored
// to supabase/migrations/) against a real local Postgres, same posture as
// every other file in this directory (schema.test.ts, checkout_create_
// order.test.ts, console_confirm_purchase_invoice.test.ts): RLS, triggers,
// and the CREATE OR REPLACE'd console_confirm_purchase_invoice only exist in
// the database, a mock proves nothing about them.
//
// Environment note (disclosed per this task's own instructions): the local
// stack's PostgREST API answered 200 at the time this suite was written, so
// no PostgREST-segfault workaround was needed this run. The RLS-adversarial
// group below still avoids PostgREST/supabase-js anyway and instead reuses
// this directory's OWN established direct-`pg`-client + `set local role
// authenticated` + `request.jwt.claims` mechanism (asMerchant/resetRole,
// copied verbatim from console_confirm_purchase_invoice.test.ts) --
// RLS policies are evaluated by Postgres itself the moment the session role
// and request.jwt.claims are set, regardless of whether the caller arrived
// through PostgREST or a raw libpq connection, so this is a faithful proof
// of the same policies rls.test.ts's PostgREST-based suite exercises, not a
// weaker substitute. Kept consistent with the sibling 6.4 file rather than
// introducing a second client library into a directory that already picked
// one for this exact shape of test.
//
// What this file does NOT re-cover (see the WBS 6.6 dispatch's own
// instruction not to duplicate):
//   - console_confirm_purchase_invoice's unmapped-line/forced-failure-
//     rollback/10-way-concurrency cases: already proven by
//     console_confirm_purchase_invoice.test.ts (WBS 6.4) and unaffected by
//     0045's CREATE OR REPLACE, which is byte-identical to 0044 except the
//     two additions this file specifically targets (history-row insert,
//     cost_drift_check enqueue) -- 6.4's own suite re-running green against
//     the replaced function is this file's implicit regression check for
//     that, not a re-derivation of it.
//   - The generic "UPDATE of an immutable column raises" trigger shape:
//     schema.test.ts (WBS 3.5) already proves order_items.unit_cost_
//     snapshot_satang's own trigger fires on a direct UPDATE attempt. This
//     file's "CRITICAL IMMUTABILITY TEST" group below is a DIFFERENT proof
//     the WBS 6.6 prompt asks for verbatim: that an entire real cost-update
//     workflow (sell, then confirm a 50% price rise, then sell again) still
//     leaves the FIRST sale's snapshot untouched end-to-end, not just that
//     a bare UPDATE statement fails.
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, isReachable, LOCAL_DB_URL, withRollback } from "./helpers/db";

let dbAvailable = false;

interface MerchantFixture {
  authUserId: string;
  merchantId: string;
  storeId: string;
  storeSlug: string;
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

  const storeSlug = `qa-6-6-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  // promptpay_id/promptpay_type/promptpay_verified_at + is_published: true
  // so the SAME fixture also works for checkout_create_order (0029), which
  // only matches published, verified stores (0027's own guard) -- needed by
  // the CRITICAL IMMUTABILITY TEST group below, which sells through the
  // real checkout path rather than inserting an order_items row by hand.
  const storeResult = await client.query<{ id: string }>(
    `insert into stores (
       merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity,
       promptpay_id, promptpay_type, promptpay_verified_at, is_published
     )
     values ($1, $2, $3, '07:00', '19:00', 'Asia/Bangkok', 5, '0891234567', 'msisdn', now(), true)
     returning id`,
    [merchantId, storeSlug, `QA 6.6 Store ${label}`],
  );
  const storeId = storeResult.rows[0].id;

  createdAuthUserIds.push(authUserId);
  return { authUserId, merchantId, storeId, storeSlug };
}

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[unit_cost_update_engine.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` and apply migration 0045 first. This is a SKIP, not a pass.\n`,
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

async function insertIngredient(
  client: Client,
  storeId: string,
  name: string,
  baseUnit: "g" | "ml" | "piece",
  currentCostSatang: number | null,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into ingredients (store_id, name, base_unit, current_unit_cost_satang)
     values ($1, $2, $3, $4) returning id`,
    [storeId, name, baseUnit, currentCostSatang],
  );
  return rows[0].id;
}

async function insertMenuItem(client: Client, storeId: string, name: string, priceSatang: number): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into menu_items (store_id, name, price_satang) values ($1, $2, $3) returning id`,
    [storeId, name, priceSatang],
  );
  return rows[0].id;
}

async function insertBomLine(client: Client, storeId: string, menuItemId: string, ingredientId: string, qtyBaseUnit: number): Promise<void> {
  await client.query(
    `insert into bom_lines (store_id, menu_item_id, ingredient_id, qty_base_unit) values ($1, $2, $3, $4)`,
    [storeId, menuItemId, ingredientId, qtyBaseUnit],
  );
}

let slotOffsetCounter = 0;
async function insertFutureSlot(client: Client, storeId: string, capacity: number): Promise<string> {
  slotOffsetCounter += 1;
  const offsetMinutes = 60 + slotOffsetCounter * 15;
  const { rows } = await client.query<{ id: string }>(
    `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
     values ($1, now() + make_interval(mins => $3::int), now() + make_interval(mins => $3::int + 15), $2, 0, true)
     returning id`,
    [storeId, capacity, offsetMinutes],
  );
  return rows[0].id;
}

async function callCheckout(
  client: Client,
  storeSlug: string,
  menuItemId: string,
  nameSnapshot: string,
  unitPriceSatang: number,
  pickupSlotId: string,
  customerName: string,
): Promise<{ ok: boolean; order?: { order_code: string } }> {
  const cartLines = [
    { menuItemId, nameSnapshot, unitPriceSatang, quantity: 1, options: [] },
  ];
  const { rows } = await client.query(
    `select checkout_create_order($1, $2, $3, $4, $5) as result`,
    [storeSlug, JSON.stringify(cartLines), pickupSlotId, customerName, null],
  );
  return rows[0].result;
}

async function insertManualInvoice(client: Client, storeId: string, totalSatang: number): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into purchase_invoices (store_id, vendor_name, invoice_date, total_satang, ocr_status, raw_ocr_output)
     values ($1, 'QA Wholesale', current_date, $2, 'manual', $3::jsonb)
     returning id`,
    [storeId, totalSatang, JSON.stringify({ source: "manual", version: 1, lineItems: [] })],
  );
  return rows[0].id;
}

interface ConfirmLineInput {
  name: string;
  rawText: string;
  ingredientId: string | null;
  qtyBaseUnit: number | null;
  unitCostSatang: number | null;
  totalSatang: number;
}

interface ConfirmResult {
  ok: boolean;
  already?: boolean;
  code?: string;
  invoiceId?: string;
  totalSatang?: number;
  changed?: { ingredientId: string; oldCostSatang: number | null; newCostSatang: number }[];
}

async function callConfirm(client: Client, invoiceId: string, lines: ConfirmLineInput[]): Promise<ConfirmResult> {
  const { rows } = await client.query(
    "select console_confirm_purchase_invoice($1, $2, $3, $4) as result",
    [invoiceId, "QA Wholesale", "2026-08-22", JSON.stringify(lines)],
  );
  return rows[0].result as ConfirmResult;
}

function mappedLine(opts: {
  ingredientId: string;
  qtyBaseUnit: number;
  unitCostSatang: number;
  name?: string;
}): ConfirmLineInput {
  return {
    name: opts.name ?? "QA Ingredient",
    rawText: `${opts.name ?? "QA Ingredient"} (${opts.qtyBaseUnit})`,
    ingredientId: opts.ingredientId,
    qtyBaseUnit: opts.qtyBaseUnit,
    unitCostSatang: opts.unitCostSatang,
    totalSatang: Math.round(opts.qtyBaseUnit * opts.unitCostSatang),
  };
}

function unmappedLine(totalSatang: number, name = "ถุงกระดาษ"): ConfirmLineInput {
  return {
    name,
    rawText: `${name} (unmapped)`,
    ingredientId: null,
    qtyBaseUnit: null,
    unitCostSatang: null,
    totalSatang,
  };
}

// ---------------------------------------------------------------------------
// Group 1 -- CRITICAL IMMUTABILITY TEST (WBS 6.6 Claude Code Prompt, item 3,
// followed verbatim): sell, confirm a 50% price rise, sell again.
// ---------------------------------------------------------------------------
describe("WBS 6.6 — CRITICAL IMMUTABILITY TEST: a cost update never rewrites an existing order's unit_cost_snapshot_satang", () => {
  it("existing order's snapshot is unchanged after a 50% cost rise; a NEW order of the same item gets the new higher cost", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      // 30 satang/g is the 300 THB/kg starting price; 45 satang/g (the new
      // cost below) is the WBS's own canonical 450 THB/kg anchor (units.
      // test.ts's "1 kg at 450 THB -> 45 satang/gram") and is exactly a 50%
      // rise over 30 -- both numbers chosen so this test IS the WBS
      // prompt's own worked example, not an arbitrary stand-in for it.
      const beansId = await insertIngredient(client, merchantA.storeId, "QA 6.6 Beans", "g", 30);
      const menuItemId = await insertMenuItem(client, merchantA.storeId, "QA 6.6 Latte", 6500);
      await insertBomLine(client, merchantA.storeId, menuItemId, beansId, 18); // 18g -> 18*30=540 satang pre-rise, 18*45=810 post-rise

      const slot1 = await insertFutureSlot(client, merchantA.storeId, 5);
      const sale1 = await callCheckout(client, merchantA.storeSlug, menuItemId, "QA 6.6 Latte", 6500, slot1, "QA Buyer One");
      expect(sale1.ok).toBe(true);

      const { rows: before } = await client.query<{ unit_cost_snapshot_satang: number | null }>(
        `select oi.unit_cost_snapshot_satang
           from order_items oi join orders o on o.id = oi.order_id
          where o.order_code = $1`,
        [sale1.order!.order_code],
      );
      expect(before[0].unit_cost_snapshot_satang).toBe(540); // pre-rise snapshot, recorded at sale time

      // Confirm a new purchase raising the ingredient's cost by exactly 50%.
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 45000);
      await asMerchant(client, merchantA.authUserId);
      const confirmResult = await callConfirm(client, invoiceId, [
        mappedLine({ ingredientId: beansId, qtyBaseUnit: 1000, unitCostSatang: 45, name: "QA 6.6 Beans" }),
      ]);
      await resetRole(client);
      expect(confirmResult.ok).toBe(true);
      expect(confirmResult.changed).toEqual([
        expect.objectContaining({ ingredientId: beansId, oldCostSatang: 30, newCostSatang: 45 }),
      ]);

      // The ingredient's forward-looking cost DID move...
      const { rows: ingredientAfter } = await client.query<{ current_unit_cost_satang: number }>(
        "select current_unit_cost_satang from ingredients where id = $1",
        [beansId],
      );
      expect(ingredientAfter[0].current_unit_cost_satang).toBe(45);

      // ...but the FIRST sale's snapshot is byte-for-byte unchanged. This is
      // the entire point of the test: historical P&L must not silently
      // change when today's ingredient price moves.
      const { rows: afterFirstOrder } = await client.query<{ unit_cost_snapshot_satang: number | null }>(
        `select oi.unit_cost_snapshot_satang
           from order_items oi join orders o on o.id = oi.order_id
          where o.order_code = $1`,
        [sale1.order!.order_code],
      );
      expect(afterFirstOrder[0].unit_cost_snapshot_satang).toBe(540); // NOT 810, NOT anything else

      // A brand-new order of the SAME menu item now gets the NEW, higher cost.
      const slot2 = await insertFutureSlot(client, merchantA.storeId, 5);
      const sale2 = await callCheckout(client, merchantA.storeSlug, menuItemId, "QA 6.6 Latte", 6500, slot2, "QA Buyer Two");
      expect(sale2.ok).toBe(true);

      const { rows: secondOrder } = await client.query<{ unit_cost_snapshot_satang: number | null }>(
        `select oi.unit_cost_snapshot_satang
           from order_items oi join orders o on o.id = oi.order_id
          where o.order_code = $1`,
        [sale2.order!.order_code],
      );
      expect(secondOrder[0].unit_cost_snapshot_satang).toBe(810); // 18g * 45 satang/g, the NEW cost

      // Belt-and-braces: the two orders' snapshots actually differ from each
      // other, so this isn't accidentally passing because both landed on
      // the same value.
      expect(afterFirstOrder[0].unit_cost_snapshot_satang).not.toBe(secondOrder[0].unit_cost_snapshot_satang);
    });
  });
});

// ---------------------------------------------------------------------------
// Group 2 -- ingredient_cost_history row correctness
// ---------------------------------------------------------------------------
describe("WBS 6.6 — ingredient_cost_history: one row per actual cost change, with the right old/new/source values", () => {
  it("a mapped line that changes cost writes exactly one history row with the correct old_cost_satang, new_cost_satang, and source_invoice_id", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const milkId = await insertIngredient(client, merchantA.storeId, "QA History Milk", "ml", 4200);
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 45000);
      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirm(client, invoiceId, [
        mappedLine({ ingredientId: milkId, qtyBaseUnit: 5000, unitCostSatang: 4500, name: "QA History Milk" }),
      ]);
      await resetRole(client);
      expect(result.ok).toBe(true);

      const { rows } = await client.query<{
        old_cost_satang: number | null;
        new_cost_satang: number;
        source_invoice_id: string;
      }>(
        "select old_cost_satang, new_cost_satang, source_invoice_id from ingredient_cost_history where ingredient_id = $1",
        [milkId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].old_cost_satang).toBe(4200);
      expect(rows[0].new_cost_satang).toBe(4500);
      expect(rows[0].source_invoice_id).toBe(invoiceId);
    });
  });

  it("the FIRST-ever confirm for an ingredient with no prior cost writes a history row with old_cost_satang = NULL, not 0 or the new value", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const neverPurchasedId = await insertIngredient(client, merchantA.storeId, "QA Never Purchased", "g", null);
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 40500);
      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirm(client, invoiceId, [
        mappedLine({ ingredientId: neverPurchasedId, qtyBaseUnit: 900, unitCostSatang: 45, name: "QA Never Purchased" }),
      ]);
      await resetRole(client);
      expect(result.ok).toBe(true);
      expect(result.changed).toEqual([
        expect.objectContaining({ ingredientId: neverPurchasedId, oldCostSatang: null, newCostSatang: 45 }),
      ]);

      const { rows } = await client.query<{ old_cost_satang: number | null; new_cost_satang: number }>(
        "select old_cost_satang, new_cost_satang from ingredient_cost_history where ingredient_id = $1",
        [neverPurchasedId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].old_cost_satang).toBeNull();
      expect(rows[0].new_cost_satang).toBe(45);
    });
  });

  it("a confirm where every mapped line's cost is UNCHANGED writes no new history row", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const stableId = await insertIngredient(client, merchantA.storeId, "QA Stable Cost", "g", 30);
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 27000);
      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirm(client, invoiceId, [
        mappedLine({ ingredientId: stableId, qtyBaseUnit: 900, unitCostSatang: 30, name: "QA Stable Cost" }), // same 30 as current
      ]);
      await resetRole(client);
      expect(result.ok).toBe(true);
      expect(result.changed).toEqual([]);

      const { rows } = await client.query<{ n: string }>(
        "select count(*)::int as n from ingredient_cost_history where ingredient_id = $1",
        [stableId],
      );
      expect(Number(rows[0].n)).toBe(0);
    });
  });

  it("a confirm with ONLY an unmapped line writes zero ingredient_cost_history rows for this invoice", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 8000);
      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirm(client, invoiceId, [unmappedLine(8000)]);
      await resetRole(client);
      expect(result.ok).toBe(true);
      expect(result.changed).toEqual([]);

      const { rows } = await client.query<{ n: string }>(
        "select count(*)::int as n from ingredient_cost_history where source_invoice_id = $1",
        [invoiceId],
      );
      expect(Number(rows[0].n)).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Group 3 -- append-only enforcement (the trigger itself, not RLS)
// ---------------------------------------------------------------------------
describe("WBS 6.6 — ingredient_cost_history is append-only: the trigger, exercised directly", () => {
  // Run as the table owner (the plain `connect()` superuser client, same
  // role every fixture insert in this file already uses), which BYPASSES
  // RLS entirely -- deliberately, so this test proves the TRIGGER raises,
  // isolated from RLS's separate (and separately tested, group 5 below)
  // "no write policy for authenticated" behaviour. If this ran as
  // `authenticated` instead, a table with no UPDATE/DELETE policy would
  // simply match zero rows and the trigger would never even fire, proving
  // nothing about the trigger itself.
  it("a direct UPDATE of an existing row raises, and leaves the row's values unchanged", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const milkId = await insertIngredient(client, merchantA.storeId, "QA Append Only Milk", "ml", 4200);
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 22500);
      await client.query(
        `insert into ingredient_cost_history (ingredient_id, store_id, old_cost_satang, new_cost_satang, source_invoice_id)
         values ($1, $2, 4200, 4500, $3) returning id`,
        [milkId, merchantA.storeId, invoiceId],
      );
      const { rows: historyRows } = await client.query<{ id: string }>(
        "select id from ingredient_cost_history where ingredient_id = $1",
        [milkId],
      );
      const historyId = historyRows[0].id;

      await tx.savepoint("before_update_attempt");
      await expect(
        client.query("update ingredient_cost_history set new_cost_satang = 9999 where id = $1", [historyId]),
      ).rejects.toThrow(/append-only/);
      await tx.rollbackToSavepoint("before_update_attempt");

      const { rows: afterRows } = await client.query<{ new_cost_satang: number }>(
        "select new_cost_satang from ingredient_cost_history where id = $1",
        [historyId],
      );
      expect(afterRows[0].new_cost_satang).toBe(4500); // NOT 9999
    });
  });

  it("a direct DELETE of an existing row raises, and the row survives", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const milkId = await insertIngredient(client, merchantA.storeId, "QA Append Only Milk 2", "ml", 4200);
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 22500);
      await client.query(
        `insert into ingredient_cost_history (ingredient_id, store_id, old_cost_satang, new_cost_satang, source_invoice_id)
         values ($1, $2, 4200, 4500, $3) returning id`,
        [milkId, merchantA.storeId, invoiceId],
      );
      const { rows: historyRows } = await client.query<{ id: string }>(
        "select id from ingredient_cost_history where ingredient_id = $1",
        [milkId],
      );
      const historyId = historyRows[0].id;

      await tx.savepoint("before_delete_attempt");
      await expect(client.query("delete from ingredient_cost_history where id = $1", [historyId])).rejects.toThrow(
        /append-only/,
      );
      await tx.rollbackToSavepoint("before_delete_attempt");

      const { rows: afterRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from ingredient_cost_history where id = $1",
        [historyId],
      );
      expect(Number(afterRows[0].n)).toBe(1); // still there
    });
  });
});

// ---------------------------------------------------------------------------
// Group 4 -- job_queue: cost_recalc AND cost_drift_check, same payload; none
// when nothing changed.
// ---------------------------------------------------------------------------
describe("WBS 6.6 — job_queue: cost_recalc and cost_drift_check are enqueued together, with identical payloads", () => {
  it("a confirm that changes a mapped line's cost enqueues exactly one cost_recalc AND one cost_drift_check job, both carrying {ingredientIds, sourceInvoiceId}", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const beansId = await insertIngredient(client, merchantA.storeId, "QA Job Queue Beans", "g", 30);
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 40500);
      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirm(client, invoiceId, [
        mappedLine({ ingredientId: beansId, qtyBaseUnit: 900, unitCostSatang: 45, name: "QA Job Queue Beans" }),
      ]);
      await resetRole(client);
      expect(result.ok).toBe(true);

      const { rows: jobs } = await client.query<{ job_type: string; payload: { ingredientIds: string[]; sourceInvoiceId: string } }>(
        `select job_type, payload from job_queue where payload->>'sourceInvoiceId' = $1 order by job_type`,
        [invoiceId],
      );
      expect(jobs).toHaveLength(2);
      const jobTypes = jobs.map((j) => j.job_type).sort();
      expect(jobTypes).toEqual(["cost_drift_check", "cost_recalc"]);

      for (const job of jobs) {
        expect(job.payload.sourceInvoiceId).toBe(invoiceId);
        expect(job.payload.ingredientIds).toEqual([beansId]);
      }
      // Identical payload shape across both job types, not just individually correct.
      expect(jobs[0].payload).toEqual(jobs[1].payload);
    });
  });

  it("a confirm where cost does NOT change enqueues neither cost_recalc nor cost_drift_check", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const stableId = await insertIngredient(client, merchantA.storeId, "QA No Job Stable", "g", 30);
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 27000);
      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirm(client, invoiceId, [
        mappedLine({ ingredientId: stableId, qtyBaseUnit: 900, unitCostSatang: 30, name: "QA No Job Stable" }),
      ]);
      await resetRole(client);
      expect(result.ok).toBe(true);

      const { rows: jobs } = await client.query<{ n: string }>(
        `select count(*)::int as n from job_queue where payload->>'sourceInvoiceId' = $1 and job_type in ('cost_recalc', 'cost_drift_check')`,
        [invoiceId],
      );
      expect(Number(jobs[0].n)).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Group 5 -- RLS adversarial (real `authenticated` role, not a mock)
// ---------------------------------------------------------------------------
describe("WBS 6.6 — RLS: ingredient_cost_history is scoped to the owning store, and no role but the definer function can write it", () => {
  it("merchant A, as `authenticated`, sees ZERO of merchant B's ingredient_cost_history rows — while a superuser (service_role-equivalent) sees them, proving the rows genuinely exist", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const bIngredientId = await insertIngredient(client, merchantB.storeId, "QA RLS B Ingredient", "g", 20);
      const invoiceId = await insertManualInvoice(client, merchantB.storeId, 27000);
      await asMerchant(client, merchantB.authUserId);
      const result = await callConfirm(client, invoiceId, [
        mappedLine({ ingredientId: bIngredientId, qtyBaseUnit: 900, unitCostSatang: 30, name: "QA RLS B Ingredient" }),
      ]);
      await resetRole(client);
      expect(result.ok).toBe(true);

      // First, prove with an unrestricted (superuser) read that the row is
      // really there -- otherwise a 0-row result below would be
      // meaningless (WBS's own "assert the rows exist" rule).
      const { rows: adminRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from ingredient_cost_history where ingredient_id = $1",
        [bIngredientId],
      );
      expect(Number(adminRows[0].n)).toBeGreaterThan(0);

      // Now merchant A, authenticated, tries to read merchant B's rows.
      await asMerchant(client, merchantA.authUserId);
      const { rows: asMerchantARows } = await client.query<{ id: string }>(
        "select id from ingredient_cost_history where ingredient_id = $1",
        [bIngredientId],
      );
      expect(asMerchantARows).toHaveLength(0);
      await resetRole(client);
    });
  });

  it("merchant A, as `authenticated`, CAN read their OWN store's ingredient_cost_history rows (the policy is scoped, not a blanket deny)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const aIngredientId = await insertIngredient(client, merchantA.storeId, "QA RLS A Ingredient", "g", 25);
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 27000);
      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirm(client, invoiceId, [
        mappedLine({ ingredientId: aIngredientId, qtyBaseUnit: 900, unitCostSatang: 30, name: "QA RLS A Ingredient" }),
      ]);
      expect(result.ok).toBe(true);

      const { rows } = await client.query<{ id: string }>(
        "select id from ingredient_cost_history where ingredient_id = $1",
        [aIngredientId],
      );
      expect(rows.length).toBeGreaterThan(0);
      await resetRole(client);
    });
  });

  it("`authenticated` cannot INSERT into ingredient_cost_history directly — no INSERT policy exists, so RLS rejects it even for a row in the caller's own store", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const aIngredientId = await insertIngredient(client, merchantA.storeId, "QA RLS Insert Attempt", "g", 25);
      await asMerchant(client, merchantA.authUserId);
      await tx.savepoint("before_insert_attempt");
      await expect(
        client.query(
          `insert into ingredient_cost_history (ingredient_id, store_id, old_cost_satang, new_cost_satang)
           values ($1, $2, 25, 30)`,
          [aIngredientId, merchantA.storeId],
        ),
      ).rejects.toThrow(/row-level security policy/);
      // Recover from Postgres's aborted-transaction state before `reset
      // role` (an ordinary statement) can run -- same recovery pattern as
      // the append-only DELETE/UPDATE tests above.
      await tx.rollbackToSavepoint("before_insert_attempt");
      await resetRole(client);
    });
  });
});

// ---------------------------------------------------------------------------
// Group 6 -- redline_reviewer HIGH finding follow-up: ingredient_cost_history's
// three FKs and the converging-cascade race 0034/0035 already found and fixed
// for order_status_history (see this migration's own long comment block,
// lines ~358-440 of 0045_ingredient_cost_history.sql). The fix deferred
// ingredient_id_fkey and store_id_fkey (both CASCADE) as a defensive measure
// by structural analogy to 0034/0035, and left source_invoice_id_fkey (SET
// NULL) non-deferrable, since a SET NULL write trivially satisfies its own
// FK check regardless. NOTE: an earlier version of this comment (and of the
// migration's own comment) claimed a specific cross-column re-validation
// mechanism justified the CASCADE/SET NULL split. redline_reviewer tested
// that claim directly against Postgres 17 and falsified it — see the
// migration's own corrected comment. The deferral itself still stands (it
// is harmless either way), just not on the mechanism originally stated.
//
// HONESTY NOTE, carried over verbatim from the migration's own verification
// comment and from the engineer's ad-hoc manual check: the underlying bug is
// a genuine Postgres RI-action-queue ordering race. It was reproduced
// forcing a FAILURE at all only by temporarily REVERTING the already-fixed
// order_status_history precedent (0034/0035) and re-running that suite --
// even then it did not fail on every run. Re-running the SAME regression
// shape (a single sequential `delete from auth.users` cascade, one process,
// one database) five times with the fix reverted did not fail once either,
// per the engineer's own report. So neither this file nor any single-
// environment sequential test can force this specific race on demand -- that
// is a property of the bug class, not a gap in test effort. Two DIFFERENT
// kinds of proof are used below instead, because "delete it and see if it
// fails" has already been shown to prove nothing:
//   1. pg_constraint introspection -- deterministic, no race involved at all.
//      Directly confirms the fix as actually applied in this database,
//      independently re-verified here rather than trusted from the
//      migration's own comment or a prior report.
//   2. An end-to-end committed-fixture cascade delete through multiple
//      ingredients and multiple confirmed invoices (maximising the chance
//      of overlapping RI actions within one transaction). This is a
//      legitimate regression test -- it proves the cascade still completes
//      without error and leaves no orphans in the ordinary case -- but it is
//      NOT a reliable reproduction of the race itself, and this test does
//      not claim to be one. A pass here means "the happy path still works
//      end to end"; it does not mean "the race is impossible" -- nothing in
//      this file or the migration claims to establish that. The deferral is
//      applied defensively (harmless, near-zero cost) on structural analogy
//      to 0034/0035, not on a confirmed reproduction of the failure mode.
// ---------------------------------------------------------------------------
describe("WBS 6.6 follow-up — ingredient_cost_history FK deferral (redline_reviewer HIGH finding)", () => {
  describe("pg_constraint introspection (deterministic — no race, no timing dependency)", () => {
    it("ingredient_id_fkey and store_id_fkey are DEFERRABLE INITIALLY DEFERRED; source_invoice_id_fkey is NOT deferrable, on purpose", async () => {
      if (!dbAvailable) return;
      const client = await connect();
      try {
        const { rows } = await client.query<{ conname: string; condeferrable: boolean; condeferred: boolean }>(
          `select conname, condeferrable, condeferred
             from pg_constraint
            where conrelid = 'ingredient_cost_history'::regclass
              and contype = 'f'
            order by conname`,
        );
        expect(rows).toHaveLength(3); // exactly the three FKs this migration documents -- not a subset, not extras
        const byName = Object.fromEntries(rows.map((r) => [r.conname, r]));

        // The two CASCADE "victims" -- deferred to end of transaction.
        expect(byName["ingredient_cost_history_ingredient_id_fkey"]).toMatchObject({
          condeferrable: true,
          condeferred: true, // INITIALLY DEFERRED, not merely DEFERRABLE
        });
        expect(byName["ingredient_cost_history_store_id_fkey"]).toMatchObject({
          condeferrable: true,
          condeferred: true,
        });

        // The one SET NULL "trigger" -- deliberately left immediate. Asserting
        // this explicitly, not just omitting it, is the point: it proves the
        // omission was a reasoned choice (writing NULL always satisfies its
        // own FK check, so deferring it would fix nothing) rather than an
        // oversight that happens to look identical from the outside.
        expect(byName["ingredient_cost_history_source_invoice_id_fkey"]).toMatchObject({
          condeferrable: false,
          condeferred: false,
        });
      } finally {
        await client.end();
      }
    });
  });

  describe("end-to-end cascading delete through a committed fixture (regression test — see Group 6 header comment on what this does and does not prove)", () => {
    it("REQUIRED: delete from auth.users cascades through merchants -> stores -> {ingredients, purchase_invoices} -> ingredient_cost_history with no exception and zero orphaned rows, across multiple ingredients and multiple confirmed invoices", async () => {
      if (!dbAvailable) return;
      const client = await connect();
      try {
        // A dedicated fixture, NOT merchantA/merchantB -- this test actually
        // commits a `delete from auth.users`, which would break every other
        // test in this file if it targeted a shared fixture. createMerchant
        // Fixture already registers the auth user id in this file's shared
        // createdAuthUserIds array; deleting it here first makes the
        // afterAll's own delete a harmless no-op (0 rows affected).
        const fixture = await createMerchantFixture(client, "fk-cascade-e2e");

        // Three ingredients, deliberately including one with NO prior cost
        // (null) so its first-ever confirm exercises the same "old_cost_
        // satang is genuinely null, not fabricated" path Group 2 covers --
        // and, more to this group's own point, so more distinct
        // ingredient_cost_history rows exist across more distinct parent
        // ingredients/invoices, maximising the surface for overlapping RI
        // actions within the one cascading DELETE below.
        const beansId = await insertIngredient(client, fixture.storeId, "QA 6.6 FK Cascade Beans", "g", 30);
        const milkId = await insertIngredient(client, fixture.storeId, "QA 6.6 FK Cascade Milk", "ml", null);
        const sugarId = await insertIngredient(client, fixture.storeId, "QA 6.6 FK Cascade Sugar", "g", 10);

        // Two separate invoices, each confirmed for real through the actual
        // console_confirm_purchase_invoice function (not a hand-inserted
        // history row) -- milk appears on BOTH invoices so it also gets a
        // second, cost-changing confirm, i.e. two history rows sourced from
        // two different purchase_invoices rows for the same ingredient.
        const invoice1Id = await insertManualInvoice(client, fixture.storeId, 45000);
        const invoice2Id = await insertManualInvoice(client, fixture.storeId, 40500);

        await asMerchant(client, fixture.authUserId, { local: false }); // session-scoped: no explicit
        // transaction wraps these calls, since this test needs its writes to
        // actually commit, not roll back like the other groups' withRollback
        // tests -- `local: false` sets role/jwt claims for the session
        // rather than the (nonexistent, here) current transaction.
        const confirm1 = await callConfirm(client, invoice1Id, [
          mappedLine({ ingredientId: beansId, qtyBaseUnit: 1000, unitCostSatang: 45, name: "QA 6.6 FK Cascade Beans" }),
          mappedLine({ ingredientId: milkId, qtyBaseUnit: 5000, unitCostSatang: 4500, name: "QA 6.6 FK Cascade Milk" }),
        ]);
        expect(confirm1.ok).toBe(true);
        expect(confirm1.changed).toHaveLength(2);

        const confirm2 = await callConfirm(client, invoice2Id, [
          mappedLine({ ingredientId: milkId, qtyBaseUnit: 4500, unitCostSatang: 4700, name: "QA 6.6 FK Cascade Milk" }),
          mappedLine({ ingredientId: sugarId, qtyBaseUnit: 900, unitCostSatang: 45, name: "QA 6.6 FK Cascade Sugar" }),
        ]);
        expect(confirm2.ok).toBe(true);
        expect(confirm2.changed).toHaveLength(2);
        await resetRole(client);

        const countsQuery = `select
             (select count(*) from stores where id = $1) as stores,
             (select count(*) from ingredients where store_id = $1) as ingredients,
             (select count(*) from purchase_invoices where store_id = $1) as invoices,
             (select count(*) from ingredient_cost_history where store_id = $1) as history`;

        // Prove the data genuinely exists, committed, before deletion -- a
        // zero-row result after the delete below is meaningless otherwise
        // (this repo's own "assert the rows exist" adversarial-test rule).
        const before = await client.query<{ stores: string; ingredients: string; invoices: string; history: string }>(
          countsQuery,
          [fixture.storeId],
        );
        expect(Number(before.rows[0].stores)).toBe(1);
        expect(Number(before.rows[0].ingredients)).toBe(3);
        expect(Number(before.rows[0].invoices)).toBe(2);
        expect(Number(before.rows[0].history)).toBe(4); // beans:1, milk:2 (first + second confirm), sugar:1

        // The thing this whole group exists to check: a plain cascading
        // delete must just work -- no exception, no manually disabled
        // trigger, no constraint violation.
        await expect(client.query("delete from auth.users where id = $1", [fixture.authUserId])).resolves.toBeDefined();

        const after = await client.query<{ stores: string; ingredients: string; invoices: string; history: string }>(
          countsQuery,
          [fixture.storeId],
        );
        expect(Number(after.rows[0].stores)).toBe(0);
        expect(Number(after.rows[0].ingredients)).toBe(0);
        expect(Number(after.rows[0].invoices)).toBe(0);
        expect(Number(after.rows[0].history)).toBe(0); // REQUIRED: zero orphaned history rows
      } finally {
        await client.end();
      }
    });
  });
});
