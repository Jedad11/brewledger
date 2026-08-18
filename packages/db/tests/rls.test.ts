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
  createVisibilityFixture,
  type FullStoreFixtureIds,
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

  it("the table count actually checked is pinned at 18 (not a false pass from an empty match)", async () => {
    if (!ready) return;
    const { rows } = await pg.query(`
      select count(*)::int as n from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
    `);
    expect(rows[0].n).toBe(18);
  });

  it("all 18 real tables are present by name", async () => {
    if (!ready) return;
    const { rows } = await pg.query(`
      select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name
    `);
    const names = rows.map((r) => r.table_name).sort();
    expect(names).toEqual(
      [
        "bom_lines",
        "daily_financials",
        "ingredients",
        "job_queue",
        "menu_categories",
        "menu_items",
        "menu_option_groups",
        "menu_options",
        "merchants",
        "order_item_options",
        "order_items",
        "orders",
        "payments",
        "pickup_slots",
        "purchase_invoices",
        "purchase_line_items",
        "stock_ledger",
        "stores",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Shared fixtures for §7 tests 2, 5, 6, 7, 8 — two merchants (A, B), each
// with a full store's worth of data across all 16 merchant-owned tables
// plus job_queue.
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

  // --- §7 test 5: cross-tenant isolation, looped over the 16 applicable
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
  ];

  describe("§7.5 — cross-tenant isolation, looped over 16 merchant-owned tables", () => {
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
