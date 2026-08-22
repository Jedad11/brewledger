// WBS 7.8 — performance fixture: ~6 months of a busy pilot store, enough to
// expose a bad plan on the Supabase free tier (shared CPU, 500 MB RAM)
// without blowing the 500 MB disk cap. Target row counts per the WBS
// Dictionary's own Claude Code Prompt (~lines 5778-5781): ~60 orders/day,
// 2.3 items/order (~11,000 orders / ~25,000 order_items over 183 days), 25
// menu items, 15 ingredients, ~180 purchase invoices.
//
// Deliberately NOT a `supabase/seed.sql`-style SQL script: 11k+ rows of
// weighted-random data is far easier to generate correctly with a seeded PRNG
// in TypeScript than in `generate_series` SQL, and this only ever needs to
// run against a local dev stack, never as part of `supabase db reset`'s own
// migration+seed path (see the local-only guard below).
//
// Scope of "truncate-and-regenerate": this does NOT `TRUNCATE` whole tables
// (that would also destroy packages/db/seed.sql's demo-cafe fixture and any
// other local dev data sharing the same database). Instead it deletes and
// rebuilds ONE fixture tree, rooted at a fixed, well-known auth.users row
// (PERF_FIXTURE_AUTH_USER_ID below). Deleting that row cascades through
// merchants -> stores -> every store-scoped table (menu_items, ingredients,
// bom_lines, orders, order_items, purchase_invoices, purchase_line_items,
// stock_ledger, daily_financials, pickup_slots — see docs/db/schema.md's FK
// reference), exactly the mechanism packages/db/tests/helpers/rls-fixture.ts
// and auth-user-fixture.ts already rely on for cleanup. Re-running this
// script is therefore always "delete the old fixture tree, build a fresh
// one" — never additive.
//
// Reproducibility: the fixed PRNG seed (SEED below) makes every random
// CHOICE (status distribution, item counts, quantities, which lines get a
// null cost snapshot) deterministic run-to-run. The absolute dates are NOT
// fixed — the window is "the 183 days ending now", a genuinely *rolling* 6
// months, per the WBS's own framing ("6 months of a busy pilot store"). That
// means row COUNTS and exact timestamps can differ by a few rows between
// runs (today's partial day, leap-year boundaries), which is why
// docs/db/query_plans.md's header must be filled in from this script's own
// printed counts on the run that produced the recorded EXPLAIN output, never
// from the nominal targets above.
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const SEED = 0xb2e57ed6; // arbitrary, fixed — "brewseed" mangled to fit uint32
const WINDOW_DAYS = 183; // ~6 months
const ORDERS_PER_DAY_TARGET = 60;
const MENU_ITEM_COUNT = 25;
const INGREDIENT_COUNT = 15;
const INVOICE_TARGET = 180;

const DATABASE_URL =
  process.env.PERF_SEED_DATABASE_URL ??
  process.env.DATABASE_URL ??
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// Mirrors packages/shared/src/config.ts's assertLocalSupabaseInDev guard:
// this script inserts and deletes thousands of rows under a raw superuser
// connection string, nothing an accidental point at a hosted project should
// ever be allowed to do.
function assertLocalTarget(connectionString: string): void {
  let hostname: string;
  try {
    // Postgres connection strings parse fine as a WHATWG URL once the
    // scheme is normalised — `postgresql://` and `postgres://` both work.
    hostname = new URL(connectionString).hostname;
  } catch {
    throw new Error(
      `perf-seed.ts: could not parse a hostname out of the target connection ` +
        `string. Refusing to run against something unrecognised. Set ` +
        `PERF_SEED_DATABASE_URL to a local postgresql:// URL.`,
    );
  }
  const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
  if (!LOCAL_HOSTNAMES.has(hostname)) {
    throw new Error(
      `perf-seed.ts: target host "${hostname}" is not 127.0.0.1/localhost. ` +
        `This script deletes and regenerates ~11,000+ rows and must never run ` +
        `against a hosted project. Run \`supabase start\` and target the local ` +
        `stack (postgresql://postgres:postgres@127.0.0.1:54322/postgres), or ` +
        `set PERF_SEED_DATABASE_URL explicitly to a local instance.`,
    );
  }
}

// mulberry32 — small, dependency-free, deterministic PRNG. Good enough for
// fixture shaping; this is not cryptographic and never needs to be.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(SEED);
const randInt = (minInclusive: number, maxInclusive: number) =>
  minInclusive + Math.floor(rand() * (maxInclusive - minInclusive + 1));
const pick = <T>(arr: readonly T[]): T => arr[randInt(0, arr.length - 1)];
function weightedPick<T>(entries: readonly [T, number][]): T {
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = rand() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

const PERF_FIXTURE_AUTH_USER_ID = "a0000000-7000-4000-8000-000000000078"; // "78" = WBS 7.8
const PERF_FIXTURE_PHONE = "+66800000078";
const PERF_STORE_SLUG = "perf-fixture-store";

const ORDER_STATUSES = [
  "PENDING_PAYMENT",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "COLLECTED",
  "CANCELLED",
  "REFUNDED",
  "EXPIRED",
] as const;
type OrderStatus = (typeof ORDER_STATUSES)[number];

// Working queue + terminal statuses, weighted toward COLLECTED (matches a
// real pilot store: most orders that got this far were picked up).
const WORKING_AND_COLLECTED: readonly [OrderStatus, number][] = [
  ["COLLECTED", 80],
  ["READY", 6],
  ["PREPARING", 7],
  ["ACCEPTED", 7],
];

interface IngredientRow {
  id: string;
  baseUnit: "g" | "ml" | "piece";
  unitCostSatang: number;
}
interface MenuItemRow {
  id: string;
  priceSatang: number;
  bomCostSatang: number | null; // null => item has zero bom_lines (RL-2)
}

async function main(): Promise<void> {
  assertLocalTarget(DATABASE_URL);

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  const counts = {
    orders: 0,
    orderItems: 0,
    purchaseInvoices: 0,
    purchaseLineItems: 0,
    stockLedger: 0,
    dailyFinancials: 0,
    businessDates: 0,
  };

  try {
    console.log(`perf-seed: target ${DATABASE_URL.replace(/:[^:@]*@/, ":****@")}`);
    console.log("perf-seed: deleting any prior fixture tree...");
    await client.query("delete from auth.users where id = $1", [PERF_FIXTURE_AUTH_USER_ID]);

    console.log("perf-seed: creating fixture merchant/store...");
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
      [PERF_FIXTURE_AUTH_USER_ID, PERF_FIXTURE_PHONE],
    );

    // 0023_merchant_auto_provision.sql's trigger already created the
    // merchants row synchronously above — read it back rather than inserting
    // (see packages/db/seed.sql / auth-user-fixture.ts for the same pattern).
    const merchantResult = await client.query<{ id: string }>(
      "select id from merchants where auth_user_id = $1",
      [PERF_FIXTURE_AUTH_USER_ID],
    );
    const merchantId = merchantResult.rows[0].id;

    const storeResult = await client.query<{ id: string }>(
      `insert into stores (
         id, merchant_id, slug, name, pickup_address, timezone,
         opens_at, closes_at, promptpay_id, promptpay_type, promptpay_verified_at, is_published
       ) values (
         gen_random_uuid(), $1, $2, 'Perf Fixture Cafe', '1 Perf Rd, Bangkok', 'Asia/Bangkok',
         time '07:00', time '19:00', '0800000078', 'msisdn', now(), true
       ) returning id`,
      [merchantId, PERF_STORE_SLUG],
    );
    const storeId = storeResult.rows[0].id;

    const categoryResult = await client.query<{ id: string }>(
      `insert into menu_categories (id, store_id, name, sort_order)
       values (gen_random_uuid(), $1, 'Menu', 0) returning id`,
      [storeId],
    );
    const categoryId = categoryResult.rows[0].id;

    console.log(`perf-seed: creating ${INGREDIENT_COUNT} ingredients...`);
    const baseUnits: IngredientRow["baseUnit"][] = ["g", "ml", "piece"];
    const ingredients: IngredientRow[] = [];
    for (let i = 0; i < INGREDIENT_COUNT; i++) {
      const baseUnit = baseUnits[i % baseUnits.length];
      const unitCostSatang = randInt(5, 300);
      const id = randomUUID();
      await client.query(
        `insert into ingredients (id, store_id, name, base_unit, current_unit_cost_satang, current_stock_base_unit, low_stock_threshold)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, storeId, `Perf Ingredient ${i + 1}`, baseUnit, unitCostSatang, randInt(500, 5000), randInt(100, 500)],
      );
      ingredients.push({ id, baseUnit, unitCostSatang });
    }

    // 20% of menu items (5 of 25) sell with zero bom_lines — the RL-2 reality
    // most pilot shops are actually in. This is also what produces most of
    // the ~15-20% null unit_cost_snapshot_satang on order_items below: an
    // item with no recipe has no cost to snapshot, full stop, never 0.
    console.log(`perf-seed: creating ${MENU_ITEM_COUNT} menu items...`);
    const menuItems: MenuItemRow[] = [];
    for (let i = 0; i < MENU_ITEM_COUNT; i++) {
      const priceSatang = randInt(35, 95) * 100;
      const id = randomUUID();
      await client.query(
        `insert into menu_items (id, store_id, category_id, name, description, price_satang, availability, sort_order)
         values ($1, $2, $3, $4, $5, $6, 'available', $7)`,
        [id, storeId, categoryId, `Perf Item ${i + 1}`, "Performance fixture item", priceSatang, i],
      );

      const hasRecipe = i % 5 !== 4; // 20 of 25 get a recipe
      let bomCostSatang: number | null = null;
      if (hasRecipe) {
        const lineCount = randInt(1, 3);
        const chosen = new Set<number>();
        while (chosen.size < lineCount) chosen.add(randInt(0, ingredients.length - 1));
        bomCostSatang = 0;
        for (const idx of chosen) {
          const ing = ingredients[idx];
          const qty = randInt(5, 200);
          bomCostSatang += Math.round(ing.unitCostSatang * qty);
          await client.query(
            `insert into bom_lines (id, store_id, menu_item_id, ingredient_id, qty_base_unit)
             values (gen_random_uuid(), $1, $2, $3, $4)
             on conflict (menu_item_id, ingredient_id) do nothing`,
            [storeId, id, ing.id, qty],
          );
        }
      }
      menuItems.push({ id, priceSatang, bomCostSatang });
    }

    const NOW = new Date();
    const windowStart = new Date(NOW.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

    let orderCode = 0;

    console.log(`perf-seed: generating ${WINDOW_DAYS} days of orders/purchases (this takes a while)...`);
    for (let day = 0; day < WINDOW_DAYS; day++) {
      const businessDate = new Date(windowStart.getTime() + day * 24 * 60 * 60 * 1000);
      const businessDateStr = businessDate.toISOString().slice(0, 10);
      const isRecentDay = day >= WINDOW_DAYS - 3; // last 3 days only, for PENDING_PAYMENT

      const orderRows: unknown[][] = [];
      const orderItemRows: unknown[][] = [];

      const dailyOrderCount = Math.max(1, ORDERS_PER_DAY_TARGET + randInt(-8, 8));

      let grossRevenueSatang = 0;
      let totalCogsSatang = 0;
      let untrackedItemCount = 0;
      let dayOrderCount = 0;

      for (let n = 0; n < dailyOrderCount; n++) {
        orderCode += 1;
        const createdAt = new Date(
          businessDate.getTime() + randInt(7 * 3600, 19 * 3600) * 1000,
        );

        let status: OrderStatus;
        const statusRoll = rand();
        if (isRecentDay && statusRoll < 0.02) {
          status = "PENDING_PAYMENT";
        } else if (statusRoll < 0.05) {
          status = "EXPIRED";
        } else if (statusRoll < 0.08) {
          status = weightedPick([
            ["CANCELLED", 1],
            ["REFUNDED", 1],
          ]);
        } else {
          status = weightedPick(WORKING_AND_COLLECTED);
        }

        const isRevenueStatus =
          status === "ACCEPTED" || status === "PREPARING" || status === "READY" || status === "COLLECTED";
        const isPaid = isRevenueStatus || status === "CANCELLED" || status === "REFUNDED";

        const itemCount = weightedPick<number>([
          [1, 20],
          [2, 35],
          [3, 30],
          [4, 15],
        ]);

        const orderId = randomUUID();
        let subtotalSatang = 0;
        let orderTrackedCostSatang = 0;
        let orderHasTrackedItem = false;

        for (let i = 0; i < itemCount; i++) {
          const menuItem = pick(menuItems);
          const quantity = weightedPick<number>([
            [1, 70],
            [2, 22],
            [3, 8],
          ]);
          const unitPriceSatang = menuItem.priceSatang;
          // Untracked when the item has no recipe (RL-2) OR, for a recipe'd
          // item, ~5% of the time to land the overall null rate in the
          // 15-20% band the WBS asks for rather than exactly 20% (a real
          // store's untracked rate isn't a clean multiple of item count).
          const untracked = menuItem.bomCostSatang === null || rand() < 0.05;
          const unitCostSnapshotSatang = untracked ? null : menuItem.bomCostSatang;

          subtotalSatang += unitPriceSatang * quantity;
          if (unitCostSnapshotSatang !== null) {
            orderTrackedCostSatang += unitCostSnapshotSatang * quantity;
            orderHasTrackedItem = true;
          } else {
            untrackedItemCount += 1;
          }

          orderItemRows.push([
            randomUUID(),
            orderId,
            storeId,
            menuItem.id,
            "Perf Item",
            quantity,
            unitPriceSatang,
            unitCostSnapshotSatang,
            "[]",
          ]);
          counts.orderItems += 1;
        }

        const totalSatang = subtotalSatang;
        const totalCostSnapshotSatang = orderHasTrackedItem ? orderTrackedCostSatang : null;

        orderRows.push([
          orderId,
          storeId,
          `PERF-${orderCode.toString(36).toUpperCase()}`,
          "Perf Customer",
          `+668${(10000000 + (orderCode % 89999999)).toString().slice(0, 8)}`,
          null, // pickup_slot_id — not needed for report-query perf, see file header
          n % 5 === 0 ? "cash" : "online",
          status,
          subtotalSatang,
          totalSatang,
          totalCostSnapshotSatang,
          isPaid ? createdAt : null,
          isPaid ? "perf-seed" : null,
          isPaid ? createdAt : null,
          status === "REFUNDED" ? "done" : status === "CANCELLED" ? "pending" : null,
          status === "PENDING_PAYMENT" ? new Date(createdAt.getTime() + 15 * 60 * 1000) : null,
          createdAt,
        ]);
        counts.orders += 1;
        dayOrderCount += 1;

        if (isRevenueStatus) {
          grossRevenueSatang += totalSatang;
          if (orderHasTrackedItem) totalCogsSatang += orderTrackedCostSatang;
        }
      }

      await batchInsert(
        client,
        "orders",
        [
          "id", "store_id", "order_code", "customer_name", "customer_phone", "pickup_slot_id",
          "channel", "status", "subtotal_satang", "total_satang", "total_cost_snapshot_satang",
          "paid_at", "payment_confirmed_by", "payment_confirmed_at", "refund_status", "expires_at", "created_at",
        ],
        orderRows,
      );
      await batchInsert(
        client,
        "order_items",
        [
          "id", "order_id", "store_id", "menu_item_id", "item_name_snapshot",
          "quantity", "unit_price_snapshot_satang", "unit_cost_snapshot_satang", "options_snapshot",
        ],
        orderItemRows,
        ["options_snapshot"], // cast to jsonb
      );

      // ~1 purchase invoice/day (~180 over the window), 1-4 lines each.
      if (rand() < INVOICE_TARGET / WINDOW_DAYS) {
        const lineCount = randInt(1, 4);
        const chosenIdx = new Set<number>();
        while (chosenIdx.size < lineCount) chosenIdx.add(randInt(0, ingredients.length - 1));
        const invoiceId = randomUUID();
        let invoiceTotalSatang = 0;
        const lineRows: unknown[][] = [];
        const stockRows: unknown[][] = [];
        for (const idx of chosenIdx) {
          const ing = ingredients[idx];
          const qty = randInt(1000, 5000);
          const totalSatang = Math.round(ing.unitCostSatang * qty);
          invoiceTotalSatang += totalSatang;
          lineRows.push([
            randomUUID(), invoiceId, storeId, ing.id, "perf-seed line",
            qty, ing.unitCostSatang, totalSatang, 0.95,
          ]);
          stockRows.push([randomUUID(), storeId, ing.id, qty, "purchase", null, invoiceId]);
        }
        await client.query(
          `insert into purchase_invoices (id, store_id, image_path, vendor_name, invoice_date, total_satang, ocr_status, review_status, raw_ocr_output, created_at)
           values ($1, $2, 'perf-seed/invoice.jpg', 'Perf Supplier', $3, $4, 'processed', 'confirmed', $5, $6)`,
          [invoiceId, storeId, businessDateStr, invoiceTotalSatang, JSON.stringify({ note: "perf-seed" }), businessDate],
        );
        counts.purchaseInvoices += 1;
        await batchInsert(
          client,
          "purchase_line_items",
          ["id", "invoice_id", "store_id", "ingredient_id", "raw_text", "qty_base_unit", "unit_cost_satang", "total_satang", "mapping_confidence"],
          lineRows,
        );
        counts.purchaseLineItems += lineRows.length;
        await batchInsert(
          client,
          "stock_ledger",
          ["id", "store_id", "ingredient_id", "delta_base_unit", "reason", "order_id", "purchase_invoice_id"],
          stockRows,
        );
        counts.stockLedger += stockRows.length;
      }

      const netProfitSatang = totalCogsSatang > 0 || grossRevenueSatang > 0 ? grossRevenueSatang - totalCogsSatang : null;
      await client.query(
        `insert into daily_financials (id, store_id, business_date, gross_revenue_satang, total_cogs_satang, untracked_item_count, other_expense_satang, net_profit_satang, order_count)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, 0, $6, $7)
         on conflict (store_id, business_date) do update set
           gross_revenue_satang = excluded.gross_revenue_satang,
           total_cogs_satang = excluded.total_cogs_satang,
           untracked_item_count = excluded.untracked_item_count,
           net_profit_satang = excluded.net_profit_satang,
           order_count = excluded.order_count`,
        [storeId, businessDateStr, grossRevenueSatang, totalCogsSatang, untrackedItemCount, netProfitSatang, dayOrderCount],
      );
      counts.dailyFinancials += 1;
      counts.businessDates += 1;

      if (day % 30 === 0) console.log(`perf-seed: day ${day}/${WINDOW_DAYS} (${businessDateStr})...`);
    }

    // Without this, the planner's row estimates on a freshly bulk-loaded
    // table are whatever autovacuum last left behind (often nothing, on a
    // brand new local stack), which produces false-positive Seq Scan
    // findings in the perf test even when the real, ANALYZE'd plan uses the
    // index correctly. See docs/db/query_plans.md's "IMPORTANT" note.
    console.log("perf-seed: running ANALYZE on fixture tables...");
    for (const table of [
      "orders",
      "order_items",
      "daily_financials",
      "stock_ledger",
      "purchase_invoices",
      "purchase_line_items",
    ]) {
      await client.query(`analyze ${table}`);
    }

    console.log("perf-seed: done.");
    console.log(`perf-seed: store_id=${storeId} slug=${PERF_STORE_SLUG}`);
    console.log(
      `perf-seed: orders=${counts.orders} order_items=${counts.orderItems} ` +
        `purchase_invoices=${counts.purchaseInvoices} purchase_line_items=${counts.purchaseLineItems} ` +
        `stock_ledger=${counts.stockLedger} daily_financials=${counts.dailyFinancials} ` +
        `business_dates=${counts.businessDates}`,
    );
    console.log(
      "perf-seed: copy the counts line above into docs/db/query_plans.md's header verbatim " +
        "(the WBS's nominal targets, e.g. ~11,000 orders, are a planning estimate, not the recorded number).",
    );
  } finally {
    await client.end();
  }
}

// Chunked multi-row INSERT — one round trip per ~500 rows instead of one per
// row, the difference between this script finishing in seconds vs. minutes
// at ~25,000 order_items.
async function batchInsert(
  client: Client,
  table: string,
  columns: string[],
  rows: unknown[][],
  jsonbColumns: string[] = [],
  chunkSize = 500,
): Promise<void> {
  if (rows.length === 0) return;
  const jsonbSet = new Set(jsonbColumns);
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values: unknown[] = [];
    const tuples: string[] = [];
    for (const row of chunk) {
      const placeholders = columns.map((col, i) => {
        values.push(row[i]);
        const paramIndex = values.length;
        return jsonbSet.has(col) ? `$${paramIndex}::jsonb` : `$${paramIndex}`;
      });
      tuples.push(`(${placeholders.join(", ")})`);
    }
    const sql = `insert into ${table} (${columns.join(", ")}) values ${tuples.join(", ")}`;
    await client.query(sql, values);
  }
}

main().catch((err) => {
  console.error("perf-seed failed:", err);
  process.exitCode = 1;
});
