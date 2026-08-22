// WBS 6.4 -- Purchase Confirmation Screen (Manual), engineer leg's own test
// coverage of console_confirm_purchase_invoice (packages/db/migrations/
// 0043_console_confirm_purchase_invoice.sql, mirrored to supabase/migrations/).
// Same real-Postgres posture as console_advance_order.test.ts (RLS, security
// definer grants, and atomicity only exist in the database -- a mock proves
// nothing about them) and the identical asMerchant/resetRole/withRollback
// mechanism, copied from that file's own established pattern rather than
// re-abstracted, matching this directory's existing convention.
//
// Covers exactly the four cases the WBS 6.4 prompt's own "Tests" section
// lists, in order:
//   1. Submitting from 6.1 (a purchase_invoices row with lines parked in
//      raw_ocr_output) leaves ingredients.current_unit_cost_satang UNCHANGED
//      until confirm is actually called.
//   2. An unmapped line records as a general expense (a purchase_line_items
//      row with ingredient_id null) and touches no ingredient or stock_ledger
//      row -- never forced into a mapping.
//   3. A forced failure (one line's ingredientId belongs to a different
//      store) rolls back EVERYTHING already written earlier in the same
//      call -- purchase_invoices stays unconfirmed, no purchase_line_items,
//      no ingredient cost change, no stock_ledger row, no job_queue row.
//   4. Timing: a 5-line confirm completes well under 60 seconds.
//
// What this file does NOT re-prove: FORBIDDEN/NOT_FOUND/single-caller
// idempotent-double-tap -- these follow the exact same shape console_
// advance_order.test.ts already proves for the sibling wrapper (0040), and
// re-deriving that here would be duplicate coverage of the same underlying
// pattern, not a new risk this entry introduces.
//
// UPDATE, post redline_reviewer CRITICAL finding (WBS 6.4 fix pass): that
// "follows the exact same shape" reasoning was exactly the bug -- 0040's
// concurrency safety comes from transition_order's own `select ... for
// update` (0032), and 0043 had no equivalent lock of its own, so two
// concurrent confirms on the SAME invoice both passed the (unlocked)
// idempotency check and both ran the full write pass, duplicating
// purchase_line_items and stock_ledger rows. Migration 0043 now takes
// `select ... for update` on purchase_invoices (mirroring 0040/0032's
// pattern directly, not by delegation) plus `for update` on each mapped
// ingredient row (covering the adjacent cross-invoice-same-ingredient race).
// The "10 genuinely concurrent calls" describe block below is the test that
// was missing -- this file's job is now the FOUR original WBS 6.4 items
// above PLUS this concurrency proof.
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
const createdAuthUserIds: string[] = [];

async function createMerchantFixture(client: Client, label: string): Promise<MerchantFixture> {
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

  const storeResult = await client.query<{ id: string }>(
    `insert into stores (merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity)
     values ($1, $2, $3, '07:00', '19:00', 'Asia/Bangkok', 3)
     returning id`,
    [merchantId, `qa-6-4-${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`, `QA 6.4 Store ${label}`],
  );
  const storeId = storeResult.rows[0].id;

  createdAuthUserIds.push(authUserId);
  return { authUserId, merchantId, storeId };
}

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[console_confirm_purchase_invoice.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` (and apply migration 0043) first. This is a SKIP, not a pass.\n`,
    );
    return;
  }

  const client = await connect();
  try {
    merchantA = await createMerchantFixture(client, "a");
    merchantB = await createMerchantFixture(client, "b");
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

async function insertIngredient(
  client: Client,
  storeId: string,
  name: string,
  baseUnit: "g" | "ml" | "piece",
  currentCostSatang: number | null,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into ingredients (store_id, name, base_unit, current_unit_cost_satang)
     values ($1, $2, $3, $4) returning id`,
    [storeId, name, baseUnit, currentCostSatang],
  );
  return rows[0].id;
}

/** Mirrors WBS 6.1's createPurchaseInvoice -- one purchase_invoices row,
 * lines parked in raw_ocr_output, no purchase_line_items written. */
async function insertManualInvoice(
  client: Client,
  storeId: string,
  totalSatang: number,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into purchase_invoices (store_id, vendor_name, invoice_date, total_satang, ocr_status, raw_ocr_output)
     values ($1, 'QA Wholesale', current_date, $2, 'manual', $3::jsonb)
     returning id`,
    [
      storeId,
      totalSatang,
      JSON.stringify({ source: "manual", version: 1, lineItems: [] }),
    ],
  );
  return rows[0].id;
}

interface ConfirmLineInput {
  name: string;
  rawText: string;
  ingredientId: string | null;
  qtyBaseUnit: number | null;
  unitCostSatang: number | null;
  totalSatang: number;
}

interface ConfirmResult {
  ok: boolean;
  already?: boolean;
  code?: string;
  invoiceId?: string;
  totalSatang?: number;
  changed?: { ingredientId: string; oldCostSatang: number | null; newCostSatang: number }[];
}

async function callConfirm(
  client: Client,
  invoiceId: string,
  vendorName: string,
  invoiceDate: string,
  lines: ConfirmLineInput[],
): Promise<ConfirmResult> {
  const { rows } = await client.query(
    "select console_confirm_purchase_invoice($1, $2, $3, $4) as result",
    [invoiceId, vendorName, invoiceDate, JSON.stringify(lines)],
  );
  return rows[0].result as ConfirmResult;
}

describe("WBS 6.4 — console_confirm_purchase_invoice: no confirm, no cost write", () => {
  it("a purchase_invoices row parked from 6.1 leaves every ingredient cost untouched until confirm is called", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const milkId = await insertIngredient(client, merchantA.storeId, "QA Milk", "ml", 4200);
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 45000);

      // The 6.1 insert itself, reached with superuser privileges here purely
      // to set up the fixture -- no confirm has happened yet.
      const { rows: before } = await client.query<{ current_unit_cost_satang: number | null }>(
        "select current_unit_cost_satang from ingredients where id = $1",
        [milkId],
      );
      expect(before[0].current_unit_cost_satang).toBe(4200);

      const { rows: invoiceBefore } = await client.query<{ review_status: string }>(
        "select review_status from purchase_invoices where id = $1",
        [invoiceId],
      );
      expect(invoiceBefore[0].review_status).toBe("needs_review");

      const { rows: lineCountBefore } = await client.query<{ n: string }>(
        "select count(*)::int as n from purchase_line_items where invoice_id = $1",
        [invoiceId],
      );
      expect(Number(lineCountBefore[0].n)).toBe(0);

      // Still no confirm call anywhere above this line — assert once more,
      // explicitly, that the cost is exactly what it was before the invoice
      // even existed.
      const { rows: stillBefore } = await client.query<{ current_unit_cost_satang: number | null }>(
        "select current_unit_cost_satang from ingredients where id = $1",
        [milkId],
      );
      expect(stillBefore[0].current_unit_cost_satang).toBe(4200);
    });
  });
});

describe("WBS 6.4 — console_confirm_purchase_invoice: unmapped lines record as a general expense only", () => {
  it("an unmapped line writes a purchase_line_items row with ingredient_id null, and touches no ingredient or stock_ledger row", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const milkId = await insertIngredient(client, merchantA.storeId, "QA Milk", "ml", 4200);
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 8000);
      await asMerchant(client, merchantA.authUserId);

      const result = await callConfirm(client, invoiceId, "QA Wholesale", "2026-08-22", [
        {
          name: "ถุงกระดาษ",
          rawText: "ถุงกระดาษ (100 ใบ)",
          ingredientId: null,
          qtyBaseUnit: null,
          unitCostSatang: null,
          totalSatang: 8000,
        },
      ]);
      expect(result.ok).toBe(true);
      expect(result.already).toBe(false);

      await resetRole(client);

      const { rows: lineRows } = await client.query<{
        ingredient_id: string | null;
        qty_base_unit: string | null;
        unit_cost_satang: number | null;
        total_satang: number;
      }>(
        "select ingredient_id, qty_base_unit, unit_cost_satang, total_satang from purchase_line_items where invoice_id = $1",
        [invoiceId],
      );
      expect(lineRows).toHaveLength(1);
      expect(lineRows[0].ingredient_id).toBeNull();
      expect(lineRows[0].qty_base_unit).toBeNull();
      expect(lineRows[0].unit_cost_satang).toBeNull();
      expect(lineRows[0].total_satang).toBe(8000);

      // The unrelated ingredient in this same store is completely untouched.
      const { rows: ingredientRows } = await client.query<{ current_unit_cost_satang: number | null }>(
        "select current_unit_cost_satang from ingredients where id = $1",
        [milkId],
      );
      expect(ingredientRows[0].current_unit_cost_satang).toBe(4200);

      const { rows: ledgerRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from stock_ledger where purchase_invoice_id = $1",
        [invoiceId],
      );
      expect(Number(ledgerRows[0].n)).toBe(0);

      const { rows: jobRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'cost_recalc' and payload->>'sourceInvoiceId' = $1",
        [invoiceId],
      );
      expect(Number(jobRows[0].n)).toBe(0); // nothing to recalc — no ingredient cost moved

      const { rows: invoiceRows } = await client.query<{ review_status: string; total_satang: number }>(
        "select review_status, total_satang from purchase_invoices where id = $1",
        [invoiceId],
      );
      expect(invoiceRows[0].review_status).toBe("confirmed");
      expect(invoiceRows[0].total_satang).toBe(8000);
    });
  });
});

describe("WBS 6.4 — console_confirm_purchase_invoice: a forced failure rolls back every write from the same call", () => {
  // Uses the tx.savepoint/rollbackToSavepoint helpers withRollback's own
  // header documents for exactly this shape: Postgres aborts the entire
  // enclosing transaction on the first uncaught error until a ROLLBACK or a
  // SAVEPOINT recovery, so the assertions below (run in the SAME
  // transaction, to see the RPC's own uncommitted writes) would otherwise
  // themselves fail with "current transaction is aborted".
  it("one line pointing at another store's ingredient raises and leaves purchase_invoices, purchase_line_items, ingredients, stock_ledger, and job_queue all unchanged", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client, tx) => {
      const milkId = await insertIngredient(client, merchantA.storeId, "QA Milk", "ml", 4200);
      const beansId = await insertIngredient(client, merchantA.storeId, "QA Beans", "g", 900);
      // Belongs to merchant B, not A — the cross-store reference this test
      // forces.
      const foreignIngredientId = await insertIngredient(client, merchantB.storeId, "QA Foreign", "g", 500);

      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 100000);
      await asMerchant(client, merchantA.authUserId);
      await tx.savepoint("before_confirm");

      // Line 1 (milk) is entirely legitimate and, since ownership is
      // checked per-line inside the WRITE loop (not a separate up-front
      // pass), its purchase_line_items/ingredients/stock_ledger writes have
      // already executed by the time line 2 raises.
      const attempt = callConfirm(client, invoiceId, "QA Wholesale", "2026-08-22", [
        {
          name: "QA Milk",
          rawText: "QA Milk (5 L)",
          ingredientId: milkId,
          qtyBaseUnit: 5000,
          unitCostSatang: 4500,
          totalSatang: 22500,
        },
        {
          name: "QA Foreign",
          rawText: "QA Foreign (1 kg)",
          ingredientId: foreignIngredientId,
          qtyBaseUnit: 1000,
          unitCostSatang: 500,
          totalSatang: 5000,
        },
      ]);
      await expect(attempt).rejects.toThrow();
      await tx.rollbackToSavepoint("before_confirm");

      await resetRole(client);

      // Nothing from line 1 survived either — this is the whole point of
      // the acceptance criterion ("a forced failure rolls back all three").
      const { rows: invoiceRows } = await client.query<{ review_status: string; total_satang: number }>(
        "select review_status, total_satang from purchase_invoices where id = $1",
        [invoiceId],
      );
      expect(invoiceRows[0].review_status).toBe("needs_review");
      expect(invoiceRows[0].total_satang).toBe(100000); // the original 6.1 value, untouched

      const { rows: lineRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from purchase_line_items where invoice_id = $1",
        [invoiceId],
      );
      expect(Number(lineRows[0].n)).toBe(0);

      const { rows: milkRows } = await client.query<{ current_unit_cost_satang: number | null }>(
        "select current_unit_cost_satang from ingredients where id = $1",
        [milkId],
      );
      expect(milkRows[0].current_unit_cost_satang).toBe(4200); // NOT 4500

      const { rows: beansRows } = await client.query<{ current_unit_cost_satang: number | null }>(
        "select current_unit_cost_satang from ingredients where id = $1",
        [beansId],
      );
      expect(beansRows[0].current_unit_cost_satang).toBe(900); // untouched control row

      const { rows: ledgerRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from stock_ledger where purchase_invoice_id = $1",
        [invoiceId],
      );
      expect(Number(ledgerRows[0].n)).toBe(0);

      const { rows: jobRows } = await client.query<{ n: string }>(
        "select count(*)::int as n from job_queue where job_type = 'cost_recalc' and payload->>'sourceInvoiceId' = $1",
        [invoiceId],
      );
      expect(Number(jobRows[0].n)).toBe(0);
    });
  });
});

describe("WBS 6.4 — console_confirm_purchase_invoice: timing", () => {
  // Interpretation disclosed for redline_reviewer/qa_engineer: the WBS
  // acceptance criterion ("confirming a 5-line bill takes under 60 seconds")
  // is a human-completion-time UX target, properly proven end-to-end by the
  // 8.2 E2E suite, not by this backend test. What this DB-level test can
  // legitimately assert is the RPC call itself never becomes the bottleneck
  // — five mapped lines writing five purchase_line_items/ingredients/
  // stock_ledger rows plus one job_queue row complete in, in practice, low
  // milliseconds; 60s is an intentionally generous ceiling that only fails
  // on a genuine catastrophic regression (e.g. an accidental full table
  // scan), not a tight performance budget.
  it("a 5-line confirm (all mapped) completes well under 60 seconds", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const ingredientIds: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        // Initial cost (1) deliberately differs from every new cost below
        // (1000+i) so all 5 lines register as a real change — not an
        // arbitrary choice, see the assertion on `result.changed` below.
        ingredientIds.push(await insertIngredient(client, merchantA.storeId, `QA Ingredient ${i}`, "g", 1));
      }
      const invoiceId = await insertManualInvoice(client, merchantA.storeId, 50000);
      await asMerchant(client, merchantA.authUserId);

      const lines: ConfirmLineInput[] = ingredientIds.map((id, i) => ({
        name: `QA Ingredient ${i}`,
        rawText: `QA Ingredient ${i} (1 kg)`,
        ingredientId: id,
        qtyBaseUnit: 1000,
        unitCostSatang: 1000 + i,
        totalSatang: 10000,
      }));

      const startedAt = Date.now();
      const result = await callConfirm(client, invoiceId, "QA Wholesale", "2026-08-22", lines);
      const elapsedMs = Date.now() - startedAt;

      expect(result.ok).toBe(true);
      expect(result.changed).toHaveLength(5);
      expect(elapsedMs).toBeLessThan(60_000);
    });
  }, 65_000);
});

describe("WBS 6.4 — console_confirm_purchase_invoice: 10 genuinely concurrent calls on the same invoice", () => {
  // redline_reviewer's CRITICAL finding, reproduced live pre-fix: two real
  // connections confirming the same 1-line (5 L milk) invoice both read
  // review_status <> 'confirmed', both passed validation, and both wrote --
  // 2 purchase_line_items rows, stock_ledger showing 10,000 ml received for
  // a 5,000 ml delivery. This is the direct mirror of console_advance_
  // order.test.ts's own "ten parallel calls yield exactly one real
  // transition" proof, now that 0043 takes its own `for update` lock on
  // purchase_invoices rather than relying on a delegate that doesn't exist.
  it("REQUIRED: ten parallel confirms of the SAME invoice (10 real connections, Promise.all) yield exactly one real write, not one per caller", async () => {
    if (!dbAvailable) return;

    const setupClient = await connect();
    let invoiceId: string;
    let milkId: string;
    try {
      milkId = await insertIngredient(setupClient, merchantA.storeId, "QA Concurrency Milk", "ml", 4200);
      invoiceId = await insertManualInvoice(setupClient, merchantA.storeId, 22500);
    } finally {
      await setupClient.end();
    }

    const line: ConfirmLineInput = {
      name: "QA Concurrency Milk",
      rawText: "QA Concurrency Milk (5 L)",
      ingredientId: milkId,
      qtyBaseUnit: 5000,
      unitCostSatang: 4500,
      totalSatang: 22500,
    };

    // 10 independent connections/sessions — genuinely parallel, same bar as
    // console_advance_order.test.ts's own concurrency proof, not 10
    // sequential calls against one shared client.
    const clients = await Promise.all(Array.from({ length: 10 }, () => connect()));
    try {
      await Promise.all(clients.map((client) => asMerchant(client, merchantA.authUserId, { local: false })));

      const results = await Promise.all(
        clients.map((client) => callConfirm(client, invoiceId, "QA Wholesale", "2026-08-22", [line])),
      );

      expect(results.every((r) => r.ok === true)).toBe(true); // no errors surfaced under contention
      const winners = results.filter((r) => r.already === false);
      const noops = results.filter((r) => r.already === true);
      expect(winners).toHaveLength(1);
      expect(noops).toHaveLength(9);

      const verify = await connect();
      try {
        const { rows: invoiceRows } = await verify.query<{ review_status: string; total_satang: number }>(
          "select review_status, total_satang from purchase_invoices where id = $1",
          [invoiceId],
        );
        expect(invoiceRows[0].review_status).toBe("confirmed");
        expect(invoiceRows[0].total_satang).toBe(22500);

        const { rows: lineRows } = await verify.query<{ n: string }>(
          "select count(*)::int as n from purchase_line_items where invoice_id = $1",
          [invoiceId],
        );
        expect(Number(lineRows[0].n)).toBe(1); // exactly one line row across all 10 attempts, not 10

        const { rows: ledgerRows } = await verify.query<{ n: string; total_delta: string }>(
          "select count(*)::int as n, coalesce(sum(delta_base_unit), 0)::text as total_delta from stock_ledger where purchase_invoice_id = $1",
          [invoiceId],
        );
        expect(Number(ledgerRows[0].n)).toBe(1); // exactly one stock movement, not one per racing caller
        expect(Number(ledgerRows[0].total_delta)).toBe(5000); // the real 5 L delivery, not 50 L

        const { rows: ingredientRows } = await verify.query<{ current_unit_cost_satang: number | null }>(
          "select current_unit_cost_satang from ingredients where id = $1",
          [milkId],
        );
        expect(ingredientRows[0].current_unit_cost_satang).toBe(4500);

        const { rows: jobRows } = await verify.query<{ n: string }>(
          "select count(*)::int as n from job_queue where job_type = 'cost_recalc' and payload->>'sourceInvoiceId' = $1",
          [invoiceId],
        );
        expect(Number(jobRows[0].n)).toBe(1); // exactly one recalc job, not up to 10
      } finally {
        await verify.end();
      }
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  }, 30_000);
});
