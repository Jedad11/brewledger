// WBS 4.5 hotfix — RL-1 primary enforcement point moved into the DB layer.
//
// redline_reviewer audit (post-4.5) found that "a store cannot be published
// without a verified PromptPay ID" was enforced ONLY in
// apps/console/src/app/console/(app)/settings/store/actions.ts
// (saveStoreProfile) — an app-only gate, bypassable by any authenticated
// merchant calling `supabase.from('stores').update({ is_published: true })`
// directly, since merchant_rw_stores (0021_rls.sql) only checks ownership,
// never promptpay_verified_at. architect's fix
// (packages/db/migrations/0027_promptpay_publish_guard.sql) adds a
// `BEFORE INSERT OR UPDATE` trigger, guard_promptpay_before_publish(), that
// forces `is_published := false` whenever a row's NEW state would otherwise
// stand as (is_published = true, promptpay_verified_at IS NULL) — a SILENT
// coercion (the write still succeeds, 200/OK), not a raised error, matching
// RLS's own "unauthorized row is just absent" posture rather than a
// distinguishable error a bypass attempt could iterate on.
//
// This file proves the trigger itself, directly against Postgres — this is
// RL-1's primary enforcement point, hence the rl1_* naming, matching
// rl1_no_bank_details.test.ts / rl1_no_gateway_sdk_imports.test.ts in this
// same directory. Both real bypass paths the migration's own header comment
// names are exercised here as a direct `update stores set ...`, deliberately
// bypassing the Server Action layer entirely (a `service_role`-equivalent
// superuser `pg` client, the same one every other trigger/schema test in
// this directory uses — see tests/helpers/db.ts's own header comment):
//
//   1. A forged direct write setting is_published = true on a row whose
//      promptpay_verified_at is still null (the RLS-adjacent bypass the
//      audit found).
//   2. The ordinary use case: savePromptPaySettings nulls
//      promptpay_verified_at when the merchant edits an already-verified
//      PromptPay identifier, without itself touching is_published — the
//      trigger must auto-unpublish the store as a side effect of THAT
//      write, not just at initial-publish time.
//
// Real Postgres, real trigger, no mock — everything here runs inside a
// transaction that is unconditionally rolled back (tests/helpers/db.ts
// `withRollback`), so it leaves no fixture rows behind and needs no
// PostgREST round trip (unlike rls.test.ts, this is a pure Postgres-level
// question, not a question about what the HTTP API exposes).
import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { isReachable, withRollback } from "./helpers/db";

let dbAvailable = false;

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[rl1_promptpay_publish_trigger.test.ts] SKIPPING — no local Postgres " +
        "reachable at postgresql://postgres:postgres@127.0.0.1:54322/postgres. " +
        "Run `supabase start` (and `supabase db reset` if the stack predates " +
        "migration 0027) first. This is a SKIP, not a pass.\n",
    );
  }
});

// Mirrors merchant_auto_provision.test.ts's own insertAuthUser shape (the
// columns GoTrue's Go client requires as non-null strings).
async function insertAuthUser(client: Client, { id, phone }: { id: string; phone: string }) {
  await client.query(
    `insert into auth.users (
       instance_id, id, aud, role, phone, phone_confirmed_at,
       confirmation_token, recovery_token, email_change_token_new,
       raw_app_meta_data, raw_user_meta_data, created_at, updated_at
     ) values (
       '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(),
       '', '', '',
       '{"provider":"phone","providers":["phone"]}'::jsonb, '{}'::jsonb, now(), now()
     )`,
    [id, phone],
  );
}

/** auth.users insert provisions a merchants row via the WBS 4.1 trigger
 * (0023_merchant_auto_provision.sql) — read it back rather than inserting a
 * second one, same pattern rls-fixture.ts's own comments describe. */
async function getMerchantId(client: Client, authUserId: string): Promise<string> {
  const { rows } = await client.query(`select id from merchants where auth_user_id = $1`, [authUserId]);
  return rows[0].id as string;
}

describe("WBS 4.5 hotfix — RL-1: guard_promptpay_before_publish trigger on stores", () => {
  it(
    "a direct UPDATE forging is_published = true on a row with promptpay_verified_at IS NULL " +
      "lands as is_published = false — the write succeeds, it does not error, and it does not " +
      "persist true (silent coercion, same failure shape as RLS's own posture)",
    async () => {
      if (!dbAvailable) return;
      await withRollback(async (client) => {
        const authUserId = "55555555-5555-4555-8555-555555555501";
        await insertAuthUser(client, { id: authUserId, phone: "+66899990101" });
        const merchantId = await getMerchantId(client, authUserId);

        // Row starts unpublished, no PromptPay identifier at all — the
        // ordinary state of a store that has never touched
        // /console/settings/payments.
        const { rows: insertRows } = await client.query(
          `insert into stores (merchant_id, slug, name, is_published)
           values ($1, 'trigger-bypass-1', 'Trigger Bypass Store', false)
           returning id, is_published, promptpay_verified_at`,
          [merchantId],
        );
        const storeId = insertRows[0].id as string;
        expect(insertRows[0].is_published).toBe(false);
        expect(insertRows[0].promptpay_verified_at).toBeNull();

        // The forged bypass: a direct write setting ONLY is_published,
        // exactly what an authenticated merchant's own supabase-js client
        // could issue against merchant_rw_stores, skipping
        // saveStoreProfile's app-layer PUBLISH_REQUIRES_PROMPTPAY_VERIFICATION
        // check entirely.
        const { rows: updateRows } = await client.query(
          `update stores set is_published = true where id = $1
           returning is_published, promptpay_verified_at`,
          [storeId],
        );

        // No error was thrown getting here — the write "succeeds" — but the
        // trigger coerced the persisted value.
        expect(updateRows[0].is_published).toBe(false);
        expect(updateRows[0].promptpay_verified_at).toBeNull();

        // Re-select from a fresh query on the same connection to rule out
        // the RETURNING clause reflecting something other than the
        // committed (pending-rollback) row state.
        const { rows: reselect } = await client.query(`select is_published from stores where id = $1`, [storeId]);
        expect(reselect[0].is_published).toBe(false);
      });
    },
  );

  it(
    "a published, verified store that has promptpay_verified_at nulled by a direct UPDATE " +
      "(simulating savePromptPaySettings on an identifier edit, which never touches " +
      "is_published itself) is auto-unpublished by the same trigger",
    async () => {
      if (!dbAvailable) return;
      await withRollback(async (client) => {
        const authUserId = "55555555-5555-4555-8555-555555555502";
        await insertAuthUser(client, { id: authUserId, phone: "+66899990102" });
        const merchantId = await getMerchantId(client, authUserId);

        // A genuinely published, previously-verified store — the ordinary
        // steady state after a successful payments-settings save.
        const { rows: insertRows } = await client.query(
          `insert into stores (merchant_id, slug, name, is_published, promptpay_id, promptpay_type, promptpay_verified_at)
           values ($1, 'trigger-bypass-2', 'Trigger Reverify Store', true, '0899999999', 'msisdn', now())
           returning id, is_published, promptpay_verified_at`,
          [merchantId],
        );
        const storeId = insertRows[0].id as string;
        expect(insertRows[0].is_published).toBe(true);
        expect(insertRows[0].promptpay_verified_at).not.toBeNull();

        // savePromptPaySettings's own UPDATE shape on the identifier-changed
        // branch: sets promptpay_id/type/verified_at, never touches
        // is_published — so Postgres's NEW row for this exact statement
        // carries the unchanged OLD is_published (true) alongside a NEW
        // (null) verified_at.
        const { rows: updateRows } = await client.query(
          `update stores
             set promptpay_id = '0898888888', promptpay_type = 'msisdn', promptpay_verified_at = null
           where id = $1
           returning is_published, promptpay_verified_at, promptpay_id`,
          [storeId],
        );

        expect(updateRows[0].is_published).toBe(false); // auto-unpublished as a side effect
        expect(updateRows[0].promptpay_verified_at).toBeNull();
        expect(updateRows[0].promptpay_id).toBe("0898888888"); // the identifier edit itself still applied

        const { rows: reselect } = await client.query(`select is_published from stores where id = $1`, [storeId]);
        expect(reselect[0].is_published).toBe(false);
      });
    },
  );

  it("a row with is_published = true and a non-null promptpay_verified_at is left untouched by the trigger", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const authUserId = "55555555-5555-4555-8555-555555555503";
      await insertAuthUser(client, { id: authUserId, phone: "+66899990103" });
      const merchantId = await getMerchantId(client, authUserId);

      const { rows: insertRows } = await client.query(
        `insert into stores (merchant_id, slug, name, is_published, promptpay_id, promptpay_type, promptpay_verified_at)
         values ($1, 'trigger-happy-path', 'Trigger Happy Path Store', true, '0899999999', 'msisdn', now())
         returning is_published, promptpay_verified_at`,
        [merchantId],
      );
      expect(insertRows[0].is_published).toBe(true);
      expect(insertRows[0].promptpay_verified_at).not.toBeNull();
    });
  });

  it("an UPDATE that leaves is_published = false and promptpay_verified_at null (never published) is a no-op for the trigger, not an error", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const authUserId = "55555555-5555-4555-8555-555555555504";
      await insertAuthUser(client, { id: authUserId, phone: "+66899990104" });
      const merchantId = await getMerchantId(client, authUserId);

      const { rows: insertRows } = await client.query(
        `insert into stores (merchant_id, slug, name, is_published)
         values ($1, 'trigger-no-op', 'Trigger No-op Store', false) returning id`,
        [merchantId],
      );
      const storeId = insertRows[0].id as string;

      const { rows: updateRows } = await client.query(
        `update stores set name = 'Trigger No-op Store (renamed)' where id = $1
         returning is_published, promptpay_verified_at, name`,
        [storeId],
      );
      expect(updateRows[0].is_published).toBe(false);
      expect(updateRows[0].promptpay_verified_at).toBeNull();
      expect(updateRows[0].name).toBe("Trigger No-op Store (renamed)");
    });
  });

  it("the backstop CHECK constraint stores_publish_requires_verified_promptpay exists and is VALID (not NOT VALID)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const { rows } = await client.query(
        `select conname, convalidated
           from pg_constraint
          where conrelid = 'stores'::regclass
            and conname = 'stores_publish_requires_verified_promptpay'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].convalidated).toBe(true);
    });
  });
});
