// WBS 6.5 engineer leg — Ingredient Master and Unit Conversion.
//
// Drives packages/db/migrations/0041_ingredient_master_conversions.sql (the
// ingredient_stock_levels() function, the prevent_base_unit_change_if_referenced
// trigger, and the stock_ledger.ingredient_id CASCADE->RESTRICT tightening)
// directly against a real Postgres instance, same "RLS/triggers/constraints
// only exist in the database, a mock proves nothing" posture as schema.test.ts
// and checkout_create_order.test.ts. Fixture/helper shape copied from
// checkout_create_order.test.ts (WBS 5.4's own qa_engineer leg) rather than
// re-derived, for the same reasons that file gives.
//
// Covers WBS 6.5's own acceptance criteria:
//   - RL-2: a store with ZERO ingredients sells online with null cost
//     (via checkout_create_order, WBS 5.4 -- see the RL-2 describe block
//     below for the one deliberate scope note: "cash sale", WBS 5.12, does
//     not exist in this repo yet, so only the online leg is exercised here)
//   - Reconciliation: ingredient_stock_levels()'s returned stock_base_unit
//     always equals a manual sum(delta_base_unit) over the same ledger rows
//   - Purchase in kg correctly yields a per-gram cost (packages/costing's
//     own unit test already proves the pure arithmetic in isolation; this
//     file additionally proves ingredient_stock_levels' days_of_cover
//     arithmetic against real ledger rows)
//   - Ingredient deletion is blocked (DB-level ON DELETE RESTRICT, not just
//     app-layer) when referenced by bom_lines or by any stock_ledger row;
//     succeeds when genuinely unreferenced
//   - Base unit is immutable once a purchase_line_item or stock_ledger row
//     references the ingredient, enforced by a real trigger
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, isReachable, LOCAL_DB_URL, withRollback } from "./helpers/db";

let dbAvailable = false;
let authUserId: string | undefined;
let merchantId: string | undefined;
let storeId: string | undefined;
let storeSlug: string;

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[ingredient_master.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` (and \`supabase db reset\` if the ` +
        "stack predates migration 0041) first. This is a SKIP, not a pass.\n",
    );
    return;
  }

  const client = await connect();
  try {
    authUserId = randomUUID();
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
    merchantId = merchantResult.rows[0].id;

    storeSlug = `qa-6-5-inventory-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    // Same fully-verified-PromptPay shape checkout_create_order.test.ts's
    // fixture uses -- checkout_create_order only matches is_published=true,
    // and 0027's trigger forces is_published back to false without it.
    const storeResult = await client.query<{ id: string }>(
      `insert into stores (
         merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity,
         promptpay_id, promptpay_type, promptpay_verified_at, is_published
       )
       values ($1, $2, 'QA 6.5 Store', '07:00', '19:00', 'Asia/Bangkok', 3, '0891234567', 'msisdn', now(), true)
       returning id`,
      [merchantId, storeSlug],
    );
    storeId = storeResult.rows[0].id;
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  if (!dbAvailable || !authUserId) return;
  const client = await connect();
  try {
    // Cascades merchants -> stores -> ingredients/menu_items/orders, same
    // as checkout_create_order.test.ts's own cleanup.
    await client.query("delete from auth.users where id = $1", [authUserId]);
  } finally {
    await client.end();
  }
});

let slotOffsetCounter = 0;

async function insertFutureSlot(client: Client, opts: { capacity: number }): Promise<{ id: string }> {
  slotOffsetCounter += 1;
  const offsetMinutes = 60 + slotOffsetCounter * 15;
  const { rows } = await client.query<{ id: string }>(
    `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
     values ($1, now() + make_interval(mins => $3::int), now() + make_interval(mins => $3::int + 15), $2, 0, true)
     returning id`,
    [storeId, opts.capacity, offsetMinutes],
  );
  return { id: rows[0].id };
}

async function insertMenuItem(client: Client, opts: { name: string; priceSatang: number }): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `insert into menu_items (store_id, name, price_satang) values ($1, $2, $3) returning id`,
    [storeId, opts.name, opts.priceSatang],
  );
  return { id: rows[0].id };
}

async function insertIngredient(
  client: Client,
  opts: { name: string; baseUnit?: string; costSatang?: number | null },
): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `insert into ingredients (store_id, name, base_unit, current_unit_cost_satang)
     values ($1, $2, $3, $4) returning id`,
    [storeId, opts.name, opts.baseUnit ?? "g", opts.costSatang ?? null],
  );
  return { id: rows[0].id };
}

async function insertStockLedgerRow(
  client: Client,
  ingredientId: string,
  opts: { deltaBaseUnit: number; reason: string; daysAgo?: number },
): Promise<void> {
  await client.query(
    `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, created_at)
     values ($1, $2, $3, $4, now() - make_interval(days => $5::int))`,
    [storeId, ingredientId, opts.deltaBaseUnit, opts.reason, opts.daysAgo ?? 0],
  );
}

async function insertPurchaseLineItem(client: Client, ingredientId: string): Promise<void> {
  const { rows: invoiceRows } = await client.query<{ id: string }>(
    `insert into purchase_invoices (store_id, image_path) values ($1, 'qa/fixture.jpg') returning id`,
    [storeId],
  );
  await client.query(
    `insert into purchase_line_items (invoice_id, store_id, ingredient_id, qty_base_unit, unit_cost_satang, total_satang)
     values ($1, $2, $3, 1000, 45, 45000)`,
    [invoiceRows[0].id, storeId, ingredientId],
  );
}

interface CheckoutResult {
  ok: boolean;
  code?: string;
  order?: { order_code: string; items: unknown[] };
}

async function callCheckout(
  client: Client,
  args: { cartLines: unknown[]; pickupSlotId: string; customerName: string },
): Promise<CheckoutResult> {
  const { rows } = await client.query(`select checkout_create_order($1, $2, $3, $4, $5) as result`, [
    storeSlug,
    JSON.stringify(args.cartLines),
    args.pickupSlotId,
    args.customerName,
    null,
  ]);
  return rows[0].result as CheckoutResult;
}

describe("WBS 6.5 — RL-2: a store with ZERO ingredients sells normally", () => {
  it("creates a menu item with no BOM and sells it online (checkout_create_order) -- succeeds, unit_cost_snapshot_satang is NULL, never 0", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      // Genuinely zero ingredients for this specific menu item: no
      // ingredients row is created or referenced anywhere in this test.
      const item = await insertMenuItem(client, { name: "QA 6.5 Zero-Ingredient Cookie", priceSatang: 3500 });
      const slot = await insertFutureSlot(client, { capacity: 3 });

      const result = await callCheckout(client, {
        cartLines: [
          {
            menuItemId: item.id,
            nameSnapshot: "QA 6.5 Zero-Ingredient Cookie",
            unitPriceSatang: 3500,
            quantity: 1,
            options: [],
          },
        ],
        pickupSlotId: slot.id,
        customerName: "QA 6.5 RL-2 Customer",
      });

      expect(result.ok).toBe(true);
      expect(result.order).toBeDefined();

      const { rows } = await client.query<{ unit_cost_snapshot_satang: number | null }>(
        `select oi.unit_cost_snapshot_satang
           from order_items oi join orders o on o.id = oi.order_id
          where o.order_code = $1`,
        [result.order!.order_code],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].unit_cost_snapshot_satang).toBeNull();
      expect(rows[0].unit_cost_snapshot_satang).not.toBe(0);

      // By construction this item has zero bom_lines and no ingredients row
      // was ever created -- there is nothing stock-shaped for the sale to
      // have touched, the same silence WBS 6.8's own RL-2 rule will require
      // once automatic deduction exists.
      const { rows: bomRows } = await client.query<{ n: string }>(
        `select count(*)::int as n from bom_lines where menu_item_id = $1`,
        [item.id],
      );
      expect(Number(bomRows[0].n)).toBe(0);
    });
  });

  // NOTE, not a gap in this entry: WBS 6.5's own Claude Code prompt literally
  // asks for "sells it online and as a cash sale". Manual Cash Sale Entry
  // (WBS 5.12) has not been built in this repo yet -- grepped the full
  // codebase for cash_sale/cashSale, zero implementation hits, only an
  // unrelated feature-gating string. The online leg above is exercised in
  // full against checkout_create_order (WBS 5.4), which IS built and
  // already implements the null-cost rule correctly (0029's own
  // bool_or(...is null) guard). The cash-sale leg is deferred to whichever
  // WBS 6.5 (or 5.12 itself) follow-up runs after 5.12 ships, the same
  // "defer, don't fake" posture this session's own WBS 6.0 entry took for
  // OCR.
});

describe("WBS 6.5 — ingredient_stock_levels(): stock is DERIVED, never a stored mutable column", () => {
  it("returned stock_base_unit always equals a manual sum(delta_base_unit) over the same ledger rows", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const ingredient = await insertIngredient(client, { name: "QA 6.5 Reconciliation Milk", baseUnit: "ml" });
      await insertStockLedgerRow(client, ingredient.id, { deltaBaseUnit: 6000, reason: "purchase" });
      await insertStockLedgerRow(client, ingredient.id, { deltaBaseUnit: -500, reason: "sale" });
      await insertStockLedgerRow(client, ingredient.id, { deltaBaseUnit: -1200, reason: "sale" });
      await insertStockLedgerRow(client, ingredient.id, { deltaBaseUnit: -50, reason: "waste" });

      const { rows: fnRows } = await client.query<{ stock_base_unit: string }>(
        `select stock_base_unit from ingredient_stock_levels($1) where ingredient_id = $2`,
        [storeId, ingredient.id],
      );
      const { rows: manualRows } = await client.query<{ manual_sum: string }>(
        `select coalesce(sum(delta_base_unit), 0) as manual_sum from stock_ledger where ingredient_id = $1`,
        [ingredient.id],
      );

      expect(Number(fnRows[0].stock_base_unit)).toBe(Number(manualRows[0].manual_sum));
      expect(Number(fnRows[0].stock_base_unit)).toBe(4250); // 6000 - 500 - 1200 - 50
    });
  });

  it("an ingredient with zero stock_ledger rows returns stock_base_unit = 0, never a raw NULL from the LEFT JOIN", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const ingredient = await insertIngredient(client, { name: "QA 6.5 Never Purchased" });

      const { rows } = await client.query<{ stock_base_unit: string; days_of_cover: string | null }>(
        `select stock_base_unit, days_of_cover from ingredient_stock_levels($1) where ingredient_id = $2`,
        [storeId, ingredient.id],
      );
      expect(Number(rows[0].stock_base_unit)).toBe(0);
      expect(rows[0].days_of_cover).toBeNull();
    });
  });

  it("days_of_cover is a real 30-day trailing burn-rate estimate, not a placeholder", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const ingredient = await insertIngredient(client, { name: "QA 6.5 Burn Rate Beans" });
      await insertStockLedgerRow(client, ingredient.id, { deltaBaseUnit: 3000, reason: "purchase", daysAgo: 10 });
      // 300g sold over the last 10 days -> 30g/day average -> stock/30 days
      // of cover on the CURRENT stock (2700g remaining after this line).
      await insertStockLedgerRow(client, ingredient.id, { deltaBaseUnit: -300, reason: "sale", daysAgo: 5 });

      const { rows } = await client.query<{ stock_base_unit: string; days_of_cover: string }>(
        `select stock_base_unit, days_of_cover from ingredient_stock_levels($1) where ingredient_id = $2`,
        [storeId, ingredient.id],
      );
      expect(Number(rows[0].stock_base_unit)).toBe(2700);
      // burn rate = 300 / 30 = 10 g/day; days_of_cover = round(2700 / 10, 1) = 270
      expect(Number(rows[0].days_of_cover)).toBe(270);
    });
  });

  it("a sale older than 30 days does not count toward the burn rate -- days_of_cover is NULL, not stale", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const ingredient = await insertIngredient(client, { name: "QA 6.5 Stale Sale" });
      await insertStockLedgerRow(client, ingredient.id, { deltaBaseUnit: 1000, reason: "purchase", daysAgo: 40 });
      await insertStockLedgerRow(client, ingredient.id, { deltaBaseUnit: -200, reason: "sale", daysAgo: 35 });

      const { rows } = await client.query<{ days_of_cover: string | null }>(
        `select days_of_cover from ingredient_stock_levels($1) where ingredient_id = $2`,
        [storeId, ingredient.id],
      );
      expect(rows[0].days_of_cover).toBeNull();
    });
  });
});

describe("WBS 6.5 — ingredient deletion is blocked at the DB layer when referenced", () => {
  it("blocked by a bom_lines reference (ON DELETE RESTRICT, 0009)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const ingredient = await insertIngredient(client, { name: "QA 6.5 In-A-Recipe" });
      const item = await insertMenuItem(client, { name: "QA 6.5 Recipe Item", priceSatang: 5000 });
      await client.query(
        `insert into bom_lines (store_id, menu_item_id, ingredient_id, qty_base_unit) values ($1, $2, $3, 18)`,
        [storeId, item.id, ingredient.id],
      );

      await tx.savepoint("sp_bom_delete");
      await expect(client.query(`delete from ingredients where id = $1`, [ingredient.id])).rejects.toThrow(
        /foreign key|violates/i,
      );
      await tx.rollbackToSavepoint("sp_bom_delete");
    });
  });

  it("blocked by a stock_ledger reference (tightened CASCADE -> RESTRICT, 0041)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const ingredient = await insertIngredient(client, { name: "QA 6.5 Has Ledger History" });
      await insertStockLedgerRow(client, ingredient.id, { deltaBaseUnit: 500, reason: "purchase" });

      await tx.savepoint("sp_ledger_delete");
      await expect(client.query(`delete from ingredients where id = $1`, [ingredient.id])).rejects.toThrow(
        /foreign key|violates/i,
      );
      await tx.rollbackToSavepoint("sp_ledger_delete");

      // Belt and braces: the ledger row (the audit trail 0017's own header
      // comment exists to protect) really did survive the failed delete.
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::int as n from stock_ledger where ingredient_id = $1`,
        [ingredient.id],
      );
      expect(Number(rows[0].n)).toBe(1);
    });
  });

  it("succeeds for a genuinely unreferenced ingredient (positive control -- proves the RESTRICT above isn't just always blocking)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const ingredient = await insertIngredient(client, { name: "QA 6.5 Never Used" });
      await client.query(`delete from ingredients where id = $1`, [ingredient.id]);

      const { rows } = await client.query<{ n: string }>(`select count(*)::int as n from ingredients where id = $1`, [
        ingredient.id,
      ]);
      expect(Number(rows[0].n)).toBe(0);
    });
  });
});

describe("WBS 6.5 — base_unit is immutable once referenced (trg_ingredients_prevent_base_unit_change)", () => {
  it("blocks a base_unit change once a stock_ledger row exists", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const ingredient = await insertIngredient(client, { name: "QA 6.5 Locked By Ledger", baseUnit: "g" });
      await insertStockLedgerRow(client, ingredient.id, { deltaBaseUnit: 1000, reason: "purchase" });

      await tx.savepoint("sp_base_unit_ledger");
      await expect(
        client.query(`update ingredients set base_unit = 'ml' where id = $1`, [ingredient.id]),
      ).rejects.toThrow(/immutable/i);
      await tx.rollbackToSavepoint("sp_base_unit_ledger");
    });
  });

  it("blocks a base_unit change once a purchase_line_item row exists", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const ingredient = await insertIngredient(client, { name: "QA 6.5 Locked By Purchase", baseUnit: "g" });
      await insertPurchaseLineItem(client, ingredient.id);

      await tx.savepoint("sp_base_unit_purchase");
      await expect(
        client.query(`update ingredients set base_unit = 'piece' where id = $1`, [ingredient.id]),
      ).rejects.toThrow(/immutable/i);
      await tx.rollbackToSavepoint("sp_base_unit_purchase");
    });
  });

  it("allows a base_unit change for a never-referenced ingredient (positive control)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const ingredient = await insertIngredient(client, { name: "QA 6.5 Freely Editable", baseUnit: "g" });

      await client.query(`update ingredients set base_unit = 'ml' where id = $1`, [ingredient.id]);

      const { rows } = await client.query<{ base_unit: string }>(`select base_unit from ingredients where id = $1`, [
        ingredient.id,
      ]);
      expect(rows[0].base_unit).toBe("ml");
    });
  });

  it("a no-op update (base_unit set to its own current value) succeeds even when referenced -- the trigger only fires on an actual change", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const ingredient = await insertIngredient(client, { name: "QA 6.5 No-Op Update", baseUnit: "g" });
      await insertStockLedgerRow(client, ingredient.id, { deltaBaseUnit: 500, reason: "purchase" });

      await client.query(`update ingredients set base_unit = 'g', low_stock_threshold = 100 where id = $1`, [
        ingredient.id,
      ]);

      const { rows } = await client.query<{ base_unit: string; low_stock_threshold: string }>(
        `select base_unit, low_stock_threshold from ingredients where id = $1`,
        [ingredient.id],
      );
      expect(rows[0].base_unit).toBe("g");
      expect(Number(rows[0].low_stock_threshold)).toBe(100);
    });
  });
});
