// WBS 4.1 — Acceptance criterion: "First verification creates exactly one
// merchants row bound to auth.users.id."
//
// provision_merchant_on_signup() (packages/db/migrations/0023_merchant_auto_provision.sql)
// is an AFTER INSERT trigger on auth.users, guarded by
// `on conflict (auth_user_id) do nothing`. auth.users.id is itself a primary
// key, so a literal second `insert into auth.users` for the same id is
// impossible to test directly (Postgres would reject it at the PK
// constraint, never reaching the trigger a second time) — the real risk this
// acceptance criterion guards against is a REPLAYED invocation of the
// trigger's own insert statement (a re-run migration, or any other path that
// re-executes `insert into merchants (auth_user_id, ...) on conflict (...)
// do nothing`), which is exactly what this test reproduces and proves is a
// no-op.
//
// Real Postgres, real trigger, real constraint — no mock. Everything here
// runs inside a transaction that is unconditionally rolled back
// (tests/helpers/db.ts `withRollback`), so it leaves no fixture rows behind.
import { beforeAll, describe, expect, it } from "vitest";
import { isReachable, withRollback } from "./helpers/db";

let dbAvailable = false;

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[merchant_auto_provision.test.ts] SKIPPING — no local Postgres " +
        "reachable at postgresql://postgres:postgres@127.0.0.1:54322/postgres. " +
        "Run `supabase start` (and `supabase db reset` if the stack predates " +
        "migration 0023) first. This is a SKIP, not a pass.\n",
    );
  }
});

// Mirrors packages/db/seed.sql's own auth.users insert shape (the columns
// GoTrue's Go client requires as non-null strings — confirmed by WBS 3.7
// qa_engineer's auth-guard test fixture and seed.sql's own header comment).
async function insertAuthUser(
  client: import("pg").Client,
  { id, phone }: { id: string; phone: string },
) {
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

describe("WBS 4.1 — merchant auto-provision trigger", () => {
  it("first verification (auth.users insert) creates exactly one merchants row bound to auth.users.id", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const authUserId = "11111111-1111-4111-8111-111111111111";
      const phone = "+66899990001";

      await insertAuthUser(client, { id: authUserId, phone });

      const { rows } = await client.query(
        `select id, auth_user_id, phone, subscription_tier from merchants where auth_user_id = $1`,
        [authUserId],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].auth_user_id).toBe(authUserId);
      expect(rows[0].phone).toBe(phone);
      expect(rows[0].subscription_tier).toBe("free");
    });
  });

  it("a replayed provisioning insert for the same auth_user_id does not create a second merchants row", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const authUserId = "22222222-2222-4222-8222-222222222222";
      const phone = "+66899990002";

      await insertAuthUser(client, { id: authUserId, phone });

      const before = await client.query(
        `select id from merchants where auth_user_id = $1`,
        [authUserId],
      );
      expect(before.rows).toHaveLength(1);
      const originalMerchantId = before.rows[0].id;

      // Replays exactly the trigger's own statement — simulating a
      // re-run migration or a replayed webhook, per the acceptance
      // criterion and the migration's own header comment.
      await client.query(
        `insert into merchants (auth_user_id, phone, subscription_tier)
         values ($1, $2, 'free')
         on conflict (auth_user_id) do nothing`,
        [authUserId, phone],
      );

      const after = await client.query(
        `select id from merchants where auth_user_id = $1`,
        [authUserId],
      );
      expect(after.rows).toHaveLength(1);
      expect(after.rows[0].id).toBe(originalMerchantId); // same row, not a new one

      const countAll = await client.query(
        `select count(*)::int as n from merchants where auth_user_id = $1`,
        [authUserId],
      );
      expect(countAll.rows[0].n).toBe(1);
    });
  });

  it("two different auth.users each get their own distinct merchants row (the trigger isn't accidentally global-singleton)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const authUserIdA = "33333333-3333-4333-8333-333333333333";
      const authUserIdB = "44444444-4444-4444-8444-444444444444";

      await insertAuthUser(client, { id: authUserIdA, phone: "+66899990003" });
      await insertAuthUser(client, { id: authUserIdB, phone: "+66899990004" });

      const { rows } = await client.query(
        `select auth_user_id from merchants where auth_user_id in ($1, $2)`,
        [authUserIdA, authUserIdB],
      );
      const ids = rows.map((r: { auth_user_id: string }) => r.auth_user_id).sort();
      expect(ids).toEqual([authUserIdA, authUserIdB].sort());
    });
  });
});
