// WBS 3.6 QA test helper — builds real, COMMITTED merchant/store fixtures
// for the RLS adversarial suite (packages/db/tests/rls.test.ts).
//
// Why committed, not `withRollback` (see tests/helpers/db.ts): every RLS
// assertion in this suite goes through the local HTTP API (PostgREST/
// GoTrue), via @supabase/supabase-js, using the `anon` key or a minted
// `authenticated` JWT. PostgREST opens its OWN Postgres connection/
// transaction per request — under the default READ COMMITTED isolation
// level, it cannot see rows written by an still-open transaction on our
// separate `pg` connection. `withRollback`'s whole mechanism (insert, assert,
// always roll back) therefore cannot be used here: the insert would never
// become visible to the anon/authenticated HTTP client in the first place.
//
// So this file's fixtures are created with a plain (autocommit) `pg` Client
// — the same `connect()` from helpers/db.ts, which authenticates as the
// `postgres` superuser and therefore bypasses RLS for setup, exactly like
// `service_role` would — and each fixture returns an explicit `cleanup()`
// that the test's `afterEach`/`afterAll` MUST call. Deleting the fixture's
// `auth.users` row is enough: `merchants.auth_user_id` -> `auth.users(id)
// on delete cascade`, `stores.merchant_id` -> `merchants(id) on delete
// cascade`, and every store-scoped table cascades from `stores` (see
// docs/db/schema.md's table reference) — one DELETE tears down the entire
// fixture tree.
import type { Client } from "pg";

let fixtureCounter = 0;

/** Deterministic-but-unique suffix per fixture so parallel test files (or
 * repeated runs against a stack that wasn't cleanly reset) never collide on
 * `stores.slug` / `orders.order_code` / `auth.users.phone` uniqueness
 * constraints. */
function nextSuffix(label: string): string {
  fixtureCounter += 1;
  return `${label}-${Date.now()}-${fixtureCounter}`;
}

export interface FullStoreFixtureIds {
  authUserId: string;
  merchantId: string;
  storeId: string;
  storeSlug: string;
  categoryId: string;
  ingredientId: string;
  menuItemId: string;
  bomLineId: string;
  optionGroupId: string;
  optionId: string;
  pickupSlotId: string;
  orderId: string;
  orderCode: string;
  customerPhone: string;
  orderItemId: string;
  orderItemOptionId: string;
  paymentId: string;
  stockLedgerId: string;
  purchaseInvoiceId: string;
  purchaseLineItemId: string;
  jobQueueId: string;
  dailyFinancialsId: string;
  cleanup: () => Promise<void>;
}

/**
 * Inserts one merchant that owns one store with at least one row in every
 * one of the 18 real tables except `merchants` (the fixture itself is that
 * row) — i.e. all 16 merchant-owned tables (§7 test 5's loop target) plus
 * `job_queue` (§7 test 7). `isPublished` defaults to `true` so this same
 * fixture can double as an authenticated-owner fixture AND (when needed)
 * feed the anon-zero-rows test set (§7 test 2), which asserts anon sees
 * NONE of these tables regardless of publish state on the 13 tables that
 * carry no anon policy at all.
 */
export async function createFullStoreFixture(
  client: Client,
  opts: { label: string; isPublished?: boolean },
): Promise<FullStoreFixtureIds> {
  const suffix = nextSuffix(opts.label);
  const phone = `+66800${String(Math.abs(hashCode(suffix))).slice(0, 6).padStart(6, "0")}`;
  const email = `qa-rls-${suffix}@brewledger.app`;

  const { rows: userRows } = await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, phone, phone_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values (
       '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       $1, crypt('qa-test-password', gen_salt('bf')),
       now(), $2, now(),
       '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()
     ) returning id`,
    [email, phone],
  );
  const authUserId = userRows[0].id as string;

  const cleanup = async () => {
    await client.query(`delete from auth.users where id = $1`, [authUserId]);
  };

  try {
    // WBS 4.1's on_auth_user_created_provision_merchant trigger
    // (packages/db/migrations/0023_merchant_auto_provision.sql) already
    // created a merchants row for authUserId the moment auth.users was
    // inserted above (same transaction, trigger runs synchronously) — a
    // blind INSERT here now 23505s on merchants_auth_user_id_key. Upsert
    // instead (same fix shape as packages/db/seed.sql's own fix for this
    // exact regression, documented in PROGRESS.md's WBS 4.1 row).
    const { rows: merchantRows } = await client.query(
      `insert into merchants (auth_user_id, phone) values ($1, $2)
       on conflict (auth_user_id) do update set phone = excluded.phone
       returning id`,
      [authUserId, phone],
    );
    const merchantId = merchantRows[0].id as string;

    const storeSlug = `qa-rls-${suffix}`;
    const { rows: storeRows } = await client.query(
      `insert into stores (merchant_id, slug, name, is_published, promptpay_id, promptpay_type)
       values ($1, $2, $3, $4, '0899999999', 'msisdn') returning id`,
      [merchantId, storeSlug, `QA RLS Store ${suffix}`, opts.isPublished ?? true],
    );
    const storeId = storeRows[0].id as string;

    const { rows: categoryRows } = await client.query(
      `insert into menu_categories (store_id, name, sort_order) values ($1, 'Coffee', 0) returning id`,
      [storeId],
    );
    const categoryId = categoryRows[0].id as string;

    const { rows: ingredientRows } = await client.query(
      `insert into ingredients (store_id, name, base_unit, current_unit_cost_satang, current_stock_base_unit, low_stock_threshold)
       values ($1, 'Milk', 'ml', 50, 5000, 1000) returning id`,
      [storeId],
    );
    const ingredientId = ingredientRows[0].id as string;

    const { rows: menuItemRows } = await client.query(
      `insert into menu_items (store_id, category_id, name, description, price_satang, availability, sort_order)
       values ($1, $2, 'QA Latte', 'test fixture item', 6500, 'available', 0) returning id`,
      [storeId, categoryId],
    );
    const menuItemId = menuItemRows[0].id as string;

    const { rows: bomLineRows } = await client.query(
      `insert into bom_lines (store_id, menu_item_id, ingredient_id, qty_base_unit)
       values ($1, $2, $3, 150) returning id`,
      [storeId, menuItemId, ingredientId],
    );
    const bomLineId = bomLineRows[0].id as string;

    const { rows: optionGroupRows } = await client.query(
      `insert into menu_option_groups (store_id, menu_item_id, name, is_required, min_select, max_select, sort_order)
       values ($1, $2, 'Temperature', true, 1, 1, 0) returning id`,
      [storeId, menuItemId],
    );
    const optionGroupId = optionGroupRows[0].id as string;

    const { rows: optionRows } = await client.query(
      `insert into menu_options (option_group_id, name, price_delta_satang, sort_order)
       values ($1, 'Iced', 0, 0) returning id`,
      [optionGroupId],
    );
    const optionId = optionRows[0].id as string;

    const { rows: slotRows } = await client.query(
      `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
       values ($1, now() + interval '1 hour', now() + interval '1 hour 15 minutes', 3, 0, true) returning id`,
      [storeId],
    );
    const pickupSlotId = slotRows[0].id as string;

    const orderCode = `QA-${suffix}`.slice(0, 40).toUpperCase();
    const { rows: orderRows } = await client.query(
      `insert into orders (store_id, order_code, customer_name, customer_phone, pickup_slot_id, subtotal_satang, total_satang)
       values ($1, $2, 'QA Customer', $3, $4, 6500, 6500) returning id`,
      [storeId, orderCode, phone, pickupSlotId],
    );
    const orderId = orderRows[0].id as string;

    const { rows: orderItemRows } = await client.query(
      `insert into order_items (order_id, store_id, menu_item_id, item_name_snapshot, quantity, unit_price_snapshot_satang, unit_cost_snapshot_satang)
       values ($1, $2, $3, 'QA Latte', 1, 6500, 3500) returning id`,
      [orderId, storeId, menuItemId],
    );
    const orderItemId = orderItemRows[0].id as string;

    const { rows: orderItemOptionRows } = await client.query(
      `insert into order_item_options (order_item_id, menu_option_id, option_group_name_snapshot, option_name_snapshot, price_delta_snapshot_satang)
       values ($1, $2, 'Temperature', 'Iced', 0) returning id`,
      [orderItemId, optionId],
    );
    const orderItemOptionId = orderItemOptionRows[0].id as string;

    const { rows: paymentRows } = await client.query(
      `insert into payments (order_id, store_id, method, payee_alias, amount_satang, status)
       values ($1, $2, 'promptpay_direct', '0899999999', 6500, 'succeeded') returning id`,
      [orderId, storeId],
    );
    const paymentId = paymentRows[0].id as string;

    const { rows: stockLedgerRows } = await client.query(
      `insert into stock_ledger (store_id, ingredient_id, delta_base_unit, reason, order_id)
       values ($1, $2, -150, 'sale', $3) returning id`,
      [storeId, ingredientId, orderId],
    );
    const stockLedgerId = stockLedgerRows[0].id as string;

    const { rows: invoiceRows } = await client.query(
      `insert into purchase_invoices (store_id, image_path, vendor_name, invoice_date, total_satang, ocr_status, review_status)
       values ($1, 'qa/fixture-invoice.jpg', 'QA Wholesale', current_date, 25000, 'processed', 'confirmed') returning id`,
      [storeId],
    );
    const purchaseInvoiceId = invoiceRows[0].id as string;

    const { rows: lineItemRows } = await client.query(
      `insert into purchase_line_items (invoice_id, store_id, ingredient_id, raw_text, qty_base_unit, unit_cost_satang, total_satang, mapping_confidence)
       values ($1, $2, $3, 'Fresh Milk 5L', 5000, 50, 250000, 0.95) returning id`,
      [purchaseInvoiceId, storeId, ingredientId],
    );
    const purchaseLineItemId = lineItemRows[0].id as string;

    const { rows: jobQueueRows } = await client.query(
      `insert into job_queue (store_id, job_type, payload, status)
       values ($1, 'qa_fixture_job', '{"note":"rls fixture"}'::jsonb, 'pending') returning id`,
      [storeId],
    );
    const jobQueueId = jobQueueRows[0].id as string;

    const { rows: dailyFinancialsRows } = await client.query(
      `insert into daily_financials (store_id, business_date, gross_revenue_satang, total_cogs_satang, untracked_item_count, net_profit_satang, order_count)
       values ($1, current_date, 6500, 3500, 0, 3000, 1) returning id`,
      [storeId],
    );
    const dailyFinancialsId = dailyFinancialsRows[0].id as string;

    return {
      authUserId,
      merchantId,
      storeId,
      storeSlug,
      categoryId,
      ingredientId,
      menuItemId,
      bomLineId,
      optionGroupId,
      optionId,
      pickupSlotId,
      orderId,
      orderCode,
      customerPhone: phone,
      orderItemId,
      orderItemOptionId,
      paymentId,
      stockLedgerId,
      purchaseInvoiceId,
      purchaseLineItemId,
      jobQueueId,
      dailyFinancialsId,
      cleanup,
    };
  } catch (err) {
    // Best-effort cleanup if we partially inserted before a failure, so a
    // broken fixture build doesn't leave stray rows behind for later runs.
    await cleanup().catch(() => undefined);
    throw err;
  }
}

export interface VisibilityFixtureIds {
  authUserId: string;
  merchantId: string;
  publishedStoreId: string;
  publishedStoreSlug: string;
  unpublishedStoreId: string;
  unpublishedStoreSlug: string;
  visibleMenuItemId: string;
  hiddenMenuItemId: string;
  itemOnUnpublishedStoreId: string;
  optionGroupUnderVisibleItemId: string;
  optionUnderVisibleItemId: string;
  optionGroupUnderHiddenItemId: string;
  optionUnderHiddenItemId: string;
  openSlotId: string;
  fullSlotId: string;
  pastSlotId: string;
  slotOnUnpublishedStoreId: string;
  cleanup: () => Promise<void>;
}

/**
 * §7 test 3 (anon-filtered-rows) and test 4 (unpublished-store-invisible-
 * by-slug) both need a store pair (one published, one not) with a
 * visible/hidden menu item mix and a full/open/past pickup slot mix — this
 * is deliberately a different shape than `createFullStoreFixture` (which is
 * about tenant ISOLATION, not row-level anon FILTERING), so it's a separate
 * builder rather than an option flag bolted onto the first one.
 */
export async function createVisibilityFixture(
  client: Client,
): Promise<VisibilityFixtureIds> {
  const suffix = nextSuffix("vis");
  const phone = `+66801${String(Math.abs(hashCode(suffix))).slice(0, 6).padStart(6, "0")}`;
  const email = `qa-rls-vis-${suffix}@brewledger.app`;

  const { rows: userRows } = await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, phone, phone_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values (
       '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
       $1, crypt('qa-test-password', gen_salt('bf')),
       now(), $2, now(),
       '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()
     ) returning id`,
    [email, phone],
  );
  const authUserId = userRows[0].id as string;
  const cleanup = async () => {
    await client.query(`delete from auth.users where id = $1`, [authUserId]);
  };

  try {
    // Same WBS 4.1 trigger note as createFullStoreFixture above — upsert,
    // not a blind insert, or this 23505s against the trigger's own row.
    const { rows: merchantRows } = await client.query(
      `insert into merchants (auth_user_id, phone) values ($1, $2)
       on conflict (auth_user_id) do update set phone = excluded.phone
       returning id`,
      [authUserId, phone],
    );
    const merchantId = merchantRows[0].id as string;

    const publishedStoreSlug = `qa-rls-vis-pub-${suffix}`;
    const { rows: pubStoreRows } = await client.query(
      `insert into stores (merchant_id, slug, name, is_published) values ($1, $2, 'QA Visibility Published', true) returning id`,
      [merchantId, publishedStoreSlug],
    );
    const publishedStoreId = pubStoreRows[0].id as string;

    const unpublishedStoreSlug = `qa-rls-vis-unpub-${suffix}`;
    const { rows: unpubStoreRows } = await client.query(
      `insert into stores (merchant_id, slug, name, is_published) values ($1, $2, 'QA Visibility Unpublished', false) returning id`,
      [merchantId, unpublishedStoreSlug],
    );
    const unpublishedStoreId = unpubStoreRows[0].id as string;

    const { rows: visibleItemRows } = await client.query(
      `insert into menu_items (store_id, name, price_satang, availability) values ($1, 'QA Visible Item', 5000, 'available') returning id`,
      [publishedStoreId],
    );
    const visibleMenuItemId = visibleItemRows[0].id as string;

    const { rows: hiddenItemRows } = await client.query(
      `insert into menu_items (store_id, name, price_satang, availability) values ($1, 'QA Hidden Item', 5000, 'hidden') returning id`,
      [publishedStoreId],
    );
    const hiddenMenuItemId = hiddenItemRows[0].id as string;

    const { rows: unpubItemRows } = await client.query(
      `insert into menu_items (store_id, name, price_satang, availability) values ($1, 'QA Item On Unpublished Store', 5000, 'available') returning id`,
      [unpublishedStoreId],
    );
    const itemOnUnpublishedStoreId = unpubItemRows[0].id as string;

    const { rows: visGroupRows } = await client.query(
      `insert into menu_option_groups (store_id, menu_item_id, name) values ($1, $2, 'Temperature') returning id`,
      [publishedStoreId, visibleMenuItemId],
    );
    const optionGroupUnderVisibleItemId = visGroupRows[0].id as string;

    const { rows: visOptionRows } = await client.query(
      `insert into menu_options (option_group_id, name) values ($1, 'Iced') returning id`,
      [optionGroupUnderVisibleItemId],
    );
    const optionUnderVisibleItemId = visOptionRows[0].id as string;

    const { rows: hiddenGroupRows } = await client.query(
      `insert into menu_option_groups (store_id, menu_item_id, name) values ($1, $2, 'Temperature') returning id`,
      [publishedStoreId, hiddenMenuItemId],
    );
    const optionGroupUnderHiddenItemId = hiddenGroupRows[0].id as string;

    const { rows: hiddenOptionRows } = await client.query(
      `insert into menu_options (option_group_id, name) values ($1, 'Iced') returning id`,
      [optionGroupUnderHiddenItemId],
    );
    const optionUnderHiddenItemId = hiddenOptionRows[0].id as string;

    const { rows: openSlotRows } = await client.query(
      `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
       values ($1, now() + interval '1 hour', now() + interval '1 hour 15 minutes', 3, 1, true) returning id`,
      [publishedStoreId],
    );
    const openSlotId = openSlotRows[0].id as string;

    // The full-slot-absent test: booked_count = capacity. Must be ABSENT
    // from the anon result set, not present-but-flagged.
    const { rows: fullSlotRows } = await client.query(
      `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
       values ($1, now() + interval '2 hour', now() + interval '2 hour 15 minutes', 2, 2, true) returning id`,
      [publishedStoreId],
    );
    const fullSlotId = fullSlotRows[0].id as string;

    // A slot in the past — must also be absent (slot_start > now() predicate).
    const { rows: pastSlotRows } = await client.query(
      `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
       values ($1, now() - interval '2 hour', now() - interval '1 hour 45 minutes', 3, 0, true) returning id`,
      [publishedStoreId],
    );
    const pastSlotId = pastSlotRows[0].id as string;

    const { rows: unpubSlotRows } = await client.query(
      `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
       values ($1, now() + interval '1 hour', now() + interval '1 hour 15 minutes', 3, 0, true) returning id`,
      [unpublishedStoreId],
    );
    const slotOnUnpublishedStoreId = unpubSlotRows[0].id as string;

    return {
      authUserId,
      merchantId,
      publishedStoreId,
      publishedStoreSlug,
      unpublishedStoreId,
      unpublishedStoreSlug,
      visibleMenuItemId,
      hiddenMenuItemId,
      itemOnUnpublishedStoreId,
      optionGroupUnderVisibleItemId,
      optionUnderVisibleItemId,
      optionGroupUnderHiddenItemId,
      optionUnderHiddenItemId,
      openSlotId,
      fullSlotId,
      pastSlotId,
      slotOnUnpublishedStoreId,
      cleanup,
    };
  } catch (err) {
    await cleanup().catch(() => undefined);
    throw err;
  }
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
