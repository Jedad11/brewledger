// WBS 4.8 — RL-1 schema guard: no fee-bearing or fee-attribution column may
// ever exist anywhere in the public schema. The gateway plan this entry superseded
// would have added merchants.absorb_gateway_fee, orders.gateway_fee_satang,
// and orders.fee_borne_by; this repo restarted on direct merchant-owned
// PromptPay from WBS 3.x onward and those columns never existed here. This
// test exists so a later change can't reintroduce them without this suite
// failing — same posture as this directory's other rl1_*.test.ts guards.
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
      "\n[rl1_no_gateway_fee_columns.test.ts] SKIPPING — no local Postgres reachable at " +
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres. " +
        "Run `supabase start` first. This is a SKIP, not a pass.\n",
    );
  }
});

// The three columns the withdrawn gateway plan would have added, plus a
// broader net for any renamed equivalent ("fee_borne", "fee_bearer",
// "gateway_fee", "absorb_fee", "fee_attribution") so a future reintroduction
// under a different name is still caught.
const FORBIDDEN_FEE_COLUMN_PATTERN =
  /absorb_gateway_fee|gateway_fee|fee_borne|fee_bearer|fee_attribution|absorb_fee/i;

describe("WBS 4.8 — RL-1: no fee-bearing or fee-attribution column exists anywhere in the schema", () => {
  it("no column in the public schema matches the forbidden gateway-fee pattern", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query(
        `
        select table_name, column_name
          from information_schema.columns
         where table_schema = 'public'
           and column_name ~* $1
      `,
        [FORBIDDEN_FEE_COLUMN_PATTERN.source],
      );

      expect(rows).toEqual([]);
    } finally {
      await client.end();
    }
  });

  it("the three specific superseded-plan column names do not exist anywhere in the public schema", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query(`
        select table_name, column_name
          from information_schema.columns
         where table_schema = 'public'
           and (
             (table_name = 'merchants' and column_name = 'absorb_gateway_fee')
             or (table_name = 'orders' and column_name = 'gateway_fee_satang')
             or (table_name = 'orders' and column_name = 'fee_borne_by')
           )
      `);

      expect(rows).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
