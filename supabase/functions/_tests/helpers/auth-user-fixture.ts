// WBS 3.7 qa_engineer leg — a dedicated, well-formed auth.users + merchants
// fixture for the withConsoleAuth POSITIVE-path test.
//
// Why this exists instead of reusing packages/db/seed.sql's demo merchant:
// verifyConsoleRequest calls supabase.auth.getUser(), which round-trips to
// the real GoTrue /auth/v1/user endpoint (unlike PostgREST's own JWT
// handling, which only checks the signature/claims and never queries
// auth.users itself). GoTrue's Go struct scans several auth.users token
// columns (confirmation_token, recovery_token, email_change_token_new) as
// non-nullable strings; packages/db/seed.sql's `insert into auth.users`
// does not set them, so they default to NULL, and GoTrue's own /user
// endpoint 500s ("converting NULL to string is unsupported") for the seeded
// demo merchant specifically — confirmed directly against the local
// supabase_auth_brewLedger container logs. This is a genuine seed.sql gap
// (WBS 3.5 territory, not this entry's code), reported separately in
// PROGRESS.md rather than silently worked around in the fixture the
// negative-path (401) tests rely on. It does NOT affect this suite's
// negative-path assertions — GoTrue rejects a malformed/wrong-signature/
// expired token before it ever reaches the auth.users row scan (confirmed
// in the same container logs: those requests fail with `bad_jwt` at the
// token-verification step, never reaching the SQL scan).
// This helper inserts its OWN auth.users row with every GoTrue-required
// text column explicitly set to '' (matching the columns that already
// default to '' elsewhere in the same table, e.g. phone_change_token /
// email_change_token_current / reauthentication_token), so the positive
// path can be proven end-to-end without touching packages/db/seed.sql.
import { Client } from "pg";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export interface AuthUserFixture {
  authUserId: string;
  merchantId: string;
  cleanup(): Promise<void>;
}

export async function createWellFormedAuthUserFixture(): Promise<AuthUserFixture> {
  const client = new Client({ connectionString: LOCAL_DB_URL });
  await client.connect();

  const authUserId = randomUUID();
  const phone = `+66900${Math.floor(Math.random() * 900000 + 100000)}`;

  try {
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
      [authUserId, phone],
    );

    const merchantResult = await client.query<{ id: string }>(
      `insert into merchants (id, auth_user_id, phone, subscription_tier)
       values (gen_random_uuid(), $1, $2, 'free')
       returning id`,
      [authUserId, phone],
    );
    const merchantId = merchantResult.rows[0].id;

    return {
      authUserId,
      merchantId,
      cleanup: async () => {
        const cleanupClient = new Client({ connectionString: LOCAL_DB_URL });
        await cleanupClient.connect();
        try {
          // Cascades merchants -> (nothing else, this fixture owns no stores).
          await cleanupClient.query("delete from auth.users where id = $1", [authUserId]);
        } finally {
          await cleanupClient.end();
        }
      },
    };
  } finally {
    await client.end();
  }
}
