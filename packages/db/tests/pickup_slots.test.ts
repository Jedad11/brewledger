// WBS 5.3 qa_engineer leg — Time-slot Engine and Quota Enforcement.
//
// This is the WBS 5.3 Testing block's REQUIRED (not optional) concurrency
// proof: "Fire 10 genuinely parallel reservation requests at a slot with
// capacity 1 (use Promise.all against a real database, not mocks). Assert
// exactly 1 success and 9 clean failures, and assert booked_count === 1
// afterwards. Then assert the database check constraint (booked_count <=
// capacity) independently by attempting a direct over-increment and
// expecting it to raise."
//
// Deliberately drives reserve_pickup_slot/release_pickup_slot
// (packages/db/migrations/0028_pickup_slot_generation_and_reservation.sql)
// over 10 INDEPENDENT `pg.Client` connections (real, separate TCP
// connections and separate implicit transactions — not 10 calls on one
// client, which Postgres would just serialize on its own single session and
// prove nothing about cross-transaction atomicity), same "genuinely
// parallel" bar tenant_isolation.test.ts sets for the Edge Function layer.
// This test exercises the SQL function directly rather than going through
// PostgREST/the public-reserve-slot Edge Function's HTTP surface — the
// atomicity guarantee under test lives entirely in the single UPDATE
// statement inside reserve_pickup_slot; an HTTP hop in front of it would
// only add unrelated network-layer flakiness to this specific proof. The
// Edge Function's own request/response contract (400/410/200 shapes) is
// covered separately in
// supabase/functions/_tests/public_reserve_slot.test.ts.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, isReachable, LOCAL_DB_URL, withRollback } from "./helpers/db";

let dbAvailable = false;
let authUserId: string | undefined;
let merchantId: string | undefined;
let storeId: string | undefined;

beforeAll(async () => {
  dbAvailable = await isReachable();
  if (!dbAvailable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[pickup_slots.test.ts] SKIPPING — no local Postgres reachable at " +
        `${LOCAL_DB_URL}. Run \`supabase start\` (and \`supabase db reset\` if ` +
        "the stack predates migration 0028) first. This is a SKIP, not a pass.\n",
    );
    return;
  }

  const client = await connect();
  try {
    authUserId = randomUUID();
    const phone = `+66900${Math.floor(Math.random() * 900000 + 100000)}`;
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
    // WBS 4.1's on_auth_user_created_provision_merchant trigger already
    // inserted a merchants row for authUserId -- upsert, same shape as
    // supabase/functions/_tests/helpers/auth-user-fixture.ts.
    const merchantResult = await client.query<{ id: string }>(
      `insert into merchants (id, auth_user_id, phone, subscription_tier)
       values (gen_random_uuid(), $1, $2, 'free')
       on conflict (auth_user_id) do update set phone = excluded.phone
       returning id`,
      [authUserId, phone],
    );
    merchantId = merchantResult.rows[0].id;

    const storeResult = await client.query<{ id: string }>(
      `insert into stores (merchant_id, slug, name, opens_at, closes_at, timezone, default_slot_capacity)
       values ($1, $2, 'QA 5.3 Store', '07:00', '19:00', 'Asia/Bangkok', 3)
       returning id`,
      [merchantId, `qa-pickup-slots-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`],
    );
    storeId = storeResult.rows[0].id;
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  if (!dbAvailable || !authUserId) return;
  const client = await connect();
  try {
    // Cascades merchants -> stores -> pickup_slots (0003_stores.sql,
    // 0010_pickup_slots.sql), same as tenant_isolation.test.ts's cleanup.
    await client.query("delete from auth.users where id = $1", [authUserId]);
  } finally {
    await client.end();
  }
});

async function insertFutureSlot(
  client: Client,
  opts: { capacity: number; bookedCount?: number; isOpen?: boolean },
): Promise<{ id: string }> {
  const { rows } = await client.query<{ id: string }>(
    `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
     values ($1, now() + interval '1 hour', now() + interval '2 hours', $2, $3, $4)
     returning id`,
    [storeId, opts.capacity, opts.bookedCount ?? 0, opts.isOpen ?? true],
  );
  return rows[0];
}

describe("WBS 5.3 — generate_pickup_slots_for_store", () => {
  it("generates the expected slot count and is idempotent on rerun", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const first = await client.query<{ generate_pickup_slots_for_store: number }>(
        "select generate_pickup_slots_for_store($1, 60, 3) as generate_pickup_slots_for_store",
        [storeId],
      );
      // 07:00-19:00 at 60-minute steps = 12 slots/day * 3 days = 36.
      expect(first.rows[0].generate_pickup_slots_for_store).toBe(36);

      const second = await client.query<{ generate_pickup_slots_for_store: number }>(
        "select generate_pickup_slots_for_store($1, 60, 3) as generate_pickup_slots_for_store",
        [storeId],
      );
      expect(second.rows[0].generate_pickup_slots_for_store).toBe(0);

      const { rows: countRows } = await client.query<{ count: string }>(
        "select count(*)::text as count from pickup_slots where store_id = $1",
        [storeId],
      );
      expect(Number(countRows[0].count)).toBe(36);
    } finally {
      await client.query("delete from pickup_slots where store_id = $1", [storeId]);
      await client.end();
    }
  });

  it("a store with no opens_at/closes_at configured generates nothing (never errors)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const { rows: noHoursStore } = await client.query<{ id: string }>(
        `insert into stores (merchant_id, slug, name) values ($1, $2, 'QA No Hours') returning id`,
        [merchantId, `qa-no-hours-${Date.now()}`],
      );
      const { rows } = await client.query<{ generate_pickup_slots_for_store: number }>(
        "select generate_pickup_slots_for_store($1) as generate_pickup_slots_for_store",
        [noHoursStore[0].id],
      );
      expect(rows[0].generate_pickup_slots_for_store).toBe(0);
    });
  });
});

describe("WBS 5.3 — reserve_pickup_slot / release_pickup_slot", () => {
  it("REQUIRED: 10 genuinely parallel reservations against capacity 1 yield exactly 1 success and 9 clean failures", async () => {
    if (!dbAvailable) return;
    const setupClient = await connect();
    const slot = await insertFutureSlot(setupClient, { capacity: 1 });
    await setupClient.end();

    const clients = await Promise.all(Array.from({ length: 10 }, () => connect()));
    try {
      const results = await Promise.all(
        clients.map((client) => client.query("select * from reserve_pickup_slot($1)", [slot.id])),
      );

      const successes = results.filter((r) => r.rows.length > 0);
      const failures = results.filter((r) => r.rows.length === 0);
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(9);
      expect(successes[0].rows[0].booked_count).toBe(1);

      const verifyClient = await connect();
      try {
        const { rows } = await verifyClient.query<{ booked_count: number; is_open: boolean }>(
          "select booked_count, is_open from pickup_slots where id = $1",
          [slot.id],
        );
        expect(rows[0].booked_count).toBe(1);
        expect(rows[0].is_open).toBe(false); // booked_count reached capacity -- auto-closed.
      } finally {
        await verifyClient.end();
      }
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  });

  it("the database CHECK constraint independently rejects booked_count > capacity, even bypassing the function", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const slot = await insertFutureSlot(client, { capacity: 2, bookedCount: 2 });
      await expect(
        client.query("update pickup_slots set booked_count = capacity + 1 where id = $1", [slot.id]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  it("reserving a full slot (booked_count === capacity) returns zero rows, not an error", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const slot = await insertFutureSlot(client, { capacity: 2, bookedCount: 2, isOpen: false });
      const { rows } = await client.query("select * from reserve_pickup_slot($1)", [slot.id]);
      expect(rows).toHaveLength(0);
    });
  });

  it("reserving a past slot returns zero rows even when capacity is available", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const { rows: pastSlot } = await client.query<{ id: string }>(
        `insert into pickup_slots (store_id, slot_start, slot_end, capacity, booked_count, is_open)
         values ($1, now() - interval '2 hours', now() - interval '1 hour', 3, 0, true)
         returning id`,
        [storeId],
      );
      const { rows } = await client.query("select * from reserve_pickup_slot($1)", [pastSlot[0].id]);
      expect(rows).toHaveLength(0);
    });
  });

  it("release reopens a closed slot and decrements booked_count", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const slot = await insertFutureSlot(client, { capacity: 2, bookedCount: 2, isOpen: false });
      const { rows } = await client.query("select * from release_pickup_slot($1)", [slot.id]);
      expect(rows[0].booked_count).toBe(1);

      const { rows: after } = await client.query<{ is_open: boolean }>(
        "select is_open from pickup_slots where id = $1",
        [slot.id],
      );
      expect(after[0].is_open).toBe(true);
    });
  });

  it("release on a slot already at booked_count 0 is a guarded no-op (zero rows, never negative)", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const slot = await insertFutureSlot(client, { capacity: 2, bookedCount: 0 });
      const { rows } = await client.query("select * from release_pickup_slot($1)", [slot.id]);
      expect(rows).toHaveLength(0);
    });
  });

  it("grants: reserve_pickup_slot AND release_pickup_slot are both service_role-only (redline_reviewer CRITICAL fix — an anon grant on reserve let any unauthenticated caller exhaust a store's capacity with no order and no release path); authenticated can enqueue generation", async () => {
    if (!dbAvailable) return;
    const client = await connect();
    try {
      const { rows } = await client.query<{
        anon_can_reserve: boolean;
        authenticated_can_reserve: boolean;
        service_role_can_reserve: boolean;
        anon_can_release: boolean;
        authenticated_can_release: boolean;
        service_role_can_release: boolean;
        authenticated_can_enqueue: boolean;
        anon_can_enqueue: boolean;
      }>(
        `select
           has_function_privilege('anon', 'reserve_pickup_slot(uuid)', 'execute') as anon_can_reserve,
           has_function_privilege('authenticated', 'reserve_pickup_slot(uuid)', 'execute') as authenticated_can_reserve,
           has_function_privilege('service_role', 'reserve_pickup_slot(uuid)', 'execute') as service_role_can_reserve,
           has_function_privilege('anon', 'release_pickup_slot(uuid)', 'execute') as anon_can_release,
           has_function_privilege('authenticated', 'release_pickup_slot(uuid)', 'execute') as authenticated_can_release,
           has_function_privilege('service_role', 'release_pickup_slot(uuid)', 'execute') as service_role_can_release,
           has_function_privilege('authenticated', 'enqueue_generate_slots_job(uuid)', 'execute') as authenticated_can_enqueue,
           has_function_privilege('anon', 'enqueue_generate_slots_job(uuid)', 'execute') as anon_can_enqueue`,
      );
      expect(rows[0]).toEqual({
        anon_can_reserve: false,
        authenticated_can_reserve: false,
        service_role_can_reserve: true,
        anon_can_release: false,
        authenticated_can_release: false,
        service_role_can_release: true,
        authenticated_can_enqueue: true,
        anon_can_enqueue: false,
      });
    } finally {
      await client.end();
    }
  });

  it("enqueue_generate_slots_job rejects a store the caller does not own", async () => {
    if (!dbAvailable) return;
    await withRollback(async (client) => {
      const otherAuthUserId = randomUUID();
      const phone = `+66900${Math.floor(Math.random() * 900000 + 100000)}`;
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
        [otherAuthUserId, phone],
      );
      await client.query(
        `insert into merchants (id, auth_user_id, phone, subscription_tier)
         values (gen_random_uuid(), $1, $2, 'free') on conflict (auth_user_id) do nothing`,
        [otherAuthUserId, phone],
      );

      // set_config('request.jwt.claims', ..., true) makes auth.uid() (which
      // auth_store_ids() is built on, 0021_rls.sql SECTION 2) resolve to
      // otherAuthUserId for the rest of this transaction -- the same
      // mechanism Supabase's own PostgREST uses to carry the caller's
      // identity into `security definer` RPCs.
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: otherAuthUserId, role: "authenticated" }),
      ]);
      await client.query(`set local role authenticated`);

      await expect(
        client.query("select enqueue_generate_slots_job($1)", [storeId]),
      ).rejects.toThrow(/not owned by the caller/);
    });
  });
});
