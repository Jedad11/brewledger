// WBS 5.9 — Order Status Update (Merchant Actions), Testing note item 4:
// "if there's a reasonable way to test propagation timing... check whether
// an existing E2E/integration harness could cover 'merchant advances
// status -> customer page reflects it within 5s'".
//
// Full browser-to-browser E2E (drive apps/console in one Playwright page,
// apps/shop's /o/[code] in another, assert the poll picks up a change) is
// NOT written here. WBS 5.10's own apps/shop/src/app/o/[code]/page.tsx
// polls fetchOrderStatus() every 5s and deliberately does NOT use Realtime
// (that file's own header comment: `orders` carries zero anon SELECT
// policies, so postgres_changes has nothing to subscribe to — the 5s poll
// IS the reliable path, not a fallback). Given that, "status changes appear
// within 5 seconds" decomposes into two independently-provable claims:
//   (a) the data layer has zero propagation delay of its own — the instant
//       console_advance_order commits, the public RPC anon reads reflects
//       the new status. This is what THIS file proves.
//   (b) the browser actually polls every 5s and repaints on a changed
//       value — proven by /o/[code]'s own component-level tests (not this
//       file's concern) plus, for the full two-browser click-and-observe
//       flow, WBS 8.2's own E2E Journey A. Journey A needs the full
//       customer order flow (cart -> slot reservation -> PromptPay QR ->
///      payment confirmation -> ACCEPTED) to produce a trackable order in
//       the first place, via WBS 8.1's fixture factory — neither of which
//       exists yet in this repo (packages/db/tests has no reusable
//       "place a real paid order" helper; each existing suite hand-inserts
//       orders at whatever status it needs, as this file does below).
//       Writing a second, narrower version of that same fixture here to
//       drive two real Next.js dev servers would duplicate WBS 8.2's own
//       deliverable rather than add new coverage — flagged as an explicit
//       scope note for the orchestrator, not silently skipped.
//
// Mechanism: same "PostgREST is a separate connection, don't use
// withRollback" discipline as order_tracking.test.ts (its own header
// comment explains why) — plain autocommit `pg` writes for setup/mutation,
// a real HTTP round trip through the local Supabase API for both the
// merchant's call (authenticatedClient, mirroring what console-advance-
// order's Edge Function does server-to-server) and the customer's read
// (anonClient, exactly what apps/shop's fetchOrderStatus does).
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, isReachable } from "./helpers/db";
import { anonClient, authenticatedClient, isApiReachable } from "./helpers/supabase-clients";

let ready = false;
let pg: Client;
let authUserId: string;
let storeId: string;

beforeAll(async () => {
  const dbUp = await isReachable();
  const apiUp = dbUp && (await isApiReachable());
  ready = dbUp && apiUp;
  if (!ready) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[order_status_propagation.test.ts] SKIPPING — local Postgres and/or " +
        "the local Supabase HTTP API is not reachable. Run `supabase start` " +
        "first. This is a SKIP, not a pass.\n",
    );
    return;
  }

  pg = await connect();

  authUserId = randomUUID();
  const phone = `+66904${Math.floor(Math.random() * 900000 + 100000)}`;
  await pg.query(
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
  // ON CONFLICT, not a bare INSERT: 0023_merchant_auto_provision.sql's own
  // AFTER INSERT trigger on auth.users already creates a merchants row for
  // this authUserId the instant the insert above commits — found by
  // actually running this file, not by inspection (a bare insert 23505'd
  // on merchants_auth_user_id_key every time). Same recovery this
  // directory's other fixtures already use (console_advance_order.test.ts's
  // own createMerchantFixture, order_tracking.test.ts's own
  // createStoreFixture).
  const { rows: merchantRows } = await pg.query<{ id: string }>(
    `insert into merchants (id, auth_user_id, phone, subscription_tier)
     values (gen_random_uuid(), $1, $2, 'free')
     on conflict (auth_user_id) do update set phone = excluded.phone
     returning id`,
    [authUserId, phone],
  );
  const { rows: storeRows } = await pg.query<{ id: string }>(
    `insert into stores (merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity)
     values ($1, $2, $3, '07:00', '19:00', 'Asia/Bangkok', 3) returning id`,
    [merchantRows[0].id, `qa-5-9-propagation-${Date.now()}`, "QA 5.9 Propagation Store"],
  );
  storeId = storeRows[0].id;
});

afterAll(async () => {
  if (!ready) return;
  await pg.query("delete from auth.users where id = $1", [authUserId]);
  await pg.end();
});

async function insertAcceptedOrder(): Promise<{ id: string; orderCode: string }> {
  const orderCode = `QP${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`;
  const { rows } = await pg.query<{ id: string }>(
    `insert into orders (
       store_id, order_code, customer_name, status,
       subtotal_satang, total_satang, paid_at, payment_confirmed_by, payment_confirmed_at
     ) values ($1, $2, 'QA Propagation Customer', 'ACCEPTED', 6000, 6000, now(), $3, now())
     returning id`,
    [storeId, orderCode, authUserId],
  );
  await pg.query(
    `insert into order_items (order_id, store_id, item_name_snapshot, quantity, unit_price_snapshot_satang)
     values ($1, $2, 'QA Latte', 1, 6000)`,
    [rows[0].id, storeId],
  );
  return { id: rows[0].id, orderCode };
}

describe("WBS 5.9 — status propagation: console_advance_order's write is immediately visible through the customer's own public_order_status read", () => {
  it("REQUIRED: the instant the merchant's PREPARING hop commits, an anon public_order_status(order_code) call — the exact call apps/shop's /o/[code] poll makes — returns PREPARING, with no propagation delay of its own", async () => {
    if (!ready) return;
    const order = await insertAcceptedOrder();

    // Baseline: before the merchant does anything, the customer-facing RPC
    // already reports the real current status (ACCEPTED) — establishes
    // the read path works at all before proving it tracks a CHANGE.
    const before = await anonClient().rpc("public_order_status", { p_order_code: order.orderCode });
    expect(before.error).toBeNull();
    expect(before.data?.[0]?.status).toBe("ACCEPTED");

    // The merchant's real call path: console_advance_order over a real
    // authenticated HTTP round trip (same call shape console-advance-
    // order's Edge Function makes via ctx.supabase.rpc(...)), not a raw SQL
    // UPDATE — so this proves the ACTUAL production write path, not just
    // that a bare UPDATE is visible.
    const merchant = authenticatedClient(authUserId);
    const advance = await merchant.rpc("console_advance_order", { p_order_id: order.id, p_to: "PREPARING" });
    expect(advance.error).toBeNull();
    expect((advance.data as { ok: boolean }).ok).toBe(true);

    // No sleep, no retry loop — a genuine propagation delay at the data
    // layer (e.g. an uncommitted transaction, a stale read replica, a
    // caching layer) would make THIS immediate read fail intermittently.
    // It doesn't, because there is none: console_advance_order commits in
    // the same request, and PostgREST/public_order_status read the same
    // primary.
    const after = await anonClient().rpc("public_order_status", { p_order_code: order.orderCode });
    expect(after.error).toBeNull();
    expect(after.data?.[0]?.status).toBe("PREPARING");
  });

  it("the same holds for READY and COLLECTED, each hop's write immediately visible to the next anon read", async () => {
    if (!ready) return;
    const order = await insertAcceptedOrder();
    const merchant = authenticatedClient(authUserId);

    await merchant.rpc("console_advance_order", { p_order_id: order.id, p_to: "PREPARING" });
    const ready1 = await anonClient().rpc("public_order_status", { p_order_code: order.orderCode });
    expect(ready1.data?.[0]?.status).toBe("PREPARING");

    await merchant.rpc("console_advance_order", { p_order_id: order.id, p_to: "READY" });
    const ready2 = await anonClient().rpc("public_order_status", { p_order_code: order.orderCode });
    expect(ready2.data?.[0]?.status).toBe("READY");

    await merchant.rpc("console_advance_order", { p_order_id: order.id, p_to: "COLLECTED" });
    const ready3 = await anonClient().rpc("public_order_status", { p_order_code: order.orderCode });
    expect(ready3.data?.[0]?.status).toBe("COLLECTED");
  });
});
