// WBS 3.8 QA test helper — builds one real, COMMITTED merchant+store per
// call, for the storage RLS suite. Committed rather than `withRollback`
// (see packages/db/tests/helpers/db.ts and
// packages/db/tests/helpers/rls-fixture.ts's header comment) for the same
// reason: assertions go through the local HTTP API (PostgREST/Storage),
// which opens its own Postgres connection per request and cannot see rows
// still sitting in an open transaction on our separate `pg` connection.
import type { Client } from "pg";

let counter = 0;

function nextSuffix(label: string): string {
  counter += 1;
  return `${label}-${Date.now()}-${counter}`;
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

export interface StoreFixture {
  authUserId: string;
  merchantId: string;
  storeId: string;
  cleanup: () => Promise<void>;
}

export async function createStoreFixture(client: Client, label: string): Promise<StoreFixture> {
  const suffix = nextSuffix(label);
  const phone = `+66802${String(Math.abs(hashCode(suffix))).slice(0, 6).padStart(6, "0")}`;
  const email = `qa-storage-${suffix}@brewledger.app`;

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
    // migration 0023's AFTER INSERT trigger on auth.users
    // (provision_merchant_on_signup) already inserted a merchants row for
    // authUserId, synchronously, with this exact phone (new.phone) --
    // inserting a second row here would collide on merchants_auth_user_id_key.
    // Select the auto-provisioned row instead of creating a duplicate.
    const { rows: merchantRows } = await client.query(
      `select id from merchants where auth_user_id = $1`,
      [authUserId],
    );
    const merchantId = merchantRows[0].id as string;

    const storeSlug = `qa-storage-${suffix}`;
    const { rows: storeRows } = await client.query(
      `insert into stores (merchant_id, slug, name, is_published, promptpay_id, promptpay_type)
       values ($1, $2, $3, true, '0899999999', 'msisdn') returning id`,
      [merchantId, storeSlug, `QA Storage Store ${suffix}`],
    );
    const storeId = storeRows[0].id as string;

    return { authUserId, merchantId, storeId, cleanup };
  } catch (err) {
    await cleanup().catch(() => undefined);
    throw err;
  }
}
