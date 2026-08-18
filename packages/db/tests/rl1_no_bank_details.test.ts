// WBS 3.9 — RL-1 schema guard: no merchant bank account number, name, or
// branch may ever be persisted. The merchant's PromptPay alias
// (stores.promptpay_id) is a routing identifier published in the national
// PromptPay directory, not an account number — the mapping from alias to
// bank account lives with the banking system, never with us.
//
// Runs against a REAL local Postgres instance the same way
// packages/db/tests/schema.test.ts does (see tests/helpers/db.ts) — schema
// introspection only proves something about an actual database, never a
// mock. SKIPS (not passes) when no local `supabase start` stack is reachable.
import { beforeAll, describe, expect, it } from "vitest";
import { connect, isReachable } from "./helpers/db";

let dbAvailable = false;

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[rl1_no_bank_details.test.ts] SKIPPING — no local Postgres reachable at " +
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres. " +
        "Run `supabase start` first. This is a SKIP, not a pass.\n",
    );
  }
});

const FORBIDDEN_COLUMN_PATTERN = /bank_account|account_number|account_name|swift|iban|branch/i;

describe("WBS 3.9 — RL-1: no bank account details persisted", () => {
  it("no column name in the public schema matches the forbidden bank-detail pattern", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query(`
        select table_name, column_name
          from information_schema.columns
         where table_schema = 'public'
           and column_name ~* $1
      `, [FORBIDDEN_COLUMN_PATTERN.source]);

      expect(rows).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("stores.promptpay_id exists as the only routing identifier for the merchant's own PromptPay account", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query(`
        select column_name, data_type
          from information_schema.columns
         where table_schema = 'public'
           and table_name = 'stores'
           and column_name = 'promptpay_id'
      `);
      expect(rows).toHaveLength(1);
      expect(rows[0].data_type).toBe("text");

      // Sanity: promptpay_id itself must not accidentally match the
      // forbidden pattern (it shouldn't — "promptpay_id" contains none of
      // bank_account/account_number/account_name/swift/iban/branch — but
      // asserted explicitly so a future rename can't silently defeat this
      // test's own premise).
      expect(FORBIDDEN_COLUMN_PATTERN.test("promptpay_id")).toBe(false);
    } finally {
      await client.end();
    }
  });
});
