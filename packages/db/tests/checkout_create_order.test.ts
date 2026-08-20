// WBS 5.4 qa_engineer leg — Checkout and Order Draft Creation.
//
// Drives checkout_create_order (packages/db/migrations/0029_checkout_order_
// creation.sql, mirrored to supabase/migrations/) directly against a real
// Postgres instance, same "RLS/triggers/constraints only exist in the
// database, a mock proves nothing" posture as schema.test.ts and
// pickup_slots.test.ts (WBS 3.5 / 5.3). This function is service_role-only
// (revoked from anon/authenticated), so it is exercised the same way
// reserve_pickup_slot is in pickup_slots.test.ts: a superuser `pg.Client`
// calling the SQL function by name, not through PostgREST/HTTP.
//
// Covers the WBS 5.4 Testing block exactly:
//   - Snapshot test: item without BOM -> null cost, not 0
//   - Snapshot test: item whose ingredient has null unit cost -> null
//     order-level total
//   - Rollback test: forced failure after reservation returns booked_count
//     to its prior value
//   - Code test: 10,000 generated codes contain no ambiguous glyph and no
//     collision
//   - RL-3 test: response body contains no cost-shaped key
// ...plus the WBS acceptance criteria the dispatch asked to spot-check:
// price-mismatch 409 diff, slot-full 410, cross-store slot rejection, and a
// name-only (no phone) order succeeding.
//
// Environment note: this sandbox's local Supabase stack runs db/auth/kong/
// storage healthy but has no edge-runtime container (the same segfault
// limitation WBS 5.3's PROGRESS.md row documents) -- so this file tests
// checkout_create_order directly against Postgres, and separately
// packages/shared/src/serializers/public.schema.test.ts unit-tests the pure
// TS serializer/schema layer (no Deno runtime required for either). It does
// NOT include an HTTP-level snapshot test of supabase/functions/
// public-create-order/index.ts itself -- that thin wrapper has no logic of
// its own beyond the RPC call and the two files above, and re-verifying it
// requires `supabase functions serve`, which is the piece known unavailable
// here.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, isReachable, LOCAL_DB_URL, withRollback } from "./helpers/db";

// scripts/scan-forbidden-fields.mjs (the WBS 3.7 §7 house convention this
// test otherwise follows) exports loadForbiddenSubstrings/
// scanForForbiddenFields as ESM with top-level import.meta -- both are
// incompatible with this package's tsconfig (module: "commonjs", inherited
// from tsconfig.base.json; see supabase/functions/tsconfig.json for the
// ESNext/Bundler config the .mjs script's own consumer,
// forbidden_field_scan.test.ts, relies on instead). Reading the SAME
// canonical docs/design/forbidden_fields.json directly here reproduces
// loadForbiddenSubstrings' own two-line body verbatim rather than fighting
// two incompatible module systems for an import this file's own RL-3 test
// is the only consumer of.
const FORBIDDEN_FIELDS_PATH = join(__dirname, "..", "..", "..", "docs", "design", "forbidden_fields.json");

function loadForbiddenSubstrings(path: string): string[] {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as { forbidden_substrings: string[] };
  return parsed.forbidden_substrings;
}

let dbAvailable = false;
let authUserId: string | undefined;
let merchantId: string | undefined;
let storeId: string | undefined;
let storeSlug: string;

// Alphabet mirrors 0029_checkout_order_creation.sql's own v_alphabet
// EXACTLY (digits 3,4,6,7,8,9; letters A-Y minus I,O,S,Z). Ambiguous glyphs
// this excludes: 0/O, 1/I/l, 2/Z, 5/S.
const ORDER_CODE_ALPHABET = "346789ABCDEFGHJKLMNPQRTUVWXY";
const AMBIGUOUS_GLYPHS = ["0", "1", "2", "5", "I", "O", "S", "Z"];

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[checkout_create_order.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` (and \`supabase db reset\` if the ` +
        "stack predates migration 0029) first. This is a SKIP, not a pass.\n",
    );
    return;
  }

  const client = await connect();
  try {
    authUserId = randomUUID();
    const phone = `+66901${Math.floor(Math.random() * 900000 + 100000)}`;
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

    storeSlug = `qa-5-4-checkout-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    // checkout_create_order only matches `is_published = true` (0029's own
    // step-1 lookup), and 0027_promptpay_publish_guard.sql's BEFORE INSERT
    // trigger + CHECK constraint force is_published back to false unless
    // promptpay_verified_at is set (RL-1: never publish an unverified
    // payee) -- so this fixture needs the full verified-PromptPay shape,
    // not just is_published: true, or every checkout call below 404s with
    // STORE_NOT_FOUND despite the row existing.
    const storeResult = await client.query<{ id: string }>(
      `insert into stores (
         merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity,
         promptpay_id, promptpay_type, promptpay_verified_at, is_published
       )
       values ($1, $2, 'QA 5.4 Store', '07:00', '19:00', 'Asia/Bangkok', 3, '0891234567', 'msisdn', now(), true)
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
    // Cascades merchants -> stores -> menu_items/pickup_slots/orders, same
    // as pickup_slots.test.ts / tenant_isolation.test.ts's cleanup.
    await client.query("delete from auth.users where id = $1", [authUserId]);
  } finally {
    await client.end();
  }
});

let slotOffsetCounter = 0;

async function insertFutureSlot(
  client: Client,
  opts: { capacity: number; bookedCount?: number; storeIdOverride?: string },
): Promise<{ id: string; slotStart: string }> {
  // pickup_slots has a (store_id, slot_start) unique constraint (0010), and
  // `now()` is FROZEN for the lifetime of one Postgres transaction -- every
  // withRollback test body runs inside a single `begin` -- so two calls
  // with the same "+1 hour" literal would collide. Stagger each call by a
  // distinct offset within the shared fixture transaction.
  slotOffsetCounter += 1;
  const offsetMinutes = 60 + slotOffsetCounter * 15;
  const { rows } = await client.query<{ id: string; slot_start: string }>(
    `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
     values ($1, now() + make_interval(mins => $4::int), now() + make_interval(mins => $4::int + 15), $2, $3, true)
     returning id, slot_start`,
    [opts.storeIdOverride ?? storeId, opts.capacity, opts.bookedCount ?? 0, offsetMinutes],
  );
  return { id: rows[0].id, slotStart: rows[0].slot_start };
}

async function insertMenuItem(
  client: Client,
  opts: { name: string; priceSatang: number },
): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `insert into menu_items (store_id, name, price_satang) values ($1, $2, $3) returning id`,
    [storeId, opts.name, opts.priceSatang],
  );
  return { id: rows[0].id };
}

async function insertIngredient(
  client: Client,
  opts: { name: string; unitCostSatang: number | null },
): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `insert into ingredients (store_id, name, base_unit, current_unit_cost_satang)
     values ($1, $2, 'g', $3) returning id`,
    [storeId, opts.name, opts.unitCostSatang],
  );
  return { id: rows[0].id };
}

async function insertBomLine(
  client: Client,
  menuItemId: string,
  ingredientId: string,
  qtyBaseUnit: number,
): Promise<void> {
  await client.query(
    `insert into bom_lines (store_id, menu_item_id, ingredient_id, qty_base_unit)
     values ($1, $2, $3, $4)`,
    [storeId, menuItemId, ingredientId, qtyBaseUnit],
  );
}

interface CheckoutResult {
  ok: boolean;
  code?: string;
  message?: string;
  diffs?: unknown[];
  slots?: unknown[];
  order?: {
    order_code: string;
    total_satang: number;
    pickup_at: string;
    expires_at: string;
    items: Array<{
      name: string;
      quantity: number;
      unit_price_satang: number;
      options: Array<{ name: string; price_delta_satang: number }>;
    }>;
  };
}

async function callCheckout(
  client: Client,
  args: {
    storeSlug: string;
    cartLines: unknown[];
    pickupSlotId: string | null;
    customerName: string;
    customerPhone?: string | null;
  },
): Promise<CheckoutResult> {
  const { rows } = await client.query(
    `select checkout_create_order($1, $2, $3, $4, $5) as result`,
    [
      args.storeSlug,
      JSON.stringify(args.cartLines),
      args.pickupSlotId,
      args.customerName,
      args.customerPhone ?? null,
    ],
  );
  return rows[0].result as CheckoutResult;
}

function cartLine(opts: {
  menuItemId: string;
  nameSnapshot: string;
  unitPriceSatang: number;
  quantity: number;
  options?: unknown[];
}) {
  return {
    menuItemId: opts.menuItemId,
    nameSnapshot: opts.nameSnapshot,
    unitPriceSatang: opts.unitPriceSatang,
    quantity: opts.quantity,
    options: opts.options ?? [],
  };
}

describe("WBS 5.4 — checkout_create_order: cost snapshot (WBS 3.5 rule)", () => {
  it("item without any bom_lines -> order_items.unit_cost_snapshot_satang and orders.total_cost_snapshot_satang are both NULL, never 0", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, { name: "QA No-Recipe Cookie", priceSatang: 4000 });
      const slot = await insertFutureSlot(client, { capacity: 3 });

      const result = await callCheckout(client, {
        storeSlug,
        cartLines: [cartLine({ menuItemId: item.id, nameSnapshot: "QA No-Recipe Cookie", unitPriceSatang: 4000, quantity: 2 })],
        pickupSlotId: slot.id,
        customerName: "QA Zero BOM",
      });

      expect(result.ok).toBe(true);
      expect(result.order).toBeDefined();

      const { rows } = await client.query<{ unit_cost_snapshot_satang: number | null; total_cost_snapshot_satang: number | null }>(
        `select oi.unit_cost_snapshot_satang, o.total_cost_snapshot_satang
           from order_items oi join orders o on o.id = oi.order_id
          where o.order_code = $1`,
        [result.order!.order_code],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].unit_cost_snapshot_satang).toBeNull();
      expect(rows[0].unit_cost_snapshot_satang).not.toBe(0);
      expect(rows[0].total_cost_snapshot_satang).toBeNull();
      expect(rows[0].total_cost_snapshot_satang).not.toBe(0);
    });
  });

  it("item WITH bom_lines but one referenced ingredient has a NULL current_unit_cost_satang -> order-level total_cost_snapshot_satang is NULL, not a partial sum", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, { name: "QA Partial-Cost Latte", priceSatang: 6500 });
      const costedIngredient = await insertIngredient(client, { name: "QA Espresso", unitCostSatang: 500 });
      const uncostedIngredient = await insertIngredient(client, { name: "QA Oat Milk (uncosted)", unitCostSatang: null });
      await insertBomLine(client, item.id, costedIngredient.id, 18);
      await insertBomLine(client, item.id, uncostedIngredient.id, 200);

      const slot = await insertFutureSlot(client, { capacity: 3 });

      const result = await callCheckout(client, {
        storeSlug,
        cartLines: [cartLine({ menuItemId: item.id, nameSnapshot: "QA Partial-Cost Latte", unitPriceSatang: 6500, quantity: 1 })],
        pickupSlotId: slot.id,
        customerName: "QA Null Propagation",
      });

      expect(result.ok).toBe(true);

      const { rows } = await client.query<{ unit_cost_snapshot_satang: number | null; total_cost_snapshot_satang: number | null }>(
        `select oi.unit_cost_snapshot_satang, o.total_cost_snapshot_satang
           from order_items oi join orders o on o.id = oi.order_id
          where o.order_code = $1`,
        [result.order!.order_code],
      );
      expect(rows[0].unit_cost_snapshot_satang).toBeNull(); // NOT the partial sum of just the costed ingredient
      expect(rows[0].total_cost_snapshot_satang).toBeNull();
    });
  });

  it("positive control: a fully-costed BOM produces a non-null, correctly-summed cost snapshot (proves the null cases above are real, not a function that always returns null)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, { name: "QA Fully Costed Latte", priceSatang: 6500 });
      const beans = await insertIngredient(client, { name: "QA Beans", unitCostSatang: 500 }); // satang per g
      const milk = await insertIngredient(client, { name: "QA Milk", unitCostSatang: 45 }); // satang per ml — the WBS 6.5 1kg@450THB anchor
      await insertBomLine(client, item.id, beans.id, 18); // 18g * 500 = 9000
      await insertBomLine(client, item.id, milk.id, 150); // 150ml * 45 = 6750
      // expected per-unit cost = round(9000 + 6750) = 15750

      const slot = await insertFutureSlot(client, { capacity: 3 });

      const result = await callCheckout(client, {
        storeSlug,
        cartLines: [cartLine({ menuItemId: item.id, nameSnapshot: "QA Fully Costed Latte", unitPriceSatang: 6500, quantity: 3 })],
        pickupSlotId: slot.id,
        customerName: "QA Full Cost",
      });

      expect(result.ok).toBe(true);

      const { rows } = await client.query<{ unit_cost_snapshot_satang: number | null; total_cost_snapshot_satang: number | null }>(
        `select oi.unit_cost_snapshot_satang, o.total_cost_snapshot_satang
           from order_items oi join orders o on o.id = oi.order_id
          where o.order_code = $1`,
        [result.order!.order_code],
      );
      expect(rows[0].unit_cost_snapshot_satang).toBe(15750); // per unit
      expect(rows[0].total_cost_snapshot_satang).toBe(15750 * 3); // order-level: per-unit * quantity, the engineer's own self-caught fix
    });
  });
});

describe("WBS 5.4 — checkout_create_order: rollback on a forced failure after slot reservation", () => {
  it("a failure inside the order_items insert (step 5, AFTER reserve_pickup_slot already succeeded) rolls back the entire statement, including the slot reservation", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      // A temporary BEFORE INSERT trigger, scoped to fire only on a
      // marker item_name_snapshot, installed inside this test's own
      // rolled-back transaction (transactional DDL) -- never touches the
      // production migration, and checkout_create_order gets no bespoke
      // test-only parameter. This is a REAL trigger firing on the REAL
      // order_items table during the REAL step-5 insert inside the
      // function's single implicit transaction -- proving Postgres's own
      // statement-level atomicity actually undoes the step-2 reservation
      // too, not just the failing insert.
      const forceFailItemName = "QA-5.4-FORCE-ROLLBACK-BOOM";
      await client.query(`
        create or replace function qa_5_4_force_rollback_boom() returns trigger as $$
        begin
          if new.item_name_snapshot = '${forceFailItemName}' then
            raise exception 'QA-5.4 forced failure for rollback proof';
          end if;
          return new;
        end;
        $$ language plpgsql;
      `);
      await client.query(`
        create trigger qa_5_4_force_rollback_boom_trg
        before insert on order_items
        for each row execute function qa_5_4_force_rollback_boom();
      `);

      const item = await insertMenuItem(client, { name: forceFailItemName, priceSatang: 5000 });
      const slot = await insertFutureSlot(client, { capacity: 1 });

      const { rows: before } = await client.query<{ booked_count: number }>(
        "select booked_count from pickup_slots where id = $1",
        [slot.id],
      );
      expect(before[0].booked_count).toBe(0);

      await tx.savepoint("sp_before_forced_failure");
      await expect(
        callCheckout(client, {
          storeSlug,
          cartLines: [cartLine({ menuItemId: item.id, nameSnapshot: forceFailItemName, unitPriceSatang: 5000, quantity: 1 })],
          pickupSlotId: slot.id,
          customerName: "QA Rollback Customer",
        }),
      ).rejects.toThrow(/QA-5.4 forced failure/);

      // Recover the connection from Postgres's aborted-transaction state
      // (required after any unhandled error inside an explicit
      // transaction) without touching anything the failed statement itself
      // already undid -- same recovery pattern schema.test.ts's cost-
      // snapshot-immutability test uses.
      await tx.rollbackToSavepoint("sp_before_forced_failure");

      const { rows: after } = await client.query<{ booked_count: number; is_open: boolean }>(
        "select booked_count, is_open from pickup_slots where id = $1",
        [slot.id],
      );
      expect(after[0].booked_count).toBe(0); // back to its prior value -- the reservation did NOT survive
      expect(after[0].is_open).toBe(true);

      const { rows: orderRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from orders where customer_name = $1",
        ["QA Rollback Customer"],
      );
      expect(Number(orderRows[0].n)).toBe(0); // no orphan order row either
    });
  });
});

describe("WBS 5.4 — order code generation: alphabet and collision handling at scale", () => {
  it("10,000 codes generated through the REAL generate-INSERT-catch-unique_violation-retry mechanism, against a REAL unique constraint, contain no ambiguous glyph and no collision", async () => {
    if (!dbAvailable) return;
    // Calling checkout_create_order end-to-end 10,000 times would mean
    // 10,000 full order creations (cart revalidation + slot reservation
    // against a slot with 10,000 capacity + cost-snapshot queries) --
    // correct in principle but needlessly slow for what this specific test
    // needs to prove, and it would conflate three different code paths'
    // performance into one assertion. Instead this isolates JUST the
    // generate -> INSERT -> catch unique_violation -> retry loop (0029's
    // own step 4), copied verbatim (same alphabet, same algorithm, same
    // bounded-at-20-attempts retry), and runs it against the REAL `orders`
    // table and its REAL `order_code` unique constraint (0011_orders.sql) —
    // so a collision is only avoided if the retry-on-unique_violation logic
    // genuinely works, not by luck of a 10,000-draw sample from a ~482
    // million-code space (which alone carries a ~10% natural collision
    // chance per the birthday bound, and wouldn't touch the real INSERT
    // path or the real unique constraint at all). Each of the 10,000 rows
    // really is inserted and really is checked for uniqueness by Postgres.
    if (!storeId) throw new Error("storeId fixture missing");
    const client = await connect();
    let insertedCount = 0;
    try {
      await client.query("begin");
      await client.query(`
        create or replace function qa_5_4_generate_order_codes(p_count integer, p_store_id uuid)
        returns setof text
        language plpgsql
        as $$
        declare
          v_alphabet text := '346789ABCDEFGHJKLMNPQRTUVWXY'; -- mirrors 0029_checkout_order_creation.sql's v_alphabet exactly
          v_alphabet_len integer := 28;
          v_code text;
          v_i integer;
          v_n integer;
          v_attempts integer;
        begin
          for v_n in 1..p_count loop
            v_attempts := 0;
            loop
              v_attempts := v_attempts + 1;
              v_code := '';
              for v_i in 1..6 loop
                v_code := v_code || substr(v_alphabet, (floor(random() * v_alphabet_len) + 1)::integer, 1);
              end loop;
              begin
                insert into orders (store_id, order_code, customer_name, subtotal_satang, total_satang)
                values (p_store_id, v_code, 'QA Code Collision Fixture', 0, 0);
                exit;
              exception when unique_violation then
                if v_attempts >= 20 then
                  raise exception 'qa_5_4_generate_order_codes: exhausted after % attempts', v_attempts;
                end if;
              end;
            end loop;
            return next v_code;
          end loop;
          return;
        end;
        $$;
      `);

      const { rows } = await client.query<{ qa_5_4_generate_order_codes: string }>(
        "select qa_5_4_generate_order_codes($1, $2) as qa_5_4_generate_order_codes",
        [10000, storeId],
      );
      const codes = rows.map((r) => r.qa_5_4_generate_order_codes);
      expect(codes).toHaveLength(10000);

      // Proof #1: the REAL unique constraint saw 10,000 real inserts with
      // zero collisions (if the retry logic had a bug, either an exception
      // would have propagated above, or fewer than 10,000 rows would exist).
      const { rows: countRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from orders where store_id = $1 and customer_name = 'QA Code Collision Fixture'",
        [storeId],
      );
      insertedCount = Number(countRows[0].n);
      expect(insertedCount).toBe(10000);

      // Proof #2: no ambiguous glyph anywhere in any generated code.
      for (const code of codes) {
        expect(code).toHaveLength(6);
        for (const ch of code) {
          expect(ORDER_CODE_ALPHABET).toContain(ch);
          expect(AMBIGUOUS_GLYPHS).not.toContain(ch);
        }
      }

      // Proof #3: no collision among the 10,000 codes returned (redundant
      // with the DB unique constraint above, kept as an explicit,
      // independent check of the returned values themselves).
      expect(new Set(codes).size).toBe(10000);
    } finally {
      await client.query("rollback"); // never persists the 10,000 fixture orders
      await client.end();
    }
    // Sanity: the function really did insert (and this test really did
    // clean up via ROLLBACK, not a DELETE that could be gotten wrong).
    expect(insertedCount).toBe(10000);
  }, 120_000);
});

describe("WBS 5.4 — RL-3: response body contains no cost-shaped key", () => {
  it("checkout_create_order's raw jsonb 'order' response contains none of the canonical forbidden substrings, for an order whose line DOES have a resolvable cost", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const forbiddenSubstrings = loadForbiddenSubstrings(FORBIDDEN_FIELDS_PATH);
      expect(forbiddenSubstrings.length).toBeGreaterThan(0); // sanity: the list itself isn't empty

      const item = await insertMenuItem(client, { name: "QA RL-3 Latte", priceSatang: 6500 });
      const beans = await insertIngredient(client, { name: "QA RL-3 Beans", unitCostSatang: 500 });
      await insertBomLine(client, item.id, beans.id, 18);
      const slot = await insertFutureSlot(client, { capacity: 3 });

      const result = await callCheckout(client, {
        storeSlug,
        cartLines: [cartLine({ menuItemId: item.id, nameSnapshot: "QA RL-3 Latte", unitPriceSatang: 6500, quantity: 1 })],
        pickupSlotId: slot.id,
        customerName: "QA RL-3 Customer",
      });

      expect(result.ok).toBe(true);
      const serialized = JSON.stringify(result.order);

      const hits = forbiddenSubstrings.filter((s: string) => serialized.includes(s));
      expect(hits).toEqual([]);

      // Belt-and-braces: the specific fields RL-3 exists to keep out of
      // this exact response, named explicitly so a future refactor that
      // renames a forbidden field to dodge the substring scan still fails
      // this test.
      expect(result.order).not.toHaveProperty("unit_cost_snapshot_satang");
      expect(result.order).not.toHaveProperty("total_cost_snapshot_satang");
      expect(result.order).not.toHaveProperty("cost_satang");
      expect((result.order!.items[0] as Record<string, unknown>)).not.toHaveProperty("unit_cost_satang");
    });
  });
});

describe("WBS 5.4 — additional acceptance criteria spot-checks", () => {
  it("a stale claimed price returns 409 PRICE_MISMATCH with a structured diff, and mutates nothing (no order row, slot untouched)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, { name: "QA Price Drift Latte", priceSatang: 7000 });
      const slot = await insertFutureSlot(client, { capacity: 3 });

      const result = await callCheckout(client, {
        storeSlug,
        cartLines: [cartLine({ menuItemId: item.id, nameSnapshot: "QA Price Drift Latte", unitPriceSatang: 6000, quantity: 1 })], // stale, real price is 7000
        pickupSlotId: slot.id,
        customerName: "QA Price Mismatch",
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe("PRICE_MISMATCH");
      expect(result.diffs).toEqual([
        expect.objectContaining({ kind: "price_changed", oldSatang: 6000, newSatang: 7000 }),
      ]);

      const { rows: slotRows } = await client.query<{ booked_count: number }>(
        "select booked_count from pickup_slots where id = $1",
        [slot.id],
      );
      expect(slotRows[0].booked_count).toBe(0); // never reached slot reservation

      const { rows: orderRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from orders where customer_name = 'QA Price Mismatch'",
      );
      expect(Number(orderRows[0].n)).toBe(0);
    });
  });

  it("a full slot returns 410 SLOT_FULL with a fresh open-slot list, not an error", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, { name: "QA Full Slot Latte", priceSatang: 6500 });
      const fullSlot = await insertFutureSlot(client, { capacity: 1, bookedCount: 1 });
      const openSlot = await insertFutureSlot(client, { capacity: 3, bookedCount: 0 });

      const result = await callCheckout(client, {
        storeSlug,
        cartLines: [cartLine({ menuItemId: item.id, nameSnapshot: "QA Full Slot Latte", unitPriceSatang: 6500, quantity: 1 })],
        pickupSlotId: fullSlot.id,
        customerName: "QA Slot Full",
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe("SLOT_FULL");
      const slotIds = (result.slots as Array<{ id: string }>).map((s) => s.id);
      expect(slotIds).toContain(openSlot.id);
      expect(slotIds).not.toContain(fullSlot.id);
    });
  });

  it("a pickup_slot_id belonging to a DIFFERENT store is rejected, not silently reserved", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      // The other store's own is_published/promptpay status is irrelevant
      // here -- checkout_create_order never looks this row up by slug, only
      // the pickup_slots.store_id membership check (0029's step 2) matters.
      const otherStoreResult = await client.query<{ id: string }>(
        `insert into stores (merchant_id, slug, name) values ($1, $2, 'QA Other Store') returning id`,
        [merchantId, `qa-5-4-other-store-${Date.now()}`],
      );
      // insertFutureSlot always targets the shared `storeId` fixture; build
      // this slot against the OTHER store directly instead.
      const { rows: crossSlot } = await client.query<{ id: string }>(
        `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
         values ($1, now() + interval '1 hour', now() + interval '2 hours', 3, 0, true) returning id`,
        [otherStoreResult.rows[0].id],
      );

      const item = await insertMenuItem(client, { name: "QA Cross-Store Latte", priceSatang: 6500 });

      const result = await callCheckout(client, {
        storeSlug, // the QA 5.4 Store fixture
        cartLines: [cartLine({ menuItemId: item.id, nameSnapshot: "QA Cross-Store Latte", unitPriceSatang: 6500, quantity: 1 })],
        pickupSlotId: crossSlot[0].id, // belongs to the OTHER store
        customerName: "QA Cross Store",
      });

      expect(result.ok).toBe(false);
      expect(result.code).toBe("VALIDATION_ERROR");

      const { rows: crossSlotRows } = await client.query<{ booked_count: number }>(
        "select booked_count from pickup_slots where id = $1",
        [crossSlot[0].id],
      );
      expect(crossSlotRows[0].booked_count).toBe(0); // the other store's slot was never touched
    });
  });

  it("an order is created with a name only -- phone is genuinely optional, not silently required", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const item = await insertMenuItem(client, { name: "QA Name Only Latte", priceSatang: 6500 });
      const slot = await insertFutureSlot(client, { capacity: 3 });

      const result = await callCheckout(client, {
        storeSlug,
        cartLines: [cartLine({ menuItemId: item.id, nameSnapshot: "QA Name Only Latte", unitPriceSatang: 6500, quantity: 1 })],
        pickupSlotId: slot.id,
        customerName: "QA No Phone Customer",
        customerPhone: null,
      });

      expect(result.ok).toBe(true);
      const { rows } = await client.query<{ customer_phone: string | null }>(
        "select customer_phone from orders where order_code = $1",
        [result.order!.order_code],
      );
      expect(rows[0].customer_phone).toBeNull();
    });
  });
});
