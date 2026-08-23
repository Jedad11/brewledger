// WBS 6.8 qa/engineer leg — Automatic Stock Deduction and Stock Ledger.
//
// Most of 6.8 was already SEEDED under other entries before this file
// existed: the deduction insert lives inside transition_order()'s
// PENDING_PAYMENT -> ACCEPTED branch (packages/db/migrations/
// 0032_order_status_history.sql, WBS 5.7), reversal lives in its
// *->CANCELLED branch (same file, tested in order_lifecycle.test.ts
// ~line 613-673), and negative stock / RL-2 zero-BOM silence are already
// covered by payment_confirmation.test.ts and ingredient_master.test.ts. This
// file's job is the one thing that was genuinely missing — the append-only
// trigger (packages/db/migrations/0049_stock_ledger_append_only.sql) — plus a
// single dedicated place that asserts the WBS 6.8 Acceptance list AS A UNIT,
// reusing what already passes elsewhere rather than re-deriving it:
//   1. An order composed ENTIRELY of zero-BOM items produces zero
//      stock_ledger rows and zero warnings anywhere (RL-2) — both a live
//      assertion and a structural one (transition_order's own body contains
//      no RAISE WARNING/NOTICE for this path at all, for any input).
//   2. The append-only trigger blocks direct UPDATE and DELETE, does NOT
//      block the legitimate cascade path a real `delete from auth.users`
//      exercises, and is not fooled by an innocent-looking nested trigger
//      merely running at the same depth a real cascade would (0035's own
//      technique, applied to this table).
//   3. A forced failure AFTER deduction has already happened (not merely
//      failing the deduction INSERT itself, which
//      payment_confirmation.test.ts's own atomicity test already covers) —
//      here forced on the LATER `update payments ... status = 'succeeded'`
//      step — rolls back the order status change, the paid_at/
//      payment_confirmed_by writes, AND the stock_ledger rows transition_
//      order already wrote earlier in the SAME call.
//   4. Traceability: every ledger row for a sample ingredient resolves to
//      either order_id or purchase_invoice_id, and summing them reproduces
//      ingredient_stock_levels()'s stock_base_unit exactly.
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
    [merchantId, `qa-6-8-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`, `QA 6.8 Store ${label}`],
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
      "\n[stock_ledger.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` (and \`supabase db reset\` to guarantee ` +
        "0049 is applied) first. This is a SKIP, not a pass.\n",
    );
    return;
  }

  const client = await connect();
  try {
    merchantA = await createMerchantFixture(client, "a");
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
    `insert into bom_lines (store_id, menu_item_id, ingredient_id, qty_base_unit) values ($1, $2, $3, $4)`,
    [storeId, menuItemId, ingredientId, qtyBaseUnit],
  );
}

interface OrderFixtureOpts {
  storeId: string;
  items: Array<{ menuItemId: string | null; nameSnapshot: string; quantity: number; unitPriceSatang: number; unitCostSnapshotSatang: number | null }>;
}

async function insertPendingOrder(client: Client, opts: OrderFixtureOpts): Promise<{ id: string; orderCode: string }> {
  const orderCode = `S${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
  const subtotal = opts.items.reduce((sum, i) => sum + i.unitPriceSatang * i.quantity, 0);

  const { rows } = await client.query<{ id: string }>(
    `insert into orders (store_id, order_code, customer_name, status, subtotal_satang, total_satang, expires_at)
     values ($1, $2, 'QA 6.8 Customer', 'PENDING_PAYMENT', $3, $3, now() + interval '15 minutes')
     returning id`,
    [opts.storeId, orderCode, subtotal],
  );
  const orderId = rows[0].id;

  for (const item of opts.items) {
    await client.query(
      `insert into order_items (order_id, store_id, menu_item_id, item_name_snapshot, quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [orderId, opts.storeId, item.menuItemId, item.nameSnapshot, item.quantity, item.unitPriceSatang, item.unitCostSnapshotSatang],
    );
  }

  await client.query(
    `insert into payments (order_id, store_id, method, payee_alias, amount_satang, status)
     values ($1, $2, 'promptpay_direct', 'qa-6-8-payee', $3, 'pending')`,
    [orderId, opts.storeId, subtotal],
  );

  return { id: orderId, orderCode };
}

interface ConfirmPaymentResult {
  ok: boolean;
  already?: boolean;
  code?: string;
}

async function callConfirmPayment(client: Client, orderId: string, merchantId: string): Promise<ConfirmPaymentResult> {
  const { rows } = await client.query("select console_confirm_payment($1, $2) as result", [orderId, merchantId]);
  return rows[0].result as ConfirmPaymentResult;
}

async function insertManualInvoice(client: Client, storeId: string, totalSatang: number): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into purchase_invoices (store_id, vendor_name, invoice_date, total_satang, ocr_status, raw_ocr_output)
     values ($1, 'QA 6.8 Wholesale', current_date, $2, 'manual', $3::jsonb)
     returning id`,
    [storeId, totalSatang, JSON.stringify({ source: "manual", version: 1, lineItems: [] })],
  );
  return rows[0].id;
}

interface ConfirmInvoiceResult {
  ok: boolean;
  already?: boolean;
  code?: string;
}

async function callConfirmInvoice(
  client: Client,
  invoiceId: string,
  lines: Array<{ name: string; rawText: string; ingredientId: string | null; qtyBaseUnit: number | null; unitCostSatang: number | null; totalSatang: number }>,
): Promise<ConfirmInvoiceResult> {
  const { rows } = await client.query(
    "select console_confirm_purchase_invoice($1, $2, $3, $4) as result",
    [invoiceId, "QA 6.8 Wholesale", new Date().toISOString().slice(0, 10), JSON.stringify(lines)],
  );
  return rows[0].result as ConfirmInvoiceResult;
}

// ---------------------------------------------------------------------------
// 1. RL-2 — zero-BOM order produces zero ledger rows and zero warnings
// ---------------------------------------------------------------------------

describe("WBS 6.8 — RL-2: an order composed entirely of zero-BOM items", () => {
  it("REQUIRED: produces zero stock_ledger rows", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA No-Recipe Muffin", priceSatang: 3500 });
      const order = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        items: [{ menuItemId: item.id, nameSnapshot: "QA No-Recipe Muffin", quantity: 3, unitPriceSatang: 3500, unitCostSnapshotSatang: null }],
      });

      await asMerchant(client, merchantA.authUserId);
      const result = await callConfirmPayment(client, order.id, merchantA.merchantId);
      expect(result.ok).toBe(true);

      await resetRole(client);
      const { rows } = await client.query<{ n: string }>("select count(*)::int as n from stock_ledger where order_id = $1", [order.id]);
      expect(Number(rows[0].n)).toBe(0);
    });
  });

  it("REQUIRED: zero warnings anywhere — transition_order's own function body contains no RAISE WARNING/NOTICE for ANY input, not just this one", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query<{ def: string }>(
        `select pg_get_functiondef('transition_order(uuid,text,uuid,text)'::regprocedure) as def`,
      );
      expect(rows[0].def).not.toMatch(/raise\s+(warning|notice)/i);
    } finally {
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Append-only enforcement (0049) — blocks direct mutation, allows the
//    real cascade path, is not fooled by a same-depth impostor
// ---------------------------------------------------------------------------

describe("WBS 6.8 — stock_ledger is append-only (0049)", () => {
  it("REQUIRED: a direct top-level UPDATE is blocked", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA AO Update Beans", unitCostSatang: 500 });
      await client.query(
        `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason) values ($1, $2, -10, 'adjustment')`,
        [merchantA.storeId, beans.id],
      );
      await expect(
        client.query(`update stock_ledger set delta_base_unit = -999 where store_id = $1 and ingredient_id = $2`, [merchantA.storeId, beans.id]),
      ).rejects.toThrow(/append-only/);
    });
  });

  it("REQUIRED: a direct top-level DELETE is blocked", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA AO Delete Beans", unitCostSatang: 500 });
      await client.query(
        `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason) values ($1, $2, -10, 'adjustment')`,
        [merchantA.storeId, beans.id],
      );
      await expect(
        client.query(`delete from stock_ledger where store_id = $1 and ingredient_id = $2`, [merchantA.storeId, beans.id]),
      ).rejects.toThrow(/append-only/);
    });
  });

  it("REQUIRED: does NOT block the real cascade — delete from auth.users through merchants -> stores -> {orders, purchase_invoices, ingredients} -> stock_ledger leaves zero orphans, trigger left enabled throughout", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const fixture = await createMerchantFixture(client, "cascade");

      const item = await insertMenuItem(client, fixture.storeId, { name: "QA Cascade Latte", priceSatang: 6000 });
      const beans = await insertIngredient(client, fixture.storeId, { name: "QA Cascade Beans", unitCostSatang: 500 });
      await insertBomLine(client, fixture.storeId, item.id, beans.id, 18);

      const order = await insertPendingOrder(client, {
        storeId: fixture.storeId,
        items: [{ menuItemId: item.id, nameSnapshot: "QA Cascade Latte", quantity: 1, unitPriceSatang: 6000, unitCostSnapshotSatang: 9000 }],
      });
      // `set_config(..., true)` and `set local role` are transaction-scoped:
      // outside an explicit BEGIN/COMMIT each is its own auto-committed
      // statement and is reverted before the next query runs, so
      // console_confirm_payment would see no JWT claim at all. This whole
      // it() intentionally skips withRollback (it needs the auth.users
      // delete below to really commit), so the role switch needs its own
      // explicit transaction instead.
      await client.query("begin");
      await asMerchant(client, fixture.authUserId);
      const confirmResult = await callConfirmPayment(client, order.id, fixture.merchantId);
      await client.query("commit");
      expect(confirmResult.ok).toBe(true);

      const invoiceId = await insertManualInvoice(client, fixture.storeId, 5000);
      await client.query("begin");
      await asMerchant(client, fixture.authUserId);
      const invoiceResult = await callConfirmInvoice(client, invoiceId, [
        { name: "Beans", rawText: "Beans 1kg", ingredientId: beans.id, qtyBaseUnit: 1000, unitCostSatang: 500, totalSatang: 5000 },
      ]);
      await client.query("commit");
      expect(invoiceResult.ok).toBe(true);

      const { rows: before } = await client.query<{ n: string }>("select count(*)::int as n from stock_ledger where store_id = $1", [
        fixture.storeId,
      ]);
      expect(Number(before[0].n)).toBe(2); // one 'sale' row (order_id set), one 'purchase' row (purchase_invoice_id set)

      const { rows: trigBefore } = await client.query<{ tgenabled: string }>(
        `select tgenabled from pg_trigger where tgname = 'trg_stock_ledger_append_only'`,
      );
      expect(trigBefore[0].tgenabled).toBe("O");

      await expect(client.query("delete from auth.users where id = $1", [fixture.authUserId])).resolves.toBeDefined();

      const { rows: trigAfter } = await client.query<{ tgenabled: string }>(
        `select tgenabled from pg_trigger where tgname = 'trg_stock_ledger_append_only'`,
      );
      expect(trigAfter[0].tgenabled).toBe("O"); // never disabled

      const { rows: after } = await client.query<{ n: string }>("select count(*)::int as n from stock_ledger where store_id = $1", [
        fixture.storeId,
      ]);
      expect(Number(after[0].n)).toBe(0); // REQUIRED: zero orphaned ledger rows
    } finally {
      await client.end();
    }
  });

  it("REQUIRED: an unrelated AFTER INSERT trigger on a scratch table that directly UPDATEs stock_ledger.delta_base_unit at the same depth a real cascade runs at is still blocked — the exemption checks SHAPE, not merely pg_trigger_depth()", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    const suffix = randomUUID().replace(/-/g, "");
    const scratchTable = `qa_6_8_scratch_${suffix}`;
    const scratchFn = `qa_6_8_scratch_fn_${suffix}`;
    try {
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Scratch Beans", unitCostSatang: 500 });
      const { rows: ledgerRows } = await client.query<{ id: string }>(
        `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason) values ($1, $2, -10, 'adjustment') returning id`,
        [merchantA.storeId, beans.id],
      );
      const ledgerId = ledgerRows[0].id;

      await client.query(`create table ${scratchTable} (id uuid primary key default gen_random_uuid(), ledger_id uuid not null)`);
      await client.query(`
        create function ${scratchFn}() returns trigger language plpgsql as $fn$
        begin
          update stock_ledger set delta_base_unit = -999999 where id = NEW.ledger_id;
          return NEW;
        end;
        $fn$;
      `);
      await client.query(`create trigger trg_${scratchFn} after insert on ${scratchTable} for each row execute function ${scratchFn}()`);

      await expect(client.query(`insert into ${scratchTable} (ledger_id) values ($1)`, [ledgerId])).rejects.toThrow(/append-only/);

      const { rows: after } = await client.query<{ delta_base_unit: string }>("select delta_base_unit from stock_ledger where id = $1", [ledgerId]);
      expect(Number(after[0].delta_base_unit)).toBe(-10); // unchanged
    } finally {
      await client.query(`drop table if exists ${scratchTable} cascade`);
      await client.query(`drop function if exists ${scratchFn}()`);
      await client.end();
    }
  });
});

// ---------------------------------------------------------------------------
// 2b. Isolated order_id/purchase_invoice_id SET NULL exemption proof.
//
//     redline_reviewer HIGH finding on this file: the combined cascade test
//     above (2's "does NOT block the real cascade") deletes a WHOLE merchant
//     account, which fires the store_id/ingredient_id DELETE branches on
//     stock_ledger directly AND (via orders/purchase_invoices' own store_id
//     cascade) queues order_id/purchase_invoice_id SET NULL UPDATEs on the
//     same rows. Postgres does not guarantee which per-FK RI action reaches a
//     given row first -- if the store_id-direct DELETE removes the row before
//     the order_id SET NULL's UPDATE statement runs, that UPDATE's WHERE
//     clause matches zero rows and the SET NULL branch never fires at all.
//     The combined test's end-state assertion (0 orphans) cannot distinguish
//     "the UPDATE branch fired and was exempted" from "the UPDATE branch
//     never ran because the row was already gone."
//
//     These two tests delete ONLY an order / ONLY a purchase_invoice directly
//     -- store and ingredient rows are left fully intact, so store_id and
//     ingredient_id never resolve to a deleted parent and the DELETE branch
//     of 0049's exemption can never apply. The ONLY way the row can survive
//     is if the UPDATE branch (order_id / purchase_invoice_id SET NULL) fires
//     and is correctly exempted -- proving that shape independently of the
//     DELETE-branch race above. Each test also carries a negative control: an
//     unrelated order/invoice's own stock_ledger row must NOT be nulled out,
//     proving the exemption is scoped to the actual FK relationship rather
//     than a blanket pass for any UPDATE.
// ---------------------------------------------------------------------------

describe("WBS 6.8 — isolated proof: order_id/purchase_invoice_id SET NULL branches actually execute (independent of the full-cascade DELETE race)", () => {
  it("REQUIRED: deleting only an order (store/ingredient intact) leaves the matching stock_ledger row alive with order_id set to NULL", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Isolated Order Beans", unitCostSatang: 500 });
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Isolated Order Latte", priceSatang: 6000 });

      const order = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        items: [{ menuItemId: item.id, nameSnapshot: "QA Isolated Order Latte", quantity: 1, unitPriceSatang: 6000, unitCostSnapshotSatang: 9000 }],
      });
      const { rows: ledgerRows } = await client.query<{ id: string }>(
        `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, order_id)
         values ($1, $2, -18, 'sale', $3) returning id`,
        [merchantA.storeId, beans.id, order.id],
      );
      const ledgerId = ledgerRows[0].id;

      // Negative control: a DIFFERENT order's ledger row, to prove the
      // exemption is scoped to this specific FK relationship, not a blanket
      // pass that nulls every stock_ledger row's order_id on any order delete.
      const otherOrder = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        items: [{ menuItemId: item.id, nameSnapshot: "QA Isolated Order Latte (control)", quantity: 1, unitPriceSatang: 6000, unitCostSnapshotSatang: 9000 }],
      });
      const { rows: controlRows } = await client.query<{ id: string }>(
        `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, order_id)
         values ($1, $2, -18, 'sale', $3) returning id`,
        [merchantA.storeId, beans.id, otherOrder.id],
      );
      const controlLedgerId = controlRows[0].id;

      // The direct delete itself must not raise (proves the UPDATE branch is
      // exempted, not merely that some outer error swallowed a failure).
      await expect(client.query("delete from orders where id = $1", [order.id])).resolves.toBeDefined();

      const { rows: after } = await client.query<{ order_id: string | null }>(
        "select order_id from stock_ledger where id = $1",
        [ledgerId],
      );
      expect(after).toHaveLength(1); // survived -- the append-only trigger did not block the exempted UPDATE
      expect(after[0].order_id).toBeNull(); // the SET NULL branch actually fired

      const { rows: control } = await client.query<{ order_id: string | null }>(
        "select order_id from stock_ledger where id = $1",
        [controlLedgerId],
      );
      expect(control[0].order_id).toBe(otherOrder.id); // unrelated row untouched -- exemption is scoped, not blanket
    });
  });

  it("REQUIRED: deleting only a purchase_invoice (store/ingredient intact) leaves the matching stock_ledger row alive with purchase_invoice_id set to NULL", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Isolated Invoice Beans", unitCostSatang: 500 });

      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 25000);
      const { rows: ledgerRows } = await client.query<{ id: string }>(
        `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, purchase_invoice_id)
         values ($1, $2, 5000, 'purchase', $3) returning id`,
        [merchantA.storeId, beans.id, invoiceId],
      );
      const ledgerId = ledgerRows[0].id;

      // Negative control: a DIFFERENT invoice's ledger row must be untouched.
      const otherInvoiceId = await insertManualInvoice(client, merchantA.storeId, 25000);
      const { rows: controlRows } = await client.query<{ id: string }>(
        `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, purchase_invoice_id)
         values ($1, $2, 5000, 'purchase', $3) returning id`,
        [merchantA.storeId, beans.id, otherInvoiceId],
      );
      const controlLedgerId = controlRows[0].id;

      await expect(client.query("delete from purchase_invoices where id = $1", [invoiceId])).resolves.toBeDefined();

      const { rows: after } = await client.query<{ purchase_invoice_id: string | null }>(
        "select purchase_invoice_id from stock_ledger where id = $1",
        [ledgerId],
      );
      expect(after).toHaveLength(1); // survived
      expect(after[0].purchase_invoice_id).toBeNull(); // the SET NULL branch actually fired

      const { rows: control } = await client.query<{ purchase_invoice_id: string | null }>(
        "select purchase_invoice_id from stock_ledger where id = $1",
        [controlLedgerId],
      );
      expect(control[0].purchase_invoice_id).toBe(otherInvoiceId); // unrelated row untouched -- exemption is scoped, not blanket
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Atomicity — a forced failure AFTER deduction has already run rolls back
//    the order status change AND the ledger rows, not just the deduction
//    insert itself (payment_confirmation.test.ts's own atomicity test forces
//    failure ON the stock_ledger insert; this one forces failure on the
//    LATER `update payments` step, proving the already-written stock_ledger
//    rows and the already-written orders.status/paid_at columns roll back too).
// ---------------------------------------------------------------------------

describe("WBS 6.8 — atomicity: a forced failure AFTER stock deduction rolls back everything in the same call", () => {
  it("REQUIRED: forcing an exception on the payments status update (which runs after transition_order's stock_ledger insert) undoes the order status change, paid_at/payment_confirmed_by, and the stock_ledger rows", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Late-Boom Latte", priceSatang: 5500 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Late-Boom Beans", unitCostSatang: 300 });
      await insertBomLine(client, merchantA.storeId, item.id, beans.id, 10);

      const order = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        items: [{ menuItemId: item.id, nameSnapshot: "QA Late-Boom Latte", quantity: 1, unitPriceSatang: 5500, unitCostSnapshotSatang: 3000 }],
      });

      // Fires on the `update payments ... status = 'succeeded'` step, which
      // in console_confirm_payment's current body (0033) runs strictly AFTER
      // transition_order (status + stock_ledger insert) and AFTER the
      // paid_at/payment_confirmed_by update — so by the time this raises,
      // deduction has genuinely already happened, not merely been attempted.
      await client.query(`
        create or replace function qa_6_8_force_late_boom() returns trigger as $$
        begin
          if new.order_id = '${order.id}' and new.status = 'succeeded' then
            raise exception 'QA-6.8 forced failure AFTER deduction';
          end if;
          return new;
        end;
        $$ language plpgsql;
      `);
      await client.query(`
        create trigger qa_6_8_force_late_boom_trg
        before update on payments
        for each row execute function qa_6_8_force_late_boom();
      `);

      await asMerchant(client, merchantA.authUserId);
      await tx.savepoint("sp_before_late_boom");
      await expect(callConfirmPayment(client, order.id, merchantA.merchantId)).rejects.toThrow(/QA-6\.8 forced failure/);
      await tx.rollbackToSavepoint("sp_before_late_boom");
      await resetRole(client);

      const { rows: orderRows } = await client.query<{ status: string; paid_at: string | null }>(
        "select status, paid_at from orders where id = $1",
        [order.id],
      );
      expect(orderRows[0].status).toBe("PENDING_PAYMENT"); // did NOT survive
      expect(orderRows[0].paid_at).toBeNull();

      const { rows: ledgerRows } = await client.query<{ n: string }>("select count(*)::int as n from stock_ledger where order_id = $1", [
        order.id,
      ]);
      expect(Number(ledgerRows[0].n)).toBe(0); // the deduction that DID happen is gone too

      const { rows: historyRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from order_status_history where order_id = $1",
        [order.id],
      );
      expect(Number(historyRows[0].n)).toBe(0); // transition_order's own history write rolled back too
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Traceability — every ledger row resolves to an order or an invoice, and
//    the sum reproduces ingredient_stock_levels() exactly
// ---------------------------------------------------------------------------

describe("WBS 6.8 — traceability: every ledger row resolves to an order or invoice; the sum reproduces the derived stock exactly", () => {
  it("REQUIRED", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Trace Latte", priceSatang: 6000 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Trace Beans", unitCostSatang: 500 });
      await insertBomLine(client, merchantA.storeId, item.id, beans.id, 18);

      // A 'sale' row (order_id set, purchase_invoice_id null).
      const order = await insertPendingOrder(client, {
        storeId: merchantA.storeId,
        items: [{ menuItemId: item.id, nameSnapshot: "QA Trace Latte", quantity: 2, unitPriceSatang: 6000, unitCostSnapshotSatang: 9000 }],
      });
      await asMerchant(client, merchantA.authUserId);
      expect((await callConfirmPayment(client, order.id, merchantA.merchantId)).ok).toBe(true);
      await resetRole(client);

      // A 'purchase' row (purchase_invoice_id set, order_id null).
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 25000);
      await asMerchant(client, merchantA.authUserId);
      expect(
        (
          await callConfirmInvoice(client, invoiceId, [
            { name: "Beans", rawText: "Beans 5kg", ingredientId: beans.id, qtyBaseUnit: 5000, unitCostSatang: 500, totalSatang: 25000 },
          ])
        ).ok,
      ).toBe(true);
      await resetRole(client);

      const { rows: ledgerRows } = await client.query<{ order_id: string | null; purchase_invoice_id: string | null; delta_base_unit: string }>(
        "select order_id, purchase_invoice_id, delta_base_unit from stock_ledger where ingredient_id = $1",
        [beans.id],
      );
      expect(ledgerRows.length).toBeGreaterThanOrEqual(2);
      for (const row of ledgerRows) {
        expect(row.order_id !== null || row.purchase_invoice_id !== null).toBe(true);
      }

      const manualSum = ledgerRows.reduce((sum, row) => sum + Number(row.delta_base_unit), 0);

      const { rows: levelRows } = await client.query<{ stock_base_unit: string }>(
        "select stock_base_unit from ingredient_stock_levels($1) where ingredient_id = $2",
        [merchantA.storeId, beans.id],
      );
      expect(Number(levelRows[0].stock_base_unit)).toBe(manualSum);
      expect(Number(levelRows[0].stock_base_unit)).toBe(5000 - 18 * 2); // 5000 purchased - 36 sold
    });
  });
});
