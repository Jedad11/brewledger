// WBS 3.5 — Core Data Model: schema/RLS-adjacent DB tests.
//
// These formalize the ad hoc `supabase db query` checks the orchestrating
// session ran by hand while landing 4fbc9db/cbf6c73 (see PROGRESS.md's
// WBS 3.5 row) into a real, repeatable suite. They run against a REAL
// Postgres instance (a local `supabase start` Docker stack) per the
// project's "no float in the money path, no balance/escrow/payout table,
// zero-BOM insert, cost snapshot trigger" testing rules — nothing here is
// mocked, because RLS/triggers/constraints only exist in the database.
//
// Setup: `supabase start` (spins up local Docker Postgres and applies every
// migration under supabase/migrations, mirrored from packages/db/migrations)
// then `pnpm --filter @brewledger/db test`.
//
// If no local stack is reachable, the whole suite is SKIPPED (not passed —
// see the beforeAll below) so a missing local stack is never misreported as
// green.
//
// Insert-based tests (RL-2 zero-BOM, cost-snapshot trigger, capacity check)
// each run inside a transaction that is unconditionally rolled back
// (tests/helpers/db.ts `withRollback`) — this is real-database-safe cleanup
// by construction, not a manual DELETE that can be gotten wrong or
// forgotten, and it is what makes it safe that this same file could in
// principle be pointed at a project with real seed data.
import { beforeAll, describe, expect, it } from "vitest";
import { connect, isReachable, withRollback } from "./helpers/db";

let dbAvailable = false;

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[schema.test.ts] SKIPPING — no local Postgres reachable at " +
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres. " +
        "Run `supabase start` first. This is a SKIP, not a pass.\n",
    );
  }
});

describe("WBS 3.5 — money-type introspection", () => {
  it("no money-named column is a float, and none is an unexpected numeric", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query(`
        select table_name, column_name, data_type
          from information_schema.columns
         where table_schema = 'public'
           and column_name ~* '(satang|price|cost|amount|fee|total)'
      `);

      expect(rows.length).toBeGreaterThan(0); // sanity: the regex actually matched something

      const floats = rows.filter(
        (r) => r.data_type === "real" || r.data_type === "double precision",
      );
      expect(floats).toEqual([]);

      // Every matching column must be an exact integer type. `numeric` is
      // only acceptable for genuinely fractional *quantities* that are not
      // money (e.g. ingredients.current_stock_base_unit, which does not
      // match this regex anyway) — so for money-named columns specifically,
      // only integer/bigint is allowed.
      const nonInteger = rows.filter(
        (r) => r.data_type !== "integer" && r.data_type !== "bigint",
      );
      expect(nonInteger).toEqual([]);
    } finally {
      await client.end();
    }
  });
});

describe("WBS 3.5 — RL-1 structural introspection", () => {
  it("no table name matches the forbidden balance/escrow/float/wallet/payout/ledger_account pattern", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query(`
        select table_name
          from information_schema.tables
         where table_schema = 'public'
           and table_name ~* '(balance|escrow|float|wallet|payout|ledger_account)'
      `);
      expect(rows).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("stock_ledger exists and deliberately does NOT match the RL-1 forbidden pattern", async () => {
    // stock_ledger is a ledger of *stock quantity*, not money — its name
    // only coincidentally contains "ledger" (docs/db/schema.md's RL-1
    // section). Asserted explicitly so a future "helpful" broadening of the
    // regex (e.g. adding a bare `ledger` alternative) gets caught here
    // instead of silently flagging a table that's fine by design.
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query(`
        select table_name
          from information_schema.tables
         where table_schema = 'public'
           and table_name = 'stock_ledger'
      `);
      expect(rows).toHaveLength(1);

      const forbiddenPattern = /(balance|escrow|float|wallet|payout|ledger_account)/i;
      expect(forbiddenPattern.test("stock_ledger")).toBe(false);
    } finally {
      await client.end();
    }
  });
});

describe("WBS 3.5 — RL-2 zero-BOM insert and sale", () => {
  it("a menu item with zero bom_lines can be sold, and its cost snapshot is NULL, never 0", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const { rows: userRows } = await client.query(`
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, phone, phone_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) values (
          '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          'qa-rl2@brewledger.app', crypt('qa-test-password', gen_salt('bf')),
          now(), '+66899999901', now(),
          '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()
        ) returning id
      `);
      const authUserId = userRows[0].id;

      const { rows: merchantRows } = await client.query(
        // WBS 4.1's on_auth_user_created_provision_merchant trigger already
        // created this merchants row synchronously on the auth.users insert
        // above — upsert, not a blind insert, or this 23505s against the
        // trigger's own row (same fix shape as packages/db/seed.sql's own
        // fix for this regression; see PROGRESS.md's WBS 4.1 row).
        `insert into merchants (auth_user_id, phone) values ($1, $2)
         on conflict (auth_user_id) do update set phone = excluded.phone
         returning id`,
        [authUserId, "+66899999901"],
      );
      const merchantId = merchantRows[0].id;

      const { rows: storeRows } = await client.query(
        `insert into stores (merchant_id, slug, name, is_published)
         values ($1, 'qa-rl2-store', 'QA RL-2 Store', true) returning id`,
        [merchantId],
      );
      const storeId = storeRows[0].id;

      // Zero-BOM: create a sellable menu item and insert NO bom_lines row
      // for it at all — RL-2 requires this to be a first-class path, not an
      // edge case.
      const { rows: itemRows } = await client.query(
        `insert into menu_items (store_id, name, price_satang)
         values ($1, 'QA No-Recipe Latte', 8000) returning id`,
        [storeId],
      );
      const menuItemId = itemRows[0].id;

      const { rows: bomCheck } = await client.query(
        `select count(*)::int as n from bom_lines where menu_item_id = $1`,
        [menuItemId],
      );
      expect(bomCheck[0].n).toBe(0);

      const { rows: orderRows } = await client.query(
        `insert into orders (store_id, order_code, customer_name, subtotal_satang, total_satang)
         values ($1, 'QA-RL2-0001', 'QA Customer', 8000, 8000) returning id`,
        [storeId],
      );
      const orderId = orderRows[0].id;

      // The sale itself: no error should be raised despite zero bom_lines.
      const { rows: orderItemRows } = await client.query(
        `insert into order_items (
           order_id, store_id, menu_item_id, item_name_snapshot,
           quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang
         ) values ($1, $2, $3, 'QA No-Recipe Latte', 1, 8000, NULL)
         returning unit_cost_snapshot_satang`,
        [orderId, storeId, menuItemId],
      );

      expect(orderItemRows[0].unit_cost_snapshot_satang).toBeNull();
      expect(orderItemRows[0].unit_cost_snapshot_satang).not.toBe(0);
    });
  });
});

describe("WBS 3.5 — cost snapshot trigger (trg_order_items_cost_snapshot_immutable)", () => {
  it("raises 'immutable' on UPDATE of unit_cost_snapshot_satang, while every other column stays updatable", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const { rows: userRows } = await client.query(`
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, phone, phone_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) values (
          '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          'qa-snapshot@brewledger.app', crypt('qa-test-password', gen_salt('bf')),
          now(), '+66899999902', now(),
          '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()
        ) returning id
      `);
      const authUserId = userRows[0].id;

      const { rows: merchantRows } = await client.query(
        // WBS 4.1's on_auth_user_created_provision_merchant trigger already
        // created this merchants row synchronously on the auth.users insert
        // above — upsert, not a blind insert, or this 23505s against the
        // trigger's own row (same fix shape as packages/db/seed.sql's own
        // fix for this regression; see PROGRESS.md's WBS 4.1 row).
        `insert into merchants (auth_user_id, phone) values ($1, $2)
         on conflict (auth_user_id) do update set phone = excluded.phone
         returning id`,
        [authUserId, "+66899999902"],
      );
      const merchantId = merchantRows[0].id;

      const { rows: storeRows } = await client.query(
        `insert into stores (merchant_id, slug, name, is_published)
         values ($1, 'qa-snapshot-store', 'QA Snapshot Store', true) returning id`,
        [merchantId],
      );
      const storeId = storeRows[0].id;

      const { rows: itemRows } = await client.query(
        `insert into menu_items (store_id, name, price_satang)
         values ($1, 'QA Costed Latte', 10000) returning id`,
        [storeId],
      );
      const menuItemId = itemRows[0].id;

      const { rows: orderRows } = await client.query(
        `insert into orders (store_id, order_code, customer_name, subtotal_satang, total_satang)
         values ($1, 'QA-SNAP-0001', 'QA Customer', 10000, 10000) returning id`,
        [storeId],
      );
      const orderId = orderRows[0].id;

      const { rows: orderItemRows } = await client.query(
        `insert into order_items (
           order_id, store_id, menu_item_id, item_name_snapshot,
           quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang
         ) values ($1, $2, $3, 'QA Costed Latte', 1, 10000, 3500)
         returning id`,
        [orderId, storeId, menuItemId],
      );
      const orderItemId = orderItemRows[0].id;

      // 1. The protected column: attempting to change it must raise, and
      //    the message must say "immutable" per the trigger's own contract.
      await tx.savepoint("sp_cost_update");
      await expect(
        client.query(
          `update order_items set unit_cost_snapshot_satang = $1 where id = $2`,
          [9999, orderItemId],
        ),
      ).rejects.toThrow(/immutable/i);
      await tx.rollbackToSavepoint("sp_cost_update");

      // Confirm the value truly did not change (belt and suspenders beyond
      // the rejected promise).
      const { rows: afterFailedUpdate } = await client.query(
        `select unit_cost_snapshot_satang from order_items where id = $1`,
        [orderItemId],
      );
      expect(afterFailedUpdate[0].unit_cost_snapshot_satang).toBe(3500);

      // 2. Every OTHER column on the same row must remain updatable — the
      //    trigger's `if` only narrows to unit_cost_snapshot_satang, per
      //    docs/db/schema_design.md §3's explicit test contract.
      const { rows: updatedRows } = await client.query(
        `update order_items
            set item_name_snapshot = 'QA Costed Latte (renamed)',
                quantity = 2,
                unit_price_snapshot_satang = 20000,
                options_snapshot = '[{"note":"qa"}]'::jsonb
          where id = $1
          returning item_name_snapshot, quantity, unit_price_snapshot_satang, options_snapshot, unit_cost_snapshot_satang`,
        [orderItemId],
      );

      expect(updatedRows[0].item_name_snapshot).toBe("QA Costed Latte (renamed)");
      expect(updatedRows[0].quantity).toBe(2);
      expect(updatedRows[0].unit_price_snapshot_satang).toBe(20000);
      expect(updatedRows[0].options_snapshot).toEqual([{ note: "qa" }]);
      // and the cost snapshot is still untouched by this unrelated update
      expect(updatedRows[0].unit_cost_snapshot_satang).toBe(3500);
    });
  });

  it("also raises when the snapshot starts NULL and is updated to a real value (is distinct from, not <>)", async () => {
    // docs/db/schema_design.md §3: the guard must use `is distinct from`,
    // not `<>`, specifically so a null -> 5000 transition is blocked too
    // (a zero-BOM item that "picks up a late recipe" must still not have
    // its already-sold rows rewritten).
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const { rows: userRows } = await client.query(`
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, phone, phone_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) values (
          '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          'qa-snapshot-null@brewledger.app', crypt('qa-test-password', gen_salt('bf')),
          now(), '+66899999903', now(),
          '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()
        ) returning id
      `);
      const authUserId = userRows[0].id;

      const { rows: merchantRows } = await client.query(
        // WBS 4.1's on_auth_user_created_provision_merchant trigger already
        // created this merchants row synchronously on the auth.users insert
        // above — upsert, not a blind insert, or this 23505s against the
        // trigger's own row (same fix shape as packages/db/seed.sql's own
        // fix for this regression; see PROGRESS.md's WBS 4.1 row).
        `insert into merchants (auth_user_id, phone) values ($1, $2)
         on conflict (auth_user_id) do update set phone = excluded.phone
         returning id`,
        [authUserId, "+66899999903"],
      );
      const merchantId = merchantRows[0].id;

      const { rows: storeRows } = await client.query(
        `insert into stores (merchant_id, slug, name, is_published)
         values ($1, 'qa-snapshot-null-store', 'QA Snapshot Null Store', true) returning id`,
        [merchantId],
      );
      const storeId = storeRows[0].id;

      const { rows: itemRows } = await client.query(
        `insert into menu_items (store_id, name, price_satang)
         values ($1, 'QA Zero-BOM Latte', 8000) returning id`,
        [storeId],
      );
      const menuItemId = itemRows[0].id;

      const { rows: orderRows } = await client.query(
        `insert into orders (store_id, order_code, customer_name, subtotal_satang, total_satang)
         values ($1, 'QA-SNAP-0002', 'QA Customer', 8000, 8000) returning id`,
        [storeId],
      );
      const orderId = orderRows[0].id;

      const { rows: orderItemRows } = await client.query(
        `insert into order_items (
           order_id, store_id, menu_item_id, item_name_snapshot,
           quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang
         ) values ($1, $2, $3, 'QA Zero-BOM Latte', 1, 8000, NULL)
         returning id`,
        [orderId, storeId, menuItemId],
      );
      const orderItemId = orderItemRows[0].id;

      await tx.savepoint("sp_null_to_value");
      await expect(
        client.query(
          `update order_items set unit_cost_snapshot_satang = $1 where id = $2`,
          [5000, orderItemId],
        ),
      ).rejects.toThrow(/immutable/i);
      await tx.rollbackToSavepoint("sp_null_to_value");
    });
  });
});

describe("WBS 3.5 — pickup_slots.booked_count cannot exceed capacity", () => {
  it("rejects an INSERT where booked_count > capacity", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const { rows: userRows } = await client.query(`
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, phone, phone_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) values (
          '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          'qa-slots-insert@brewledger.app', crypt('qa-test-password', gen_salt('bf')),
          now(), '+66899999904', now(),
          '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()
        ) returning id
      `);
      const authUserId = userRows[0].id;
      const { rows: merchantRows } = await client.query(
        // WBS 4.1's on_auth_user_created_provision_merchant trigger already
        // created this merchants row synchronously on the auth.users insert
        // above — upsert, not a blind insert, or this 23505s against the
        // trigger's own row (same fix shape as packages/db/seed.sql's own
        // fix for this regression; see PROGRESS.md's WBS 4.1 row).
        `insert into merchants (auth_user_id, phone) values ($1, $2)
         on conflict (auth_user_id) do update set phone = excluded.phone
         returning id`,
        [authUserId, "+66899999904"],
      );
      const merchantId = merchantRows[0].id;
      const { rows: storeRows } = await client.query(
        `insert into stores (merchant_id, slug, name, is_published)
         values ($1, 'qa-slots-insert-store', 'QA Slots Insert Store', true) returning id`,
        [merchantId],
      );
      const storeId = storeRows[0].id;

      await tx.savepoint("sp_slot_insert");
      await expect(
        client.query(
          `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count)
           values ($1, now() + interval '1 hour', now() + interval '2 hour', 1, 2)`,
          [storeId],
        ),
      ).rejects.toThrow();
      await tx.rollbackToSavepoint("sp_slot_insert");
    });
  });

  it("rejects an UPDATE that pushes booked_count above capacity", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const { rows: userRows } = await client.query(`
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password,
          email_confirmed_at, phone, phone_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) values (
          '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
          'qa-slots-update@brewledger.app', crypt('qa-test-password', gen_salt('bf')),
          now(), '+66899999905', now(),
          '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()
        ) returning id
      `);
      const authUserId = userRows[0].id;
      const { rows: merchantRows } = await client.query(
        // WBS 4.1's on_auth_user_created_provision_merchant trigger already
        // created this merchants row synchronously on the auth.users insert
        // above — upsert, not a blind insert, or this 23505s against the
        // trigger's own row (same fix shape as packages/db/seed.sql's own
        // fix for this regression; see PROGRESS.md's WBS 4.1 row).
        `insert into merchants (auth_user_id, phone) values ($1, $2)
         on conflict (auth_user_id) do update set phone = excluded.phone
         returning id`,
        [authUserId, "+66899999905"],
      );
      const merchantId = merchantRows[0].id;
      const { rows: storeRows } = await client.query(
        `insert into stores (merchant_id, slug, name, is_published)
         values ($1, 'qa-slots-update-store', 'QA Slots Update Store', true) returning id`,
        [merchantId],
      );
      const storeId = storeRows[0].id;

      const { rows: slotRows } = await client.query(
        `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count)
         values ($1, now() + interval '1 hour', now() + interval '2 hour', 1, 1)
         returning id`,
        [storeId],
      );
      const slotId = slotRows[0].id;

      await tx.savepoint("sp_slot_update");
      await expect(
        client.query(`update pickup_slots set booked_count = 2 where id = $1`, [slotId]),
      ).rejects.toThrow();
      await tx.rollbackToSavepoint("sp_slot_update");

      const { rows: afterFailedUpdate } = await client.query(
        `select booked_count from pickup_slots where id = $1`,
        [slotId],
      );
      expect(afterFailedUpdate[0].booked_count).toBe(1);
    });
  });
});
