// WBS 6.7 §Testing block point 6 (Claude Code Prompt): "a merchant who never
// opens the recipe block completes the full journey -- create menu, publish,
// take an online order, take a cash sale, view the dashboard, view the P&L --
// with no prompt, badge, banner, or blocked action anywhere. Assert on the
// absence of the forbidden strings across all those screens."
//
// redline_reviewer's MEDIUM finding on WBS 6.7: every layer already has
// independent, isolated zero-BOM coverage with its own synthetic fixtures
// (packages/db/tests/schema.test.ts's "WBS 3.5 -- RL-2 zero-BOM insert and
// sale", checkout_create_order.test.ts, DashboardClient.test.tsx /
// fetchDashboardSummary.test.ts and PnlClient.test.tsx / fetchPnlDay.test.ts
// using synthetic ZERO_BOM_SUMMARY-shaped fixtures) -- but nothing chains ONE
// actual zero-BOM item through all six steps end to end, and nothing creates
// a cash sale for a zero-BOM item at all. This file is that missing chain.
//
// Real Postgres, no mocks -- same "RLS/triggers/constraints only exist in
// the database" posture as packages/db/tests/checkout_create_order.test.ts
// and payment_confirmation.test.ts. This file lives in apps/console (not
// packages/db) because two of its six steps -- fetchDashboardSummary and
// fetchPnlDay -- are apps/console-local modules; per otp-login.e2e.test.ts's
// own established convention, small local/test helpers are copied inline
// here rather than importing across the packages/db <-> apps/console test
// boundary.
//
// Setup: `supabase start` (and `supabase db reset` if the stack predates
// migration 0044 / this repo's HEAD). Run via
// `pnpm --filter @brewledger/console test` (this file is NOT named
// *.e2e.test.ts, so it runs in the default suite -- it needs a real
// Postgres + PostgREST, but no browser and no `next dev` server).
import { randomUUID, createHmac } from "node:crypto";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fetchDashboardSummary } from "../../src/app/console/(app)/fetchDashboardSummary";
import { fetchPnlDay } from "../../src/app/console/(app)/reports/pnl/fetchPnlDay";
// scripts/scan-forbidden-copy.mjs is ESM and already imported successfully
// from an apps/console test file (MenuItemEditorForm.test.tsx) -- same
// pattern reused here, per that file's own precedent that apps/console's
// tsconfig (unlike packages/db's commonjs one) has no trouble with it.
import { FORBIDDEN_PHRASES } from "../../../../scripts/scan-forbidden-copy.mjs";

// --- Local Postgres / PostgREST connection constants -----------------------
// Deliberately NOT imported from packages/db/tests/helpers/* -- that
// directory is package-internal test tooling, not a shared export, and
// otp-login.e2e.test.ts already established the convention of copying these
// few well-known local-stack constants inline rather than reaching across
// the package boundary for them.
const LOCAL_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const LOCAL_API_URL = process.env.TEST_SUPABASE_URL ?? "http://127.0.0.1:54321";
const LOCAL_ANON_KEY =
  process.env.TEST_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const LOCAL_JWT_SECRET =
  process.env.TEST_SUPABASE_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/** Mints a real HS256 JWT signed with the local GoTrue secret -- same shape
 * packages/db/tests/helpers/supabase-clients.ts's mintAuthenticatedJwt uses,
 * copied inline per this file's own boundary note above. */
function mintAuthenticatedJwt(authUserId: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "authenticated",
    role: "authenticated",
    sub: authUserId,
    iss: "supabase-demo",
    iat: nowSeconds,
    exp: nowSeconds + 60 * 60,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", LOCAL_JWT_SECRET).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}

/** A client presenting as `authenticated` with the merchant's own uid -- this
 * is the client fetchDashboardSummary/fetchPnlDay actually run under in
 * production (a merchant's own session), so RLS's own tenant boundary is
 * genuinely exercised for the dashboard/P&L reads below, not bypassed with a
 * service_role key. */
function authenticatedClient(authUserId: string): SupabaseClient {
  const jwt = mintAuthenticatedJwt(authUserId);
  return createClient(LOCAL_API_URL, LOCAL_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  return client;
}

async function isDbReachable(): Promise<boolean> {
  try {
    const client = await connect();
    await client.query("select 1");
    await client.end();
    return true;
  } catch {
    return false;
  }
}

async function isApiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_API_URL}/rest/v1/`, { headers: { apikey: LOCAL_ANON_KEY } });
    return res.status < 500 || res.status === 404;
  } catch {
    return false;
  }
}

/** Scopes `client` to present as `authUserId` for auth_store_ids()/auth.uid()
 * -- console_confirm_payment (WBS 5.6, `authenticated`-only) needs this, same
 * mechanism payment_confirmation.test.ts's own asMerchant establishes.
 * Session-level (`is_local = false` / plain `set role`, not `set local`),
 * because this file (unlike payment_confirmation.test.ts's withRollback-
 * wrapped tests) issues each step as its own separate implicit transaction
 * on one shared connection rather than one wrapping BEGIN -- a `set local`
 * would not survive past the single statement that set it. */
async function asMerchant(client: Client, authUserId: string): Promise<void> {
  await client.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: authUserId, role: "authenticated" }),
  ]);
  await client.query("set role authenticated");
}

let dbAvailable = false;
let authUserId: string;
let merchantId: string;
let storeId: string;
let storeSlug: string;

beforeAll(async () => {
  const [dbOk, apiOk] = await Promise.all([isDbReachable(), isApiReachable()]);
  dbAvailable = dbOk && apiOk;
  if (!dbAvailable) {
    console.warn(
      "\n[zeroBomJourney.test.ts] SKIPPING — no local Postgres/PostgREST reachable at " +
        `${LOCAL_DB_URL} / ${LOCAL_API_URL}. Run \`supabase start\` (and \`supabase db reset\` ` +
        "if the stack predates this repo's HEAD) first. This is a SKIP, not a pass.\n",
    );
    return;
  }

  const client = await connect();
  try {
    authUserId = randomUUID();
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
    merchantId = merchantResult.rows[0].id;

    storeSlug = `qa-6-7-journey-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    // Starts UNPUBLISHED with the verified-PromptPay shape already in place
    // (0027_promptpay_publish_guard.sql requires promptpay_verified_at before
    // is_published can ever be true) -- "publish" below is then a real,
    // separate UPDATE, not folded into the insert, matching the WBS's own
    // "create menu, publish, ..." as two distinct steps.
    const storeResult = await client.query<{ id: string }>(
      `insert into stores (
         merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity,
         promptpay_id, promptpay_type, promptpay_verified_at, is_published
       )
       values ($1, $2, 'QA 6.7 Journey Store', '07:00', '19:00', 'Asia/Bangkok', 3,
               '0891234567', 'msisdn', now(), false)
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
    // Cascades merchants -> stores -> menu_items/pickup_slots/orders/
    // order_items/payments, same cleanup convention as every other real-
    // Postgres suite in this repo.
    await client.query("delete from auth.users where id = $1", [authUserId]);
  } finally {
    await client.end();
  }
});

interface CheckoutResult {
  ok: boolean;
  code?: string;
  message?: string;
  order?: {
    id?: string;
    order_code: string;
    total_satang: number;
  };
}

async function callCheckout(
  client: Client,
  args: { cartLines: unknown[]; pickupSlotId: string; customerName: string },
): Promise<CheckoutResult> {
  const { rows } = await client.query(
    `select checkout_create_order($1, $2, $3, $4, $5) as result`,
    [storeSlug, JSON.stringify(args.cartLines), args.pickupSlotId, args.customerName, null],
  );
  return rows[0].result as CheckoutResult;
}

interface ConfirmResult {
  ok: boolean;
  already?: boolean;
  order?: { id: string; status: string };
}

async function callConfirmPayment(client: Client, orderId: string): Promise<ConfirmResult> {
  const { rows } = await client.query("select console_confirm_payment($1, $2) as result", [orderId, merchantId]);
  return rows[0].result as ConfirmResult;
}

/** Scans every string leaf of an arbitrary JSON-shaped value for the RL-2
 * forbidden nag phrases, mirroring MenuItemEditorForm.test.tsx's own
 * `expect(html).not.toContain(phrase)` loop but applied to a data object's
 * full JSON serialisation rather than rendered HTML -- this file has no
 * screens to render, only the data those screens would receive. */
function assertNoForbiddenCopy(label: string, value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const phrase of FORBIDDEN_PHRASES as string[]) {
    expect(serialized, `${label} must never contain the forbidden phrase "${phrase}"`).not.toContain(phrase);
  }
}

describe("WBS 6.7 — connected zero-BOM journey: a merchant who never opens the recipe block", () => {
  it(
    "creates a menu item with zero bom_lines, publishes, takes an online order, takes a cash sale, " +
      "views the dashboard, and views the P&L — no step throws, blocks, or renders a forbidden nag phrase",
    async () => {
      if (!dbAvailable) return;

      const setupClient = await connect();
      let menuItemId: string;
      const priceSatang = 6500;
      try {
        // --- Step 1: create menu (zero bom_lines, recipe block never opened) ---
        const itemResult = await setupClient.query<{ id: string }>(
          `insert into menu_items (store_id, name, price_satang) values ($1, $2, $3) returning id`,
          [storeId, "QA 6.7 No-Recipe Latte", priceSatang],
        );
        menuItemId = itemResult.rows[0].id;

        const { rows: bomCheck } = await setupClient.query<{ n: number }>(
          `select count(*)::int as n from bom_lines where menu_item_id = $1`,
          [menuItemId],
        );
        expect(bomCheck[0].n).toBe(0); // never opened the recipe block -- zero rows, not a placeholder row

        // --- Step 2: publish ---
        const { rows: publishRows } = await setupClient.query<{ is_published: boolean }>(
          `update stores set is_published = true where id = $1 returning is_published`,
          [storeId],
        );
        expect(publishRows[0].is_published).toBe(true);

        // A future pickup slot for the online order.
        const { rows: slotRows } = await setupClient.query<{ id: string }>(
          `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
           values ($1, now() + interval '1 hour', now() + interval '75 minutes', 3, 0, true)
           returning id`,
          [storeId],
        );
        const slotId = slotRows[0].id;

        // --- Step 3: take an online order (real checkout_create_order RPC) ---
        const checkoutResult = await callCheckout(setupClient, {
          cartLines: [
            {
              menuItemId,
              nameSnapshot: "QA 6.7 No-Recipe Latte",
              unitPriceSatang: priceSatang,
              quantity: 2,
              options: [],
            },
          ],
          pickupSlotId: slotId,
          customerName: "QA 6.7 Online Customer",
        });
        expect(checkoutResult.ok).toBe(true); // not blocked -- no recipe was ever entered for this item
        expect(checkoutResult.order).toBeDefined();
        assertNoForbiddenCopy("checkout_create_order response", checkoutResult);

        const { rows: orderIdRows } = await setupClient.query<{ id: string }>(
          `select id from orders where order_code = $1`,
          [checkoutResult.order!.order_code],
        );
        const onlineOrderId = orderIdRows[0].id;

        // Confirm payment (WBS 5.6 console_confirm_payment) -- moves the order
        // from PENDING_PAYMENT into ACCEPTED, i.e. into fetchDashboardSummary/
        // fetchPnlDay's REVENUE_STATUSES. Runs `authenticated` as the merchant.
        await asMerchant(setupClient, authUserId);
        const confirmResult = await callConfirmPayment(setupClient, onlineOrderId);
        expect(confirmResult.ok).toBe(true);
        expect(confirmResult.order?.status).toBe("ACCEPTED");
        assertNoForbiddenCopy("console_confirm_payment response", confirmResult);
        await setupClient.query("reset role");

        const { rows: onlineCostRows } = await setupClient.query<{
          unit_cost_snapshot_satang: number | null;
        }>("select unit_cost_snapshot_satang from order_items where order_id = $1", [onlineOrderId]);
        expect(onlineCostRows[0].unit_cost_snapshot_satang).toBeNull(); // RL-2: null, never 0

        // --- Step 4: take a cash sale ---
        // WBS 5.12 (Manual Cash Sale Entry) has no RPC/action in this repo yet
        // -- grepped the codebase, the only implementation-shaped hit is
        // orders.channel's own 'cash' check constraint (0011_orders.sql); see
        // packages/db/tests/ingredient_master.test.ts's own note making the
        // identical scope call for this same gap. This inserts the row a
        // cash-sale feature would produce directly, the same way schema.
        // test.ts's own "WBS 3.5 -- RL-2 zero-BOM insert and sale" test
        // simulates a sale with no order-creation RPC available -- and is
        // exactly the row shape fetchDashboardSummary/fetchPnlDay must handle
        // correctly regardless of which channel produced it (their own
        // queries never filter on channel).
        const cashOrderResult = await setupClient.query<{ id: string }>(
          `insert into orders (store_id, order_code, customer_name, channel, status, subtotal_satang, total_satang)
           values ($1, $2, 'QA 6.7 Cash Customer', 'cash', 'COLLECTED', $3, $3)
           returning id`,
          [storeId, `QA6.7CASH${Math.floor(Math.random() * 100000)}`, priceSatang],
        );
        const cashOrderId = cashOrderResult.rows[0].id;
        await setupClient.query(
          `insert into order_items (
             order_id, store_id, menu_item_id, item_name_snapshot,
             quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang
           ) values ($1, $2, $3, 'QA 6.7 No-Recipe Latte', 1, $4, NULL)`,
          [cashOrderId, storeId, menuItemId, priceSatang],
        );

        // --- Step 5: view the dashboard ---
        const supabase = authenticatedClient(authUserId);
        const summary = await fetchDashboardSummary(supabase, storeId, "Asia/Bangkok");

        const expectedRevenueSatang = priceSatang * 2 /* online */ + priceSatang /* cash */;
        expect(summary.revenueSatang).toBe(expectedRevenueSatang); // both channels counted
        expect(summary.profitSatang).toBeNull(); // RL-2: zero tracked lines -> null, never 0
        expect(summary.trackedItemCount).toBe(0);
        expect(summary.totalItemCount).toBe(2); // one online line + one cash line
        assertNoForbiddenCopy("dashboard summary", summary);

        // --- Step 6: view the P&L ---
        const pnlDay = await fetchPnlDay(supabase, storeId, "Asia/Bangkok");
        expect(pnlDay.source).toBe("live"); // today, no daily_financials row involved
        expect(pnlDay.grossRevenueSatang).toBe(expectedRevenueSatang);
        expect(pnlDay.totalCogsSatang).toBeNull(); // RL-2
        expect(pnlDay.netProfitSatang).toBeNull(); // RL-2
        expect(pnlDay.trackedItemCount).toBe(0);
        expect(pnlDay.totalItemCount).toBe(2);
        expect(pnlDay.untrackedRevenueSatang).toBe(expectedRevenueSatang); // 100% of revenue is untracked, correctly disclosed as such
        assertNoForbiddenCopy("P&L day", pnlDay);

        // The complete journey, end to end: no step above threw, returned
        // ok:false, or produced a forbidden nag phrase anywhere.
      } finally {
        await setupClient.end();
      }
    },
    30_000,
  );
});
