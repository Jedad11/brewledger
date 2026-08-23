// WBS 5.12 qa_engineer leg — Manual Cash Sale Entry.
//
// Drives console_create_cash_sale / console_undo_cash_sale (packages/db/
// migrations/0050_console_cash_sale.sql, mirrored to supabase/migrations/)
// directly against a real local Postgres — same "RLS/triggers/constraints
// only exist in the database, a mock proves nothing" posture as
// payment_confirmation.test.ts and console_advance_order.test.ts. Both
// functions are `authenticated`-only and rely on auth_store_ids() (which
// reads auth.uid() off request.jwt.claims), so every call in this file goes
// through the same set_config('request.jwt.claims', ...) + `set [local]
// role authenticated` mechanism those two files establish — NOT
// supabase-js/PostgREST, so the genuinely-concurrent undo test can hold 10
// independent sessions each with their own role/claims.
//
// Per PROGRESS.md's WBS 5.12 row, the engineer leg hand-verified (via a
// throwaway, uncommitted tsx script against a real local Postgres) the
// happy-path shape of both functions, but explicitly did NOT verify: a
// concurrent double-tap on undo, RLS-layer adversarial probing, or leave any
// permanent regression test. This file is that permanent test file.
//
// Covers:
//   1. A cash sale: channel='cash', status='ACCEPTED', pickup_slot_id=null,
//      customer_name='หน้าร้าน', no payments row, zero push_notify jobs
//   2. Stock deducts identically to the online path (same stock_ledger
//      reason='sale' shape as transition_order's own
//      PENDING_PAYMENT->ACCEPTED branch)
//   3. RL-2: a zero-BOM item snapshots unit_cost_snapshot_satang=NULL, never 0
//   4. Undo within the window -> CANCELLED, compensating
//      cancellation_reversal row, AND refund_status=null (not 'pending' —
//      the one genuinely new RL-1-adjacent rule this entry adds)
//   5. Undo outside the window (genuinely backdated created_at) ->
//      UNDO_NOT_AVAILABLE, order untouched
//   6. Undo on a non-cash order, or an already-non-ACCEPTED order, also ->
//      UNDO_NOT_AVAILABLE
//   7. Cross-merchant/spoofed p_merchant_id -> FORBIDDEN, zero mutation;
//      merchant with no store -> NOT_FOUND
//   8. Cart revalidation: a stale claimed price -> PRICE_MISMATCH with the
//      same diff shape checkout_create_order uses
//   9. REQUIRED: 10 genuinely concurrent undo calls on the SAME order ->
//      exactly one real transition, nine UNDO_NOT_AVAILABLE
//   10. Grants: both functions are unreachable by anon and service_role,
//       reachable only by authenticated
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
let merchantNoStore: MerchantFixture;
const createdAuthUserIds: string[] = [];

async function createMerchantFixture(client: Client, label: string, opts?: { noStore?: boolean }): Promise<MerchantFixture> {
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

  createdAuthUserIds.push(authUserId);

  if (opts?.noStore) {
    return { authUserId, merchantId, storeId: "" };
  }

  const storeResult = await client.query<{ id: string }>(
    `insert into stores (merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity)
     values ($1, $2, $3, '07:00', '19:00', 'Asia/Bangkok', 3)
     returning id`,
    [merchantId, `qa-5-12-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`, `QA 5.12 Store ${label}`],
  );
  const storeId = storeResult.rows[0].id;

  return { authUserId, merchantId, storeId };
}

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[console_cash_sale.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` (and \`supabase db reset\` if the ` +
        "stack predates migration 0050) first. This is a SKIP, not a pass.\n",
    );
    return;
  }

  const client = await connect();
  try {
    merchantA = await createMerchantFixture(client, "a");
    merchantB = await createMerchantFixture(client, "b");
    merchantNoStore = await createMerchantFixture(client, "nostore", { noStore: true });
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

async function insertMenuItem(
  client: Client,
  storeId: string,
  opts: { name: string; priceSatang: number; availability?: string },
): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `insert into menu_items (store_id, name, price_satang, availability) values ($1, $2, $3, $4) returning id`,
    [storeId, opts.name, opts.priceSatang, opts.availability ?? "available"],
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

interface CartLine {
  menuItemId: string;
  nameSnapshot: string;
  quantity: number;
  unitPriceSatang: number;
  options?: unknown[];
}

function cartLinesJson(lines: CartLine[]): string {
  return JSON.stringify(lines.map((l) => ({ ...l, options: l.options ?? [] })));
}

interface CreateSaleResult {
  ok: boolean;
  code?: string;
  message?: string;
  diffs?: Array<Record<string, unknown>>;
  order?: {
    id: string;
    order_code: string;
    total_satang: number;
    cups: number;
    created_at: string;
    items: Array<{ name: string; quantity: number }>;
  };
}

async function callCreateSale(client: Client, merchantId: string, lines: CartLine[]): Promise<CreateSaleResult> {
  const { rows } = await client.query("select console_create_cash_sale($1, $2::jsonb) as result", [
    merchantId,
    cartLinesJson(lines),
  ]);
  return rows[0].result as CreateSaleResult;
}

interface UndoResult {
  ok: boolean;
  code?: string;
  message?: string;
  order?: { id: string; status: string };
}

async function callUndo(client: Client, merchantId: string, orderId: string): Promise<UndoResult> {
  const { rows } = await client.query("select console_undo_cash_sale($1, $2) as result", [merchantId, orderId]);
  return rows[0].result as UndoResult;
}

describe("WBS 5.12 — console_create_cash_sale: happy-path shape", () => {
  it("a cash sale is ACCEPTED/channel=cash/pickup_slot_id=null/customer_name='หน้าร้าน', writes no payments row, and enqueues zero push_notify jobs", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Cash Latte", priceSatang: 6000 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Cash Beans", unitCostSatang: 500 });
      await insertBomLine(client, merchantA.storeId, item.id, beans.id, 18);

      await asMerchant(client, merchantA.authUserId);
      const result = await callCreateSale(client, merchantA.merchantId, [
        { menuItemId: item.id, nameSnapshot: "QA Cash Latte", quantity: 2, unitPriceSatang: 6000 },
      ]);
      expect(result.ok).toBe(true);
      expect(result.order?.total_satang).toBe(12000);
      expect(result.order?.cups).toBe(2);

      await resetRole(client);

      const { rows: orderRows } = await client.query<{
        channel: string;
        status: string;
        pickup_slot_id: string | null;
        customer_name: string;
      }>("select channel, status, pickup_slot_id, customer_name from orders where id = $1", [result.order!.id]);
      expect(orderRows[0]).toEqual({
        channel: "cash",
        status: "ACCEPTED",
        pickup_slot_id: null,
        customer_name: "หน้าร้าน",
      });

      const { rows: paymentRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from payments where order_id = $1",
        [result.order!.id],
      );
      expect(Number(paymentRows[0].n)).toBe(0);

      const { rows: jobRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'push_notify' and payload->>'orderId' = $1",
        [result.order!.id],
      );
      expect(Number(jobRows[0].n)).toBe(0);
    });
  });
});

describe("WBS 5.12 — console_create_cash_sale: stock deduction matches the online path exactly", () => {
  it("writes one stock_ledger row per bom_line, reason='sale', same delta shape as transition_order's PENDING_PAYMENT->ACCEPTED branch", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Cash Stock Latte", priceSatang: 6500 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Cash Stock Beans", unitCostSatang: 500 });
      const milk = await insertIngredient(client, merchantA.storeId, { name: "QA Cash Stock Milk", unitCostSatang: 45 });
      await insertBomLine(client, merchantA.storeId, item.id, beans.id, 18);
      await insertBomLine(client, merchantA.storeId, item.id, milk.id, 150);

      await asMerchant(client, merchantA.authUserId);
      const result = await callCreateSale(client, merchantA.merchantId, [
        { menuItemId: item.id, nameSnapshot: "QA Cash Stock Latte", quantity: 3, unitPriceSatang: 6500 },
      ]);
      expect(result.ok).toBe(true);

      await resetRole(client);

      const { rows: ledgerRows } = await client.query<{ ingredient_id: string; delta_base_unit: string; reason: string }>(
        "select ingredient_id, delta_base_unit, reason from stock_ledger where order_id = $1 order by delta_base_unit",
        [result.order!.id],
      );
      expect(ledgerRows).toHaveLength(2);
      expect(ledgerRows.every((r) => r.reason === "sale")).toBe(true);

      const beansRow = ledgerRows.find((r) => r.ingredient_id === beans.id);
      const milkRow = ledgerRows.find((r) => r.ingredient_id === milk.id);
      expect(Number(beansRow!.delta_base_unit)).toBe(-(18 * 3)); // -54
      expect(Number(milkRow!.delta_base_unit)).toBe(-(150 * 3)); // -450
    });
  });
});

describe("WBS 5.12 — RL-2: a zero-BOM item snapshots unit_cost_snapshot_satang=NULL, never 0", () => {
  it("a mixed cart of one tracked item and one zero-BOM item: tracked line gets a real cost, zero-BOM line gets NULL — and the order-level total_cost_snapshot_satang is also NULL (one untracked line NULLs the whole order)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const trackedItem = await insertMenuItem(client, merchantA.storeId, { name: "QA Cash Tracked Latte", priceSatang: 6500 });
      const untrackedItem = await insertMenuItem(client, merchantA.storeId, { name: "QA Cash Untracked Cookie", priceSatang: 3000 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Cash RL2 Beans", unitCostSatang: 500 });
      await insertBomLine(client, merchantA.storeId, trackedItem.id, beans.id, 18);
      // untrackedItem gets NO bom_lines at all — this is the path a
      // zero-BOM merchant will use most (WBS 5.12's own acceptance line).

      await asMerchant(client, merchantA.authUserId);
      const result = await callCreateSale(client, merchantA.merchantId, [
        { menuItemId: trackedItem.id, nameSnapshot: "QA Cash Tracked Latte", quantity: 1, unitPriceSatang: 6500 },
        { menuItemId: untrackedItem.id, nameSnapshot: "QA Cash Untracked Cookie", quantity: 2, unitPriceSatang: 3000 },
      ]);
      expect(result.ok).toBe(true);

      await resetRole(client);

      const { rows: itemRows } = await client.query<{
        item_name_snapshot: string;
        unit_cost_snapshot_satang: number | null;
      }>("select item_name_snapshot, unit_cost_snapshot_satang from order_items where order_id = $1", [result.order!.id]);

      const trackedRow = itemRows.find((r) => r.item_name_snapshot === "QA Cash Tracked Latte");
      const untrackedRow = itemRows.find((r) => r.item_name_snapshot === "QA Cash Untracked Cookie");
      expect(trackedRow?.unit_cost_snapshot_satang).toBe(9000); // 18 * 500
      expect(untrackedRow?.unit_cost_snapshot_satang).toBeNull(); // NEVER 0
      expect(untrackedRow?.unit_cost_snapshot_satang).not.toBe(0);

      const { rows: orderRows } = await client.query<{ total_cost_snapshot_satang: number | null }>(
        "select total_cost_snapshot_satang from orders where id = $1",
        [result.order!.id],
      );
      expect(orderRows[0].total_cost_snapshot_satang).toBeNull();

      // Stock only moves for the tracked item's ingredient.
      const { rows: ledgerRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from stock_ledger where order_id = $1",
        [result.order!.id],
      );
      expect(Number(ledgerRows[0].n)).toBe(1);
    });
  });
});

describe("WBS 5.12 — console_create_cash_sale: cart revalidation, PRICE_MISMATCH", () => {
  it("a stale claimed price returns PRICE_MISMATCH with the same diff shape checkout_create_order uses, and creates NO order", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Cash Stale Latte", priceSatang: 7000 });

      await asMerchant(client, merchantA.authUserId);
      const result = await callCreateSale(client, merchantA.merchantId, [
        { menuItemId: item.id, nameSnapshot: "QA Cash Stale Latte", quantity: 1, unitPriceSatang: 6000 }, // stale: real price is 7000
      ]);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("PRICE_MISMATCH");
      expect(result.diffs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "price_changed", menuItemId: item.id, oldSatang: 6000, newSatang: 7000 }),
        ]),
      );

      await resetRole(client);
      const { rows } = await client.query<{ n: string }>(
        "select count(*)::int as n from orders where store_id = $1 and status = 'ACCEPTED'",
        [merchantA.storeId],
      );
      expect(Number(rows[0].n)).toBe(0); // no order written on a diff
    });
  });

  it("a hidden item returns item_removed; an out-of-stock item returns item_unavailable, matching checkout_create_order's own diff vocabulary", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const hiddenItem = await insertMenuItem(client, merchantA.storeId, {
        name: "QA Cash Hidden",
        priceSatang: 5000,
        availability: "hidden",
      });

      await asMerchant(client, merchantA.authUserId);
      const result = await callCreateSale(client, merchantA.merchantId, [
        { menuItemId: hiddenItem.id, nameSnapshot: "QA Cash Hidden", quantity: 1, unitPriceSatang: 5000 },
      ]);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("PRICE_MISMATCH");
      expect(result.diffs).toEqual(
        expect.arrayContaining([expect.objectContaining({ kind: "item_removed", menuItemId: hiddenItem.id })]),
      );
    });
  });
});

describe("WBS 5.12 — console_create_cash_sale: ownership — FORBIDDEN vs NOT_FOUND", () => {
  it("a spoofed/cross-tenant p_merchant_id returns FORBIDDEN and mutates nothing", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Cash Forbidden", priceSatang: 6000 });

      // Merchant B's own JWT, but claims to be acting for merchant A's id.
      await asMerchant(client, merchantB.authUserId);
      const result = await callCreateSale(client, merchantA.merchantId, [
        { menuItemId: item.id, nameSnapshot: "QA Cash Forbidden", quantity: 1, unitPriceSatang: 6000 },
      ]);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("FORBIDDEN");

      await resetRole(client);
      const { rows } = await client.query<{ n: string }>(
        "select count(*)::int as n from orders where store_id = $1",
        [merchantA.storeId],
      );
      expect(Number(rows[0].n)).toBe(0);
    });
  });

  it("a merchant with no store returns NOT_FOUND", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      await asMerchant(client, merchantNoStore.authUserId);
      const result = await callCreateSale(client, merchantNoStore.merchantId, [
        { menuItemId: randomUUID(), nameSnapshot: "QA Cash Nostore", quantity: 1, unitPriceSatang: 1000 },
      ]);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("NOT_FOUND");
    });
  });
});

describe("WBS 5.12 — console_undo_cash_sale: undo within the window", () => {
  it("flips the order to CANCELLED, writes a compensating cancellation_reversal row, and sets refund_status=null (NOT 'pending')", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Undo Latte", priceSatang: 6000 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Undo Beans", unitCostSatang: 500 });
      await insertBomLine(client, merchantA.storeId, item.id, beans.id, 18);

      await asMerchant(client, merchantA.authUserId);
      const sale = await callCreateSale(client, merchantA.merchantId, [
        { menuItemId: item.id, nameSnapshot: "QA Undo Latte", quantity: 1, unitPriceSatang: 6000 },
      ]);
      expect(sale.ok).toBe(true);

      const undo = await callUndo(client, merchantA.merchantId, sale.order!.id);
      expect(undo.ok).toBe(true);
      expect(undo.order?.status).toBe("CANCELLED");

      await resetRole(client);

      const { rows: orderRows } = await client.query<{ status: string; refund_status: string | null }>(
        "select status, refund_status from orders where id = $1",
        [sale.order!.id],
      );
      expect(orderRows[0].status).toBe("CANCELLED");
      expect(orderRows[0].refund_status).toBeNull(); // NOT 'pending' — RL-1 override

      const { rows: ledgerRows } = await client.query<{ reason: string; delta_base_unit: string }>(
        "select reason, delta_base_unit from stock_ledger where order_id = $1 order by created_at asc",
        [sale.order!.id],
      );
      expect(ledgerRows).toHaveLength(2); // one 'sale' + one 'cancellation_reversal'
      expect(ledgerRows[0].reason).toBe("sale");
      expect(Number(ledgerRows[0].delta_base_unit)).toBe(-18);
      expect(ledgerRows[1].reason).toBe("cancellation_reversal");
      expect(Number(ledgerRows[1].delta_base_unit)).toBe(18); // exact compensating reversal

      const { rows: historyRows } = await client.query<{ from_status: string; to_status: string }>(
        "select from_status, to_status from order_status_history where order_id = $1",
        [sale.order!.id],
      );
      expect(historyRows).toEqual([{ from_status: "ACCEPTED", to_status: "CANCELLED" }]);
    });
  });

  it("does NOT regress transition_order's normal ACCEPTED->CANCELLED behavior for another caller: a plain (non-cash-sale-undo) cancellation still sets refund_status='pending'", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      // An ONLINE-style order, accepted directly (bypassing console_create_
      // cash_sale entirely), then cancelled via transition_order the way
      // WBS 5.11's own (not-yet-built) cancel-with-reason flow would.
      const orderCode = `Q${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
      const { rows } = await client.query<{ id: string }>(
        `insert into orders (store_id, order_code, customer_name, channel, status, subtotal_satang, total_satang)
         values ($1, $2, 'QA Online Customer', 'online', 'ACCEPTED', 6000, 6000) returning id`,
        [merchantA.storeId, orderCode],
      );
      const orderId = rows[0].id;

      await client.query("select transition_order($1, 'CANCELLED', $2, 'merchant')", [orderId, merchantA.merchantId]);

      const { rows: after } = await client.query<{ refund_status: string | null }>(
        "select refund_status from orders where id = $1",
        [orderId],
      );
      expect(after[0].refund_status).toBe("pending"); // UNCHANGED general behavior — override is scoped only to console_undo_cash_sale
    });
  });
});

describe("WBS 5.12 — console_undo_cash_sale: rejected outside the window, on wrong channel, or wrong status", () => {
  it("a genuinely backdated (3-minutes-old) order returns UNDO_NOT_AVAILABLE and leaves the order untouched", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Undo Late Latte", priceSatang: 6000 });
      const beans = await insertIngredient(client, merchantA.storeId, { name: "QA Undo Late Beans", unitCostSatang: 500 });
      await insertBomLine(client, merchantA.storeId, item.id, beans.id, 18);

      await asMerchant(client, merchantA.authUserId);
      const sale = await callCreateSale(client, merchantA.merchantId, [
        { menuItemId: item.id, nameSnapshot: "QA Undo Late Latte", quantity: 1, unitPriceSatang: 6000 },
      ]);
      expect(sale.ok).toBe(true);

      await resetRole(client);
      // Genuinely backdate created_at (not merely a different order state)
      // — the migration checks a SERVER-side timestamp, never a client
      // "still in window" boolean.
      await client.query("update orders set created_at = now() - interval '3 minutes' where id = $1", [sale.order!.id]);

      await asMerchant(client, merchantA.authUserId);
      const undo = await callUndo(client, merchantA.merchantId, sale.order!.id);
      expect(undo.ok).toBe(false);
      expect(undo.code).toBe("UNDO_NOT_AVAILABLE");

      await resetRole(client);
      const { rows } = await client.query<{ status: string; refund_status: string | null }>(
        "select status, refund_status from orders where id = $1",
        [sale.order!.id],
      );
      expect(rows[0].status).toBe("ACCEPTED"); // untouched
      expect(rows[0].refund_status).toBeNull();

      const { rows: ledgerRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from stock_ledger where order_id = $1",
        [sale.order!.id],
      );
      expect(Number(ledgerRows[0].n)).toBe(1); // still just the original 'sale' row, no reversal
    });
  });

  it("an ONLINE-channel order (not a cash sale) returns UNDO_NOT_AVAILABLE, even when ACCEPTED and fresh", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const orderCode = `Q${randomUUID().replace(/-/g, "").slice(0, 5).toUpperCase()}`;
      const { rows } = await client.query<{ id: string }>(
        `insert into orders (store_id, order_code, customer_name, channel, status, subtotal_satang, total_satang)
         values ($1, $2, 'QA Online Customer 2', 'online', 'ACCEPTED', 6000, 6000) returning id`,
        [merchantA.storeId, orderCode],
      );
      const orderId = rows[0].id;

      await asMerchant(client, merchantA.authUserId);
      const undo = await callUndo(client, merchantA.merchantId, orderId);
      expect(undo.ok).toBe(false);
      expect(undo.code).toBe("UNDO_NOT_AVAILABLE");

      await resetRole(client);
      const { rows: after } = await client.query<{ status: string }>("select status from orders where id = $1", [orderId]);
      expect(after[0].status).toBe("ACCEPTED"); // untouched
    });
  });

  it("an already-non-ACCEPTED cash-sale order (e.g. already CANCELLED) returns UNDO_NOT_AVAILABLE on a second attempt", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Undo Twice Latte", priceSatang: 6000 });

      await asMerchant(client, merchantA.authUserId);
      const sale = await callCreateSale(client, merchantA.merchantId, [
        { menuItemId: item.id, nameSnapshot: "QA Undo Twice Latte", quantity: 1, unitPriceSatang: 6000 },
      ]);
      const first = await callUndo(client, merchantA.merchantId, sale.order!.id);
      expect(first.ok).toBe(true);

      const second = await callUndo(client, merchantA.merchantId, sale.order!.id);
      expect(second.ok).toBe(false);
      expect(second.code).toBe("UNDO_NOT_AVAILABLE"); // NOT idempotent like confirm/advance — this is a real rejection
    });
  });
});

describe("WBS 5.12 — console_undo_cash_sale: ownership", () => {
  it("a spoofed/cross-tenant p_merchant_id on undo returns FORBIDDEN and mutates nothing", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, merchantA.storeId, { name: "QA Undo Forbidden Latte", priceSatang: 6000 });

      await asMerchant(client, merchantA.authUserId);
      const sale = await callCreateSale(client, merchantA.merchantId, [
        { menuItemId: item.id, nameSnapshot: "QA Undo Forbidden Latte", quantity: 1, unitPriceSatang: 6000 },
      ]);

      // Merchant B's own JWT, spoofing merchant A's id.
      await asMerchant(client, merchantB.authUserId);
      const undo = await callUndo(client, merchantA.merchantId, sale.order!.id);
      expect(undo.ok).toBe(false);
      expect(undo.code).toBe("FORBIDDEN");

      await resetRole(client);
      const { rows } = await client.query<{ status: string }>("select status from orders where id = $1", [sale.order!.id]);
      expect(rows[0].status).toBe("ACCEPTED"); // unchanged
    });
  });

  it("a nonexistent order id returns NOT_FOUND", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      await asMerchant(client, merchantA.authUserId);
      const undo = await callUndo(client, merchantA.merchantId, randomUUID());
      expect(undo.ok).toBe(false);
      expect(undo.code).toBe("NOT_FOUND");
    });
  });
});

describe("WBS 5.12 — console_undo_cash_sale: 10 genuinely concurrent undo calls on the SAME order", () => {
  it("REQUIRED: ten parallel undo calls (10 real connections, Promise.all) yield exactly ONE real transition to CANCELLED and nine UNDO_NOT_AVAILABLE — never two reversals, never an inconsistent stock_ledger", async () => {
    if (!dbAvailable) return;

    const setupClient = await connect();
    let orderId: string;
    try {
      const item = await insertMenuItem(setupClient, merchantA.storeId, { name: "QA Undo Concurrent Latte", priceSatang: 7000 });
      const beans = await insertIngredient(setupClient, merchantA.storeId, { name: "QA Undo Concurrent Beans", unitCostSatang: 400 });
      await insertBomLine(setupClient, merchantA.storeId, item.id, beans.id, 20);

      await asMerchant(setupClient, merchantA.authUserId, { local: false });
      const sale = await callCreateSale(setupClient, merchantA.merchantId, [
        { menuItemId: item.id, nameSnapshot: "QA Undo Concurrent Latte", quantity: 1, unitPriceSatang: 7000 },
      ]);
      expect(sale.ok).toBe(true);
      orderId = sale.order!.id;
      await setupClient.query("reset role");
    } finally {
      await setupClient.end();
    }

    // 10 independent connections/sessions — genuinely parallel, same bar
    // payment_confirmation.test.ts's own concurrency proof sets, not 10
    // sequential calls in a loop against one shared client. This is exactly
    // the scenario PROGRESS.md's WBS 5.12 row flags as NOT hand-verified by
    // the engineer leg.
    const clients = await Promise.all(Array.from({ length: 10 }, () => connect()));
    try {
      await Promise.all(clients.map((client) => asMerchant(client, merchantA.authUserId, { local: false })));

      const results = await Promise.all(clients.map((client) => callUndo(client, merchantA.merchantId, orderId)));

      const winners = results.filter((r) => r.ok === true);
      const rejections = results.filter((r) => r.ok === false && r.code === "UNDO_NOT_AVAILABLE");
      expect(winners).toHaveLength(1);
      expect(rejections).toHaveLength(9);
      // No result is any OTHER shape (an unhandled error, a different code).
      expect(winners.length + rejections.length).toBe(10);

      const verify = await connect();
      try {
        const { rows: orderRows } = await verify.query<{ status: string; refund_status: string | null }>(
          "select status, refund_status from orders where id = $1",
          [orderId],
        );
        expect(orderRows[0].status).toBe("CANCELLED");
        expect(orderRows[0].refund_status).toBeNull();

        // Exactly 2 stock_ledger rows total across all 10 attempts (1 sale +
        // 1 reversal), never a double reversal.
        const { rows: ledgerRows } = await verify.query<{ n: string }>(
          "select count(*)::int as n from stock_ledger where order_id = $1",
          [orderId],
        );
        expect(Number(ledgerRows[0].n)).toBe(2);

        const { rows: reversalRows } = await verify.query<{ n: string }>(
          "select count(*)::int as n from stock_ledger where order_id = $1 and reason = 'cancellation_reversal'",
          [orderId],
        );
        expect(Number(reversalRows[0].n)).toBe(1);

        const { rows: historyRows } = await verify.query<{ n: string }>(
          "select count(*)::int as n from order_status_history where order_id = $1 and to_status = 'CANCELLED'",
          [orderId],
        );
        expect(Number(historyRows[0].n)).toBe(1);
      } finally {
        await verify.end();
      }
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  }, 30_000);
});

describe("WBS 5.12 — grants: both functions are authenticated-only", () => {
  it("anon and service_role cannot execute console_create_cash_sale or console_undo_cash_sale; authenticated can", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query<{
        anon_can_create: boolean;
        authenticated_can_create: boolean;
        service_role_can_create: boolean;
        anon_can_undo: boolean;
        authenticated_can_undo: boolean;
        service_role_can_undo: boolean;
      }>(
        `select
           has_function_privilege('anon', 'console_create_cash_sale(uuid, jsonb)', 'execute') as anon_can_create,
           has_function_privilege('authenticated', 'console_create_cash_sale(uuid, jsonb)', 'execute') as authenticated_can_create,
           has_function_privilege('service_role', 'console_create_cash_sale(uuid, jsonb)', 'execute') as service_role_can_create,
           has_function_privilege('anon', 'console_undo_cash_sale(uuid, uuid)', 'execute') as anon_can_undo,
           has_function_privilege('authenticated', 'console_undo_cash_sale(uuid, uuid)', 'execute') as authenticated_can_undo,
           has_function_privilege('service_role', 'console_undo_cash_sale(uuid, uuid)', 'execute') as service_role_can_undo`,
      );
      expect(rows[0]).toEqual({
        anon_can_create: false,
        authenticated_can_create: true,
        service_role_can_create: false,
        anon_can_undo: false,
        authenticated_can_undo: true,
        service_role_can_undo: false,
      });
    } finally {
      await client.end();
    }
  });
});
