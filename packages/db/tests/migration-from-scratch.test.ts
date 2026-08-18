// WBS 3.5 acceptance criterion: "`supabase db reset` applies every
// migration cleanly from scratch."
//
// This is deliberately a SEPARATE file from schema.test.ts: it shells out to
// `supabase db reset` (local, no --linked), which drops and recreates the
// *entire local* Postgres database and reapplies all 21 migrations under
// supabase/migrations from nothing. That's the right way to prove
// "from-scratch" — a fresh apply, not incremental `db push` against an
// already-migrated database — but it is slow (tens of seconds) and
// destructive to whatever is currently sitting in the local stack, so it is
// kept out of the default fast loop and opt-in via an env var.
//
// This intentionally targets ONLY the local Docker stack (supabase start).
// It must never be pointed at brewledger-dev or brewledger-prod — there is
// no flag here that could do that (no --linked, no project ref), and the
// command is fixed, not templated from an env var, specifically so that
// can't happen by accident.
//
// Run it with:
//   supabase start   (if not already running)
//   RUN_MIGRATION_RESET_TEST=1 pnpm --filter @brewledger/db exec vitest run tests/migration-from-scratch.test.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { connect, isReachable } from "./helpers/db";

const execFileAsync = promisify(execFile);
const RUN = process.env.RUN_MIGRATION_RESET_TEST === "1";

describe.skipIf(!RUN)(
  "WBS 3.5 — supabase db reset applies every migration cleanly from scratch (local only)",
  () => {
    it("supabase db reset (local) exits 0 and every migrated table exists afterwards", async () => {
      const reachableBefore = await isReachable();
      expect(reachableBefore).toBe(true); // local stack must already be running (`supabase start`)

      // No --linked, no project ref: always the local stack.
      const { stdout, stderr } = await execFileAsync(
        "supabase",
        ["db", "reset"],
        // shell: true so this resolves the CLI's supabase.cmd shim on
        // Windows (a bare execFile of "supabase" is ENOENT there — npm's
        // global bin installs a .cmd wrapper, not an .exe).
        { cwd: process.cwd(), timeout: 5 * 60 * 1000, shell: true },
      );
      const combined = `${stdout}\n${stderr}`;

      // The CLI applies migrations in filename order and logs each one; if
      // any migration in the chain failed, the command exits non-zero and
      // execFileAsync rejects (caught implicitly by the test failing) — but
      // also assert the full expected chain actually printed, so a CLI that
      // silently swallowed a failure doesn't slip through.
      for (const file of [
        "0000_extensions.sql",
        "0001_functions.sql",
        "0002_merchants.sql",
        "0003_stores.sql",
        "0004_menu_categories.sql",
        "0005_menu_items.sql",
        "0006_menu_option_groups.sql",
        "0007_menu_options.sql",
        "0008_ingredients.sql",
        "0009_bom_lines.sql",
        "0010_pickup_slots.sql",
        "0011_orders.sql",
        "0012_order_items.sql",
        "0013_order_item_options.sql",
        "0014_payments.sql",
        "0015_purchase_invoices.sql",
        "0016_purchase_line_items.sql",
        "0017_stock_ledger.sql",
        "0018_job_queue.sql",
        "0019_daily_financials.sql",
        "0020_rl1_structural_proof.sql",
      ]) {
        expect(combined).toContain(file);
      }

      const client = await connect();
      try {
        const { rows } = await client.query(`
          select table_name from information_schema.tables
           where table_schema = 'public' order by table_name
        `);
        const tableNames = rows.map((r) => r.table_name);
        for (const expected of [
          "merchants",
          "stores",
          "menu_categories",
          "menu_items",
          "menu_option_groups",
          "menu_options",
          "ingredients",
          "bom_lines",
          "pickup_slots",
          "orders",
          "order_items",
          "order_item_options",
          "payments",
          "purchase_invoices",
          "purchase_line_items",
          "stock_ledger",
          "job_queue",
          "daily_financials",
        ]) {
          expect(tableNames).toContain(expected);
        }
      } finally {
        await client.end();
      }
    }, 6 * 60 * 1000);
  },
);
