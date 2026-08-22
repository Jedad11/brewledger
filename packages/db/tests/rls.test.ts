// WBS 3.6 — Row Level Security adversarial suite.
//
// Full contract: docs/db/rls_design.md §7. This file implements all 8 test
// categories verbatim from that spec — it does not reinterpret it. Every
// data-bearing assertion here goes through a REAL local Supabase HTTP API
// (PostgREST + the `anon`/`authenticated`/`service_role` keys), not a
// mocked client — RLS only exists in the database, and the whole point of
// this suite is to prove the migration (packages/db/migrations/0021_rls.sql)
// actually closes what it claims to close.
//
// Setup: `supabase start` (local Docker Postgres + API), then
// `supabase db reset` to guarantee 0021_rls.sql has actually been applied
// (a stack restored from an older cached snapshot can silently predate it —
// see the fixture/cleanup note below and the report-back notes on this).
// Then `pnpm --filter @brewledger/db test`.
//
// If no local stack (DB or API) is reachable, the whole suite is SKIPPED
// (not passed) — see beforeAll below.
//
// Why fixtures are COMMITTED, not `withRollback`-wrapped: every assertion
// here goes through PostgREST, which opens its own Postgres connection per
// request. Under READ COMMITTED isolation, a still-open transaction on our
// separate `pg` connection (what `withRollback` would use) is invisible to
// that request. So fixtures in this file are inserted with a plain
// (autocommit) `pg` Client — see tests/helpers/rls-fixture.ts's own header
// comment for the full reasoning — and every fixture's `cleanup()` is
// called in `afterAll`/`afterEach`, deleting the fixture's `auth.users` row
// (which cascades the whole tree: merchants -> stores -> everything
// store-scoped, per docs/db/schema.md's table reference).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connect, isReachable } from "./helpers/db";
import {
  anonClient,
  authenticatedClient,
  isApiReachable,
  serviceClient,
} from "./helpers/supabase-clients";
import {
  createFullStoreFixture,
  createMerchantOnlyFixture,
  createVisibilityFixture,
  type FullStoreFixtureIds,
  type MerchantOnlyFixtureIds,
  type VisibilityFixtureIds,
} from "./helpers/rls-fixture";

let ready = false;
let pg: Client;

beforeAll(async () => {
  const dbUp = await isReachable();
  const apiUp = dbUp && (await isApiReachable());
  ready = dbUp && apiUp;
  if (!ready) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[rls.test.ts] SKIPPING — local Postgres and/or the local Supabase " +
        "HTTP API is not reachable. Run `supabase start` (and, if the stack " +
        "was restored from an older cached snapshot, `supabase db reset`) " +
        "first. This is a SKIP, not a pass.\n",
    );
    return;
  }
  pg = await connect();
});

afterAll(async () => {
  if (pg) await pg.end();
});

// ---------------------------------------------------------------------------
// §7 test 1 — introspection: every table has RLS enabled, table count pinned
// ---------------------------------------------------------------------------
describe("§7.1 — RLS introspection", () => {
  it("zero tables in public schema have relrowsecurity = false", async () => {
    if (!ready) return;
    const { rows } = await pg.query(`
      select relname from pg_class
       where relnamespace = 'public'::regnamespace
         and relkind = 'r'
         and relrowsecurity = false
    `);
    expect(rows).toEqual([]);
  });

  it("the table count actually checked is pinned at 23 (not a false pass from an empty match)", async () => {
    // Was 18 as of WBS 3.6; WBS 4.1's migration 0024_auth_attempts.sql added
    // a 19th table (auth_attempts, RLS enabled, zero policies — same shape
    // as job_queue). WBS 5.7's migration 0032_order_status_history.sql adds
    // a 20th (order_status_history, RLS enabled, one authenticated SELECT
    // policy — see §7 below). A 21st, order_lookup_attempts
    // (0036_order_lookup_rate_limit.sql), landed without this pin being
    // updated at the time — caught and fixed here, not by that migration's
    // own change, while adding the 22nd: WBS 5.8's push_subscriptions
    // (0038_push_subscriptions_and_inbox_state.sql, RLS enabled, one
    // authenticated policy scoped by store_id — same shape as every other
    // direct-store_id table). WBS 6.6's migration
    // 0045_ingredient_cost_history.sql adds the 23rd (ingredient_cost_history,
    // RLS enabled, one authenticated SELECT policy scoped by store_id — same
    // shape). Updated here rather than left stale, per this file's own
    // stated purpose: proving the migration actually closes what it claims,
    // against the real as-built schema.
    if (!ready) return;
    const { rows } = await pg.query(`
      select count(*)::int as n from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
    `);
    expect(rows[0].n).toBe(23);
  });

  it("all 23 real tables are present by name", async () => {
    if (!ready) return;
    const { rows } = await pg.query(`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name
    `);
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual(
      [
        "auth_attempts",
        "bom_lines",
        "daily_financials",
        "ingredient_cost_history",
        "ingredients",
        "job_queue",
        "menu_categories",
        "menu_items",
        "menu_option_groups",
        "menu_options",
        "merchants",
        "order_item_options",
        "order_items",
        "order_lookup_attempts",
        "order_status_history",
        "orders",
        "payments",
        "pickup_slots",
        "purchase_invoices",
        "purchase_line_items",
        "push_subscriptions",
        "stock_ledger",
        "stores",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Shared fixtures for §7 tests 2, 5, 6, 7, 8 — two merchants (A, B), each
// with a full store's worth of data across all 17 merchant-owned tables
// (including push_subscriptions, WBS 5.8) plus job_queue.
// ---------------------------------------------------------------------------
describe("§7.2, §7.5, §7.6, §7.7, §7.8 — merchant-scoped suite", () => {
  let fixtureA: FullStoreFixtureIds;
  let fixtureB: FullStoreFixtureIds;

  beforeAll(async () => {
    if (!ready) return;
    fixtureA = await createFullStoreFixture(pg, { label: "a" });
    fixtureB = await createFullStoreFixture(pg, { label: "b" });
  });

  afterAll(async () => {
    if (!ready) return;
    await fixtureA?.cleanup();
    await fixtureB?.cleanup();
  });

  // --- §7 test 2: anon-zero-rows on 13 tables, each cross-checked against
  //     service_role so a zero-row result can't be mistaken for an empty
  //     table. ---
  const ANON_ZERO_ROW_TABLES = [
    "ingredients",
    "bom_lines",
    "purchase_invoices",
    "purchase_line_items",
    "stock_ledger",
    "daily_financials",
    "payments",
    "job_queue",
    "merchants",
    "orders",
    "order_items",
    "order_item_options",
    "menu_categories",
  ] as const;

  describe("§7.2 — anon sees zero rows on the 13 fully-closed tables", () => {
    for (const table of ANON_ZERO_ROW_TABLES) {
      it(`anon: ${table} returns zero rows, while service_role proves rows exist`, async () => {
        if (!ready) return;
        const anon = anonClient();
        const { data: asAnon } = await anon.from(table).select("*");
        expect((asAnon ?? []).length).toBe(0);

        const svc = serviceClient();
        const { data: asAdmin, error: adminError } = await svc.from(table).select("*").limit(1000);
        expect(adminError).toBeNull();
        expect((asAdmin ?? []).length).toBeGreaterThan(0);
      });
    }
  });

  // --- §7 test 5: cross-tenant isolation, looped over the 17 applicable
  //     merchant-owned tables. ---
  const MERCHANT_TABLES: Array<{ table: string; idKey: keyof FullStoreFixtureIds }> = [
    { table: "stores", idKey: "storeId" },
    { table: "menu_categories", idKey: "categoryId" },
    { table: "menu_items", idKey: "menuItemId" },
    { table: "menu_option_groups", idKey: "optionGroupId" },
    { table: "menu_options", idKey: "optionId" },
    { table: "ingredients", idKey: "ingredientId" },
    { table: "bom_lines", idKey: "bomLineId" },
    { table: "pickup_slots", idKey: "pickupSlotId" },
    { table: "orders", idKey: "orderId" },
    { table: "order_items", idKey: "orderItemId" },
    { table: "order_item_options", idKey: "orderItemOptionId" },
    { table: "payments", idKey: "paymentId" },
    { table: "stock_ledger", idKey: "stockLedgerId" },
    { table: "purchase_invoices", idKey: "purchaseInvoiceId" },
    { table: "purchase_line_items", idKey: "purchaseLineItemId" },
    { table: "daily_financials", idKey: "dailyFinancialsId" },
    { table: "push_subscriptions", idKey: "pushSubscriptionId" },
  ];

  describe("§7.5 — cross-tenant isolation, looped over 17 merchant-owned tables", () => {
    for (const { table, idKey } of MERCHANT_TABLES) {
      it(`merchant A sees only store A's row in ${table}, merchant B only store B's`, async () => {
        if (!ready) return;
        const idA = fixtureA[idKey] as string;
        const idB = fixtureB[idKey] as string;

        const clientA = authenticatedClient(fixtureA.authUserId);
        const { data: dataA, error: errorA } = await clientA.from(table).select("id");
        expect(errorA).toBeNull();
        const idsSeenByA = (dataA ?? []).map((r: { id: string }) => r.id);
        expect(idsSeenByA).toContain(idA);
        expect(idsSeenByA).not.toContain(idB);

        const clientB = authenticatedClient(fixtureB.authUserId);
        const { data: dataB, error: errorB } = await clientB.from(table).select("id");
        expect(errorB).toBeNull();
        const idsSeenByB = (dataB ?? []).map((r: { id: string }) => r.id);
        expect(idsSeenByB).toContain(idB);
        expect(idsSeenByB).not.toContain(idA);

        // Cross-check against service_role so this isn't passing because the
        // table happens to be otherwise empty.
        const svc = serviceClient();
        const { data: bothViaAdmin, error: adminError } = await svc
          .from(table)
          .select("id")
          .in("id", [idA, idB]);
        expect(adminError).toBeNull();
        expect((bothViaAdmin ?? []).length).toBe(2);
      });
    }
  });

  // --- §7 test 6: merchants self-scoping ---
  describe("§7.6 — merchants self-scoping", () => {
    it("merchant A sees only their own merchants row", async () => {
      if (!ready) return;
      const clientA = authenticatedClient(fixtureA.authUserId);
      const { data, error } = await clientA.from("merchants").select("id");
      expect(error).toBeNull();
      const ids = (data ?? []).map((r: { id: string }) => r.id);
      expect(ids).toEqual([fixtureA.merchantId]);
      expect(ids).not.toContain(fixtureB.merchantId);
    });

    it("merchant B sees only their own merchants row", async () => {
      if (!ready) return;
      const clientB = authenticatedClient(fixtureB.authUserId);
      const { data, error } = await clientB.from("merchants").select("id");
      expect(error).toBeNull();
      const ids = (data ?? []).map((r: { id: string }) => r.id);
      expect(ids).toEqual([fixtureB.merchantId]);
      expect(ids).not.toContain(fixtureA.merchantId);
    });
  });

  // --- §7 test 7: job_queue — no access via anon OR authenticated ---
  describe("§7.7 — job_queue has no access via anon or authenticated", () => {
    it("anon sees zero job_queue rows, service_role proves store A's job exists", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data } = await anon.from("job_queue").select("*");
      expect((data ?? []).length).toBe(0);

      const svc = serviceClient();
      const { data: adminData, error } = await svc.from("job_queue").select("id").eq("id", fixtureA.jobQueueId);
      expect(error).toBeNull();
      expect(adminData).toHaveLength(1);
    });

    it("merchant A (who owns the store-scoped job) also sees zero job_queue rows", async () => {
      if (!ready) return;
      const clientA = authenticatedClient(fixtureA.authUserId);
      const { data } = await clientA.from("job_queue").select("*");
      expect((data ?? []).length).toBe(0);
    });
  });

  // --- extra, WBS 4.1: auth_attempts — added after this file was first
  //     written (§7 was written against 3.6's then-18-table schema).
  //     Same zero-policy shape as job_queue (packages/db/migrations/
  //     0024_auth_attempts.sql's own header comment: "RLS enabled, ZERO
  //     policies. Only service_role ... may touch this table"). Covered
  //     here rather than left silently untested — this is a rate-limit
  //     table, and RL-3 adversarial coverage is exactly the point of this
  //     file. ---
  describe("auth_attempts (WBS 4.1) has no access via anon or authenticated, same zero-policy shape as job_queue", () => {
    let insertedId: string | undefined;

    beforeAll(async () => {
      if (!ready) return;
      const { rows } = await pg.query(
        `insert into auth_attempts (phone_hash, ip_hash) values ($1, $2) returning id`,
        [`qa-rls-phone-hash-${Date.now()}`, `qa-rls-ip-hash-${Date.now()}`],
      );
      insertedId = rows[0].id as string;
    });

    afterAll(async () => {
      if (!ready || !insertedId) return;
      await pg.query(`delete from auth_attempts where id = $1`, [insertedId]);
    });

    it("anon sees zero auth_attempts rows, service_role proves the row exists", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data } = await anon.from("auth_attempts").select("*");
      expect((data ?? []).length).toBe(0);

      const svc = serviceClient();
      const { data: adminData, error } = await svc
        .from("auth_attempts")
        .select("id")
        .eq("id", insertedId);
      expect(error).toBeNull();
      expect(adminData).toHaveLength(1);
    });

    it("an authenticated merchant also sees zero auth_attempts rows (no merchant-scoped policy exists, by design)", async () => {
      if (!ready) return;
      const clientA = authenticatedClient(fixtureA.authUserId);
      const { data } = await clientA.from("auth_attempts").select("*");
      expect((data ?? []).length).toBe(0);
    });
  });

  // --- extra, WBS 5.10: order_lookup_attempts — same zero-policy shape as
  //     auth_attempts/job_queue (packages/db/migrations/
  //     0036_order_lookup_rate_limit.sql's own header comment: "Same shape
  //     as job_queue/auth_attempts: RLS enabled, ZERO policies. Only
  //     service_role ... may touch this table"). This is the rate-limit
  //     bucket for /track's phone+code lookup — covered here for the same
  //     reason auth_attempts is, not left to the table-name/count checks
  //     above alone.
  //
  //     Updated for 0039_order_lookup_phone_bucket.sql (redline_reviewer
  //     finding, 2026-08-22: ip_hash alone was a no-op against a scripted
  //     caller rotating x-forwarded-for). The table gained a `phone_hash`
  //     column and `ip_hash` is no longer NOT NULL; 0039 does not touch RLS
  //     (no table already RLS'd with zero policies needs new policies just
  //     because a column was added), so the assertion here is that the
  //     zero-policy posture holds for the WHOLE row shape, phone_hash
  //     included — not just the columns that existed when this block was
  //     first written. ---
  describe("order_lookup_attempts (WBS 5.10, phone_hash bucket added by 0039) has no access via anon or authenticated, same zero-policy shape as auth_attempts", () => {
    let insertedId: string | undefined;

    beforeAll(async () => {
      if (!ready) return;
      const { rows } = await pg.query(
        `insert into order_lookup_attempts (phone_hash, ip_hash) values ($1, $2) returning id`,
        [`qa-rls-order-lookup-phone-hash-${Date.now()}`, `qa-rls-order-lookup-ip-hash-${Date.now()}`],
      );
      insertedId = rows[0].id as string;
    });

    afterAll(async () => {
      if (!ready || !insertedId) return;
      await pg.query(`delete from order_lookup_attempts where id = $1`, [insertedId]);
    });

    it("anon sees zero order_lookup_attempts rows via select * (which now includes phone_hash); service_role proves the row — with BOTH phone_hash and ip_hash populated — exists", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data } = await anon.from("order_lookup_attempts").select("*");
      expect((data ?? []).length).toBe(0);

      const svc = serviceClient();
      const { data: adminData, error } = await svc
        .from("order_lookup_attempts")
        .select("id, phone_hash, ip_hash")
        .eq("id", insertedId);
      expect(error).toBeNull();
      expect(adminData).toHaveLength(1);
      expect(adminData![0].phone_hash).toMatch(/^qa-rls-order-lookup-phone-hash-/);
      expect(adminData![0].ip_hash).toMatch(/^qa-rls-order-lookup-ip-hash-/);
    });

    it("anon selecting the phone_hash column by name (not just select *) also returns zero rows — the new column specifically has no anon-readable policy", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.from("order_lookup_attempts").select("phone_hash").eq("id", insertedId);
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(0);
    });

    it("an authenticated merchant also sees zero order_lookup_attempts rows, phone_hash included (no merchant-scoped policy exists, by design)", async () => {
      if (!ready) return;
      const clientA = authenticatedClient(fixtureA.authUserId);
      const { data } = await clientA.from("order_lookup_attempts").select("*");
      expect((data ?? []).length).toBe(0);
    });

    it("anon cannot directly INSERT into order_lookup_attempts via the ip_hash column (writes only happen via the SECURITY DEFINER function)", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon
        .from("order_lookup_attempts")
        .insert({ ip_hash: `qa-rls-anon-insert-ip-${Date.now()}` })
        .select("id");
      expect(data ?? []).toHaveLength(0);
      expect(error).not.toBeNull();
    });

    it("anon cannot directly INSERT into order_lookup_attempts via the new phone_hash column either (ip_hash's own NOT NULL constraint dropping doesn't open a side door)", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon
        .from("order_lookup_attempts")
        .insert({ phone_hash: `qa-rls-anon-insert-phone-${Date.now()}` })
        .select("id");
      expect(data ?? []).toHaveLength(0);
      expect(error).not.toBeNull();
    });
  });

  // --- §7 test 8: RPC signature and behavior ---
  describe("§7.8 — public_order_status / public_order_lookup RPC contract", () => {
    it("public_order_status returns exactly {order_code, status, pickup_at, item_name, quantity}, no forbidden field", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.rpc("public_order_status", {
        p_order_code: fixtureA.orderCode,
      });
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);

      const forbidden = /cost|margin|profit|fee|expense|stock/i;
      for (const row of data ?? []) {
        const keys = Object.keys(row).sort();
        expect(keys).toEqual(["item_name", "order_code", "pickup_at", "quantity", "status"]);
        for (const key of keys) {
          expect(forbidden.test(key)).toBe(false);
        }
      }
    });

    it("public_order_lookup: correct phone + correct code returns the order", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.rpc("public_order_lookup", {
        p_phone: fixtureA.customerPhone,
        p_order_code: fixtureA.orderCode,
      });
      expect(error).toBeNull();
      expect((data ?? []).length).toBeGreaterThan(0);
    });

    it("public_order_lookup: correct phone + WRONG code returns zero rows", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.rpc("public_order_lookup", {
        p_phone: fixtureA.customerPhone,
        p_order_code: "NOT-A-REAL-CODE",
      });
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(0);
    });

    it("public_order_lookup: WRONG phone + correct code returns zero rows (phone can't be paired with a guessed code)", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.rpc("public_order_lookup", {
        p_phone: "+66800000000",
        p_order_code: fixtureA.orderCode,
      });
      expect(error).toBeNull();
      expect((data ?? []).length).toBe(0);
    });

    it("the RPCs work while direct table access stays closed: anon select on orders/order_items for the same order is still empty", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data: ordersData } = await anon.from("orders").select("*").eq("order_code", fixtureA.orderCode);
      expect((ordersData ?? []).length).toBe(0);

      const { data: itemsData } = await anon.from("order_items").select("*").eq("id", fixtureA.orderItemId);
      expect((itemsData ?? []).length).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// WBS 4.3 hotfix regression — packages/db/migrations/0026_stores_insert_
// bootstrap_fix.sql. merchant_rw_stores previously routed EVERY command
// (including INSERT's WITH CHECK) through auth_store_ids(), which queries
// stores itself -- so a brand-new row's WITH CHECK could never be satisfied
// before the row existed, and no merchant could ever create their first
// store ("new row violates row-level security policy for table \"stores\"").
// The fix: stores' own policy now checks `merchant_id in (select
// auth_merchant_id())` directly (auth_merchant_id() only reads `merchants`,
// never `stores`, so it has no bootstrap problem), and auth_store_ids()
// (used by every OTHER merchant-owned table) is untouched.
//
// Every INSERT/UPDATE/DELETE assertion below goes through a REAL
// authenticatedClient() -- never the pg-superuser fixture bypass -- because
// that bypass is exactly the blind spot that let the original bug ship
// undetected (every other test file, and this file's own fixtures until
// now, built `stores` rows through the superuser `pg` client in setup, so
// nothing ever actually exercised this INSERT policy end-to-end).
// ---------------------------------------------------------------------------
describe("WBS 4.3 — stores INSERT bootstrap fix (migration 0026)", () => {
  let freshMerchant: MerchantOnlyFixtureIds;
  let merchantA: MerchantOnlyFixtureIds;
  let merchantB: MerchantOnlyFixtureIds;

  beforeAll(async () => {
    if (!ready) return;
    freshMerchant = await createMerchantOnlyFixture(pg, { label: "bootstrap-fresh" });
    merchantA = await createMerchantOnlyFixture(pg, { label: "bootstrap-a" });
    merchantB = await createMerchantOnlyFixture(pg, { label: "bootstrap-b" });
  });

  afterAll(async () => {
    if (!ready) return;
    // Deleting each fixture's auth.users row cascades merchants -> stores,
    // so every stores row any test below created gets torn down here too --
    // no manual store cleanup needed (see rls-fixture.ts's header comment).
    await freshMerchant?.cleanup();
    await merchantA?.cleanup();
    await merchantB?.cleanup();
  });

  it("a freshly-provisioned merchant (zero stores) can INSERT a stores row naming their own merchant_id, and immediately SELECT it back", async () => {
    if (!ready) return;
    const client = authenticatedClient(freshMerchant.authUserId);

    // Sanity: confirm the "zero stores" precondition via service_role before
    // asserting anything about the insert that's about to happen.
    const svc = serviceClient();
    const { data: before } = await svc.from("stores").select("id").eq("merchant_id", freshMerchant.merchantId);
    expect((before ?? []).length).toBe(0);

    const slug = `qa-bootstrap-fresh-${Date.now()}`;
    const { data, error } = await client
      .from("stores")
      .insert({ merchant_id: freshMerchant.merchantId, slug, name: "Bootstrap Fresh Store" })
      .select("id, merchant_id, slug")
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.merchant_id).toBe(freshMerchant.merchantId);
    expect(data!.slug).toBe(slug);

    const { data: selectBack, error: selectErr } = await client
      .from("stores")
      .select("id, slug")
      .eq("id", data!.id);
    expect(selectErr).toBeNull();
    expect(selectBack).toHaveLength(1);
    expect(selectBack![0].slug).toBe(slug);
  });

  it("a merchant CANNOT INSERT a stores row naming a DIFFERENT merchant's merchant_id — rejected, never silently substituted (forbidden-payee-style)", async () => {
    if (!ready) return;
    const clientA = authenticatedClient(merchantA.authUserId);
    const slug = `qa-bootstrap-forbidden-${Date.now()}`;

    const { data, error } = await clientA
      .from("stores")
      .insert({ merchant_id: merchantB.merchantId, slug, name: "Should never exist" })
      .select("id")
      .single();

    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501"); // RLS WITH CHECK violation

    // Prove via service_role that no row with this slug exists under ANY
    // merchant_id at all -- not merchant B's forbidden target, and not
    // merchant A's own id either (i.e. Postgres didn't silently substitute
    // the caller's own merchant_id in place of the forbidden one).
    const svc = serviceClient();
    const { data: svcCheck, error: svcErr } = await svc.from("stores").select("id, merchant_id").eq("slug", slug);
    expect(svcErr).toBeNull();
    expect(svcCheck ?? []).toHaveLength(0);
  });

  it(
    "a merchant who already owns one store CAN INSERT a second one naming their own merchant_id — " +
      "this is INTENTIONAL current behavior, not a leftover bug: stores carries no DB-level cardinality " +
      "constraint, MVP's 'one store per merchant' is a product/UX invariant enforced at the application " +
      "layer (apps/console), and the schema is deliberately multi-branch-ready for Phase 2. Do not 'fix' " +
      "this later with a naive unique constraint on merchant_id without revisiting that documented design.",
    async () => {
      if (!ready) return;
      const clientA = authenticatedClient(merchantA.authUserId);

      const slug1 = `qa-bootstrap-a1-${Date.now()}`;
      const first = await clientA
        .from("stores")
        .insert({ merchant_id: merchantA.merchantId, slug: slug1, name: "Bootstrap Store A1" })
        .select("id, merchant_id")
        .single();
      expect(first.error).toBeNull();
      expect(first.data!.merchant_id).toBe(merchantA.merchantId);

      const slug2 = `qa-bootstrap-a2-${Date.now()}`;
      const second = await clientA
        .from("stores")
        .insert({ merchant_id: merchantA.merchantId, slug: slug2, name: "Bootstrap Store A2" })
        .select("id, merchant_id")
        .single();
      expect(second.error).toBeNull();
      expect(second.data).not.toBeNull();
      expect(second.data!.merchant_id).toBe(merchantA.merchantId);
      expect(second.data!.id).not.toBe(first.data!.id);

      const svc = serviceClient();
      const { data: allForA } = await svc.from("stores").select("id").eq("merchant_id", merchantA.merchantId);
      expect((allForA ?? []).length).toBeGreaterThanOrEqual(2);
    },
  );

  describe("regression — cross-tenant UPDATE/SELECT/DELETE on stores after the merchant_rw_stores policy rebuild", () => {
    let storeA: string;
    let storeB: string;

    beforeAll(async () => {
      if (!ready) return;
      const clientA = authenticatedClient(merchantA.authUserId);
      const clientB = authenticatedClient(merchantB.authUserId);

      const a = await clientA
        .from("stores")
        .insert({ merchant_id: merchantA.merchantId, slug: `qa-bootstrap-reg-a-${Date.now()}`, name: "Regression Store A" })
        .select("id")
        .single();
      storeA = a.data!.id as string;

      const b = await clientB
        .from("stores")
        .insert({ merchant_id: merchantB.merchantId, slug: `qa-bootstrap-reg-b-${Date.now()}`, name: "Regression Store B" })
        .select("id")
        .single();
      storeB = b.data!.id as string;
    });

    it("merchant A can SELECT their own store but not merchant B's", async () => {
      if (!ready) return;
      const clientA = authenticatedClient(merchantA.authUserId);
      const { data, error } = await clientA.from("stores").select("id").in("id", [storeA, storeB]);
      expect(error).toBeNull();
      const ids = (data ?? []).map((r: { id: string }) => r.id);
      expect(ids).toContain(storeA);
      expect(ids).not.toContain(storeB);
    });

    it("merchant A can UPDATE their own store", async () => {
      if (!ready) return;
      const clientA = authenticatedClient(merchantA.authUserId);
      const { data, error } = await clientA
        .from("stores")
        .update({ name: "Regression Store A (renamed)" })
        .eq("id", storeA)
        .select("id, name");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].name).toBe("Regression Store A (renamed)");
    });

    it("merchant A's UPDATE of merchant B's store affects zero rows and does not change it", async () => {
      if (!ready) return;
      const clientA = authenticatedClient(merchantA.authUserId);
      const { data, error } = await clientA
        .from("stores")
        .update({ name: "hijacked" })
        .eq("id", storeB)
        .select("id, name");
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      const svc = serviceClient();
      const { data: svcRow } = await svc.from("stores").select("name").eq("id", storeB).single();
      expect(svcRow!.name).toBe("Regression Store B");
    });

    it("merchant A's DELETE of merchant B's store affects zero rows; the row still exists (proven via service_role)", async () => {
      if (!ready) return;
      const clientA = authenticatedClient(merchantA.authUserId);
      const { data, error } = await clientA.from("stores").delete().eq("id", storeB).select("id");
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      const svc = serviceClient();
      const { data: svcRow, error: svcErr } = await svc.from("stores").select("id").eq("id", storeB);
      expect(svcErr).toBeNull();
      expect(svcRow).toHaveLength(1); // still exists -- proves the delete above was a genuine no-op, not an empty table
    });

    it("merchant A can DELETE their own store (own-row DELETE still works after the policy rebuild)", async () => {
      if (!ready) return;
      const clientA = authenticatedClient(merchantA.authUserId);
      // A disposable third store, so this doesn't remove storeA out from
      // under any test above that may still rely on it.
      const throwaway = await clientA
        .from("stores")
        .insert({ merchant_id: merchantA.merchantId, slug: `qa-bootstrap-throwaway-${Date.now()}`, name: "Throwaway" })
        .select("id")
        .single();
      expect(throwaway.error).toBeNull();

      const { data, error } = await clientA.from("stores").delete().eq("id", throwaway.data!.id).select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(1);

      const svc = serviceClient();
      const { data: svcRow } = await svc.from("stores").select("id").eq("id", throwaway.data!.id);
      expect(svcRow ?? []).toHaveLength(0);
    });
  });

  describe("regression — anon still cannot write stores, and publish-state visibility is unaffected", () => {
    let ownedStoreId: string;

    beforeAll(async () => {
      if (!ready) return;
      const clientA = authenticatedClient(merchantA.authUserId);
      const created = await clientA
        .from("stores")
        // is_published defaults to false (0003_stores.sql) -- left
        // unspecified deliberately so this row starts unpublished.
        .insert({ merchant_id: merchantA.merchantId, slug: `qa-bootstrap-anonreg-${Date.now()}`, name: "Anon Regression Store" })
        .select("id")
        .single();
      ownedStoreId = created.data!.id as string;
    });

    it("anon cannot INSERT a stores row, even naming a real merchant_id", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon
        .from("stores")
        .insert({ merchant_id: merchantA.merchantId, slug: `qa-bootstrap-anon-insert-${Date.now()}`, name: "Anon insert" })
        .select("id")
        .single();
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    });

    it("anon's UPDATE of an existing store affects zero rows and does not change it", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.from("stores").update({ name: "hacked" }).eq("id", ownedStoreId).select("id");
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      const svc = serviceClient();
      const { data: svcRow } = await svc.from("stores").select("name").eq("id", ownedStoreId).single();
      expect(svcRow!.name).toBe("Anon Regression Store");
    });

    it("anon's DELETE of an existing store affects zero rows; the row still exists", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.from("stores").delete().eq("id", ownedStoreId).select("id");
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      const svc = serviceClient();
      const { data: svcRow } = await svc.from("stores").select("id").eq("id", ownedStoreId);
      expect(svcRow).toHaveLength(1);
    });

    it("the unpublished store is still invisible to anon by SELECT", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.from("stores").select("id").eq("id", ownedStoreId);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    });

    it("once the owning merchant publishes it, anon CAN see it (own-write path plus anon_read_published_stores both intact)", async () => {
      if (!ready) return;
      const clientA = authenticatedClient(merchantA.authUserId);
      // Migration 0027's guard_promptpay_before_publish trigger forces
      // is_published back to false whenever it would otherwise stand
      // published with promptpay_verified_at IS NULL (RL-1's DB-level
      // publish gate) -- this fixture's row was created with neither set
      // (see beforeAll above), so a bare `is_published: true` update would
      // now be silently coerced back to false, defeating this test's own
      // premise before it ever reaches the anon-visibility assertion below.
      // Set a verified PromptPay identifier in the same statement, matching
      // what a real publish flow (saveStoreProfile, only reachable once
      // /console/settings/payments has a verified identifier) always has in
      // place by the time it publishes.
      const { error: publishErr } = await clientA
        .from("stores")
        .update({
          is_published: true,
          promptpay_id: "0899999999",
          promptpay_type: "msisdn",
          promptpay_verified_at: new Date().toISOString(),
        })
        .eq("id", ownedStoreId);
      expect(publishErr).toBeNull();

      const anon = anonClient();
      const { data, error } = await anon.from("stores").select("id, is_published").eq("id", ownedStoreId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data![0].is_published).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// §7 test 3 & 4 — anon-filtered-rows on the 5 anon-visible tables, and
// unpublished-store-invisible-by-exact-slug.
// ---------------------------------------------------------------------------
describe("§7.3, §7.4 — anon-filtered-rows and unpublished-store-by-slug", () => {
  let fixture: VisibilityFixtureIds;

  beforeAll(async () => {
    if (!ready) return;
    fixture = await createVisibilityFixture(pg);
  });

  afterAll(async () => {
    if (!ready) return;
    await fixture?.cleanup();
  });

  describe("§7.3 — stores: anon sees only is_published = true", () => {
    it("published store is visible, unpublished store is absent", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon
        .from("stores")
        .select("id")
        .in("id", [fixture.publishedStoreId, fixture.unpublishedStoreId]);
      expect(error).toBeNull();
      const ids = (data ?? []).map((r: { id: string }) => r.id);
      expect(ids).toContain(fixture.publishedStoreId);
      expect(ids).not.toContain(fixture.unpublishedStoreId);

      const svc = serviceClient();
      const { data: adminData } = await svc
        .from("stores")
        .select("id")
        .in("id", [fixture.publishedStoreId, fixture.unpublishedStoreId]);
      expect((adminData ?? []).length).toBe(2); // both genuinely exist
    });
  });

  describe("§7.3 — menu_items: anon sees only availability <> 'hidden' on a published store", () => {
    it("visible item is present; hidden item and the unpublished-store item are both absent", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon
        .from("menu_items")
        .select("id")
        .in("id", [
          fixture.visibleMenuItemId,
          fixture.hiddenMenuItemId,
          fixture.itemOnUnpublishedStoreId,
        ]);
      expect(error).toBeNull();
      const ids = (data ?? []).map((r: { id: string }) => r.id);
      expect(ids).toContain(fixture.visibleMenuItemId);
      expect(ids).not.toContain(fixture.hiddenMenuItemId);
      expect(ids).not.toContain(fixture.itemOnUnpublishedStoreId);
    });
  });

  describe("§7.3 — menu_option_groups / menu_options: anon sees only groups/options under a visible item", () => {
    it("option group and option under the VISIBLE item are present", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data: groups, error: groupsError } = await anon
        .from("menu_option_groups")
        .select("id")
        .eq("id", fixture.optionGroupUnderVisibleItemId);
      expect(groupsError).toBeNull();
      expect(groups).toHaveLength(1);

      const { data: options, error: optionsError } = await anon
        .from("menu_options")
        .select("id")
        .eq("id", fixture.optionUnderVisibleItemId);
      expect(optionsError).toBeNull();
      expect(options).toHaveLength(1);
    });

    it("option group and option under the HIDDEN item are absent", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data: groups, error: groupsError } = await anon
        .from("menu_option_groups")
        .select("id")
        .eq("id", fixture.optionGroupUnderHiddenItemId);
      expect(groupsError).toBeNull();
      expect(groups).toHaveLength(0);

      const { data: options, error: optionsError } = await anon
        .from("menu_options")
        .select("id")
        .eq("id", fixture.optionUnderHiddenItemId);
      expect(optionsError).toBeNull();
      expect(options).toHaveLength(0);
    });
  });

  describe("§7.3 — pickup_slots: anon sees only open, not-full, future slots of a published store", () => {
    it("the open future slot is present", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.from("pickup_slots").select("id").eq("id", fixture.openSlotId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("a full slot (booked_count = capacity) is ABSENT, not present-but-flagged", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.from("pickup_slots").select("id").eq("id", fixture.fullSlotId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);

      const svc = serviceClient();
      const { data: adminData } = await svc.from("pickup_slots").select("booked_count, capacity").eq("id", fixture.fullSlotId);
      expect(adminData).toHaveLength(1);
      expect(adminData?.[0].booked_count).toBe(adminData?.[0].capacity); // fixture built correctly
    });

    it("a past slot is absent", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.from("pickup_slots").select("id").eq("id", fixture.pastSlotId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("a slot on an unpublished store is absent", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.from("pickup_slots").select("id").eq("id", fixture.slotOnUnpublishedStoreId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });
  });

  describe("§7.4 — unpublished store is invisible even by its exact slug", () => {
    it("querying stores by the unpublished store's exact known slug returns zero rows", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.from("stores").select("*").eq("slug", fixture.unpublishedStoreSlug);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("sanity: the same query for the PUBLISHED store's slug does return a row", async () => {
      if (!ready) return;
      const anon = anonClient();
      const { data, error } = await anon.from("stores").select("*").eq("slug", fixture.publishedStoreSlug);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });
  });
});
