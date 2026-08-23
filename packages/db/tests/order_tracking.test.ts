// WBS 5.10 — Customer Order Tracking (No Login): RPC/DB-level coverage for
// public_order_status(p_order_code) and public_order_lookup(p_phone,
// p_order_code) (packages/db/migrations/0021_rls.sql, amended by
// 0037_normalize_order_lookup_phone.sql) — the sole data source for
// apps/shop's /o/[code] and /track screens (git commit 2e78655).
//
// Same discipline as packages/db/tests/rls.test.ts: real local Postgres +
// PostgREST via the anon key, fixtures inserted with a plain (autocommit)
// `pg` Client (bypassing RLS for setup, same as service_role), never
// rolled back — PostgREST's own connection can't see an open transaction on
// a separate `pg` connection under READ COMMITTED isolation. Cleanup via
// each fixture's own `cleanup()`.
//
// Owns, from the WBS 5.10 acceptance criteria:
//   - "A phone number alone returns nothing; both values are required"
//     (enumeration test)
//   - "The tracking response contains only order code, status, pick-up
//     time, item names and quantities" (RL-3 field allow-list)
//   - "An order code from another store cannot be viewed by guessing"
//   - phone normalization (migration 0037's own fix)
//   - terminal-state pass-through (PENDING_PAYMENT / ACCEPTED / PREPARING /
//     READY / COLLECTED / CANCELLED / REFUNDED / EXPIRED / unknown code)
//
// Rate limiting (migration 0036) is HTTP-layer behavior (the Edge
// Function's `if (phone)` branch, not the RPC itself) — covered in
// supabase/functions/_tests/order_tracking_http.test.ts instead, over a
// real `supabase functions serve` process.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connect, isReachable } from "./helpers/db";
import { anonClient, isApiReachable } from "./helpers/supabase-clients";

let ready = false;
let pg: Client;

beforeAll(async () => {
  const dbUp = await isReachable();
  const apiUp = dbUp && (await isApiReachable());
  ready = dbUp && apiUp;
  if (!ready) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[order_tracking.test.ts] SKIPPING — local Postgres and/or the local " +
        "Supabase HTTP API is not reachable. Run `supabase start` first. " +
        "This is a SKIP, not a pass.\n",
    );
    return;
  }
  pg = await connect();
});

afterAll(async () => {
  if (pg) await pg.end();
});

const FORBIDDEN_KEY_RE = /cost|margin|profit|fee|expense|stock|cogs|merchant_id|auth_user_id|payload|balance|escrow|wallet|payout/i;
// WBS 5.11 (packages/db/migrations/0051_console_cancel_order_refund.sql)
// deliberately widened both RPCs' RETURNS TABLE with cancel_reason and
// refund_status — confirmed RL-3-safe operational state, not cost/margin/
// stock/aggregate data (docs/db/wbs_5_11_refund_design.md §4). Allow-list
// updated to match; refund_resolved_by/refund_resolved_at remain absent —
// see the dedicated "does not leak resolution audit fields" coverage in
// console_cancel_order_refund.test.ts.
const ALLOWED_SNAKE_KEYS = ["cancel_reason", "item_name", "order_code", "pickup_at", "quantity", "refund_status", "status"].sort();

function assertOnlyAllowListedKeys(rows: Array<Record<string, unknown>>): void {
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    const keys = Object.keys(row).sort();
    expect(keys).toEqual(ALLOWED_SNAKE_KEYS);
    for (const key of keys) {
      expect(FORBIDDEN_KEY_RE.test(key)).toBe(false);
    }
  }
}

let fixtureCounter = 0;
function nextSuffix(label: string): string {
  fixtureCounter += 1;
  return `ot-${label}-${Date.now()}-${fixtureCounter}`;
}

interface StoreFixture {
  storeId: string;
  cleanup: () => Promise<void>;
}

/** One merchant + one published store, no orders yet — orders are inserted per-test below. */
async function createStoreFixture(client: Client, label: string): Promise<StoreFixture> {
  const suffix = nextSuffix(label);
  const phone = `+66809${String(Math.abs(hashCode(suffix))).slice(0, 6).padStart(6, "0")}`;
  const email = `qa-order-tracking-${suffix}@brewledger.app`;

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
    const { rows: merchantRows } = await client.query(
      `insert into merchants (auth_user_id, phone) values ($1, $2)
       on conflict (auth_user_id) do update set phone = excluded.phone
       returning id`,
      [authUserId, phone],
    );
    const merchantId = merchantRows[0].id as string;

    const slug = `qa-order-tracking-${suffix}`;
    const { rows: storeRows } = await client.query(
      `insert into stores (merchant_id, slug, name, is_published, promptpay_id, promptpay_type, promptpay_verified_at)
       values ($1, $2, $3, true, '0899999999', 'msisdn', now()) returning id`,
      [merchantId, slug, `QA Order Tracking Store ${suffix}`],
    );
    return { storeId: storeRows[0].id as string, cleanup };
  } catch (err) {
    await cleanup().catch(() => undefined);
    throw err;
  }
}

interface OrderFixture {
  orderId: string;
  orderCode: string;
}

async function insertOrder(
  client: Client,
  storeId: string,
  opts: { status: string; phone: string | null; itemName?: string; quantity?: number; codeSuffix?: string },
): Promise<OrderFixture> {
  const orderCode = `QAOT${(opts.codeSuffix ?? nextSuffix("code")).replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`.slice(0, 40);
  const { rows } = await client.query(
    `insert into orders (store_id, order_code, customer_name, customer_phone, status, subtotal_satang, total_satang)
     values ($1, $2, 'QA Customer', $3, $4, 6500, 6500) returning id`,
    [storeId, orderCode, opts.phone, opts.status],
  );
  const orderId = rows[0].id as string;

  await client.query(
    `insert into order_items (order_id, store_id, item_name_snapshot, quantity, unit_price_snapshot_satang)
     values ($1, $2, $3, $4, 6500)`,
    [orderId, storeId, opts.itemName ?? "QA Latte", opts.quantity ?? 1],
  );

  return { orderId, orderCode };
}

function hashCode(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// 1. Enumeration — "a phone number alone must never enumerate orders"
// ---------------------------------------------------------------------------
describe("enumeration: public_order_lookup requires BOTH phone and order_code together", () => {
  let store: StoreFixture;
  let order: OrderFixture;
  const REAL_PHONE = "+66811110001";

  beforeAll(async () => {
    if (!ready) return;
    store = await createStoreFixture(pg, "enum");
    order = await insertOrder(pg, store.storeId, { status: "ACCEPTED", phone: REAL_PHONE, codeSuffix: "enumreal" });
  });

  afterAll(async () => {
    if (!ready) return;
    await store?.cleanup();
  });

  it("sanity: the real phone + real code DOES return the order (fixture built correctly)", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.rpc("public_order_lookup", {
      p_phone: REAL_PHONE,
      p_order_code: order.orderCode,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("100 distinct phone numbers, no code (empty order_code) — zero rows every single time", async () => {
    if (!ready) return;
    const anon = anonClient();
    let totalRows = 0;
    for (let i = 0; i < 100; i += 1) {
      const phone = `+668${String(10000000 + i).padStart(8, "0")}`;
      // Never accidentally the real fixture phone.
      expect(phone).not.toBe(REAL_PHONE);
      const { data, error } = await anon.rpc("public_order_lookup", {
        p_phone: phone,
        p_order_code: "",
      });
      expect(error).toBeNull();
      totalRows += (data ?? []).length;
    }
    expect(totalRows).toBe(0);
  });

  it("100 distinct WRONG phone numbers paired with the one REAL order_code — zero rows every time (phone can't be paired with a guessed/known code)", async () => {
    if (!ready) return;
    const anon = anonClient();
    let totalRows = 0;
    for (let i = 0; i < 100; i += 1) {
      const phone = `+669${String(20000000 + i).padStart(8, "0")}`;
      expect(phone).not.toBe(REAL_PHONE);
      const { data, error } = await anon.rpc("public_order_lookup", {
        p_phone: phone,
        p_order_code: order.orderCode,
      });
      expect(error).toBeNull();
      totalRows += (data ?? []).length;
    }
    expect(totalRows).toBe(0);
  });

  it("code-only: the REAL order_code with an EMPTY phone returns zero rows (both values required, not an OR)", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.rpc("public_order_lookup", {
      p_phone: "",
      p_order_code: order.orderCode,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  it("code-only: the REAL order_code with a whitespace-only phone also returns zero rows", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.rpc("public_order_lookup", {
      p_phone: "   ",
      p_order_code: order.orderCode,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. RL-3 field allow-list, at the RPC layer (below the DTO/schema layer
//    packages/shared/src/serializers/public.schema.test.ts already covers)
// ---------------------------------------------------------------------------
describe("RL-3: public_order_status / public_order_lookup return exactly the allow-listed columns", () => {
  let store: StoreFixture;
  let order: OrderFixture;
  const phone = "+66811110002";

  beforeAll(async () => {
    if (!ready) return;
    store = await createStoreFixture(pg, "allowlist");
    order = await insertOrder(pg, store.storeId, { status: "READY", phone, codeSuffix: "allowlist" });
  });

  afterAll(async () => {
    if (!ready) return;
    await store?.cleanup();
  });

  it("public_order_status: exactly {order_code, status, pickup_at, item_name, quantity}", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.rpc("public_order_status", { p_order_code: order.orderCode });
    expect(error).toBeNull();
    assertOnlyAllowListedKeys((data ?? []) as Array<Record<string, unknown>>);
  });

  it("public_order_lookup: same exact allow-list, no extra field leaks through the phone+code branch", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.rpc("public_order_lookup", { p_phone: phone, p_order_code: order.orderCode });
    expect(error).toBeNull();
    assertOnlyAllowListedKeys((data ?? []) as Array<Record<string, unknown>>);
  });
});

// ---------------------------------------------------------------------------
// 3. Cross-store / guessed-code isolation
// ---------------------------------------------------------------------------
describe("an order code from another store, or a mutated code, cannot be viewed by guessing", () => {
  let storeA: StoreFixture;
  let storeB: StoreFixture;
  let orderA: OrderFixture;
  let orderB: OrderFixture;

  beforeAll(async () => {
    if (!ready) return;
    storeA = await createStoreFixture(pg, "guess-a");
    storeB = await createStoreFixture(pg, "guess-b");
    orderA = await insertOrder(pg, storeA.storeId, {
      status: "ACCEPTED",
      phone: "+66811110003",
      itemName: "QA Store A Latte",
      codeSuffix: "guessa",
    });
    orderB = await insertOrder(pg, storeB.storeId, {
      status: "ACCEPTED",
      phone: "+66811110004",
      itemName: "QA Store B Latte",
      codeSuffix: "guessb",
    });
  });

  afterAll(async () => {
    if (!ready) return;
    await storeA?.cleanup();
    await storeB?.cleanup();
  });

  it("store A's code returns only store A's item; store B's code returns only store B's item (no cross-contamination)", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data: dataA } = await anon.rpc("public_order_status", { p_order_code: orderA.orderCode });
    expect((dataA ?? []).map((r: { item_name: string }) => r.item_name)).toEqual(["QA Store A Latte"]);

    const { data: dataB } = await anon.rpc("public_order_status", { p_order_code: orderB.orderCode });
    expect((dataB ?? []).map((r: { item_name: string }) => r.item_name)).toEqual(["QA Store B Latte"]);
  });

  it("a single mutated character in a real order_code returns zero rows, not a partial/prefix match", async () => {
    if (!ready) return;
    const anon = anonClient();
    const lastChar = orderA.orderCode.slice(-1);
    const mutated = orderA.orderCode.slice(0, -1) + (lastChar === "X" ? "Y" : "X");
    expect(mutated).not.toBe(orderA.orderCode);

    const { data, error } = await anon.rpc("public_order_status", { p_order_code: mutated });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  it("order_code comparison is case-sensitive: lower-casing a real (uppercase) code returns zero rows", async () => {
    if (!ready) return;
    const anon = anonClient();
    expect(orderA.orderCode).toBe(orderA.orderCode.toUpperCase()); // fixture is uppercase by construction
    const { data, error } = await anon.rpc("public_order_status", { p_order_code: orderA.orderCode.toLowerCase() });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  it("an entirely unknown code returns zero rows, not an error", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.rpc("public_order_status", { p_order_code: "QAOT-DOES-NOT-EXIST" });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("store B's own phone cannot be paired with store A's order code (cross-tenant phone/code pairing rejected)", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.rpc("public_order_lookup", {
      p_phone: "+66811110004", // store B's real customer phone
      p_order_code: orderA.orderCode, // store A's real code
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Phone normalization (migration 0037) — the actual bug fixed this
//    session: public_order_lookup previously compared with a bare `=`
//    against orders.customer_phone, which checkout_create_order (0029)
//    always stores as +66XXXXXXXXX. A human re-typing their own number in
//    any other shape could never match their own order before this fix.
// ---------------------------------------------------------------------------
describe("phone normalization (migration 0037): every realistic human-typed shape matches the stored +66XXXXXXXXX value", () => {
  let store: StoreFixture;
  let order: OrderFixture;
  const STORED_PHONE = "+66812345678"; // what checkout_create_order (0029) would have written

  beforeAll(async () => {
    if (!ready) return;
    store = await createStoreFixture(pg, "phone-norm");
    order = await insertOrder(pg, store.storeId, { status: "ACCEPTED", phone: STORED_PHONE, codeSuffix: "phonenorm" });
  });

  afterAll(async () => {
    if (!ready) return;
    await store?.cleanup();
  });

  const humanShapes = [
    "0812345678", // leading-0 local format, no separators
    "081-234-5678", // leading-0, dashed
    "081 234 5678", // leading-0, spaced
    "66812345678", // country code, no plus
    "+66812345678", // already E.164 (identity case)
    "+66 81 234 5678", // E.164 with spaces
  ];

  it.each(humanShapes)("%s matches the stored +66812345678 order", async (typedPhone) => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.rpc("public_order_lookup", {
      p_phone: typedPhone,
      p_order_code: order.orderCode,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("a genuinely different phone number, in the same normalized shape, still does not match", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.rpc("public_order_lookup", {
      p_phone: "0899999999",
      p_order_code: order.orderCode,
    });
    expect(error).toBeNull();
    expect((data ?? []).length).toBe(0);
  });

  it("regression proof: the bare-equals bug this migration fixed — WITHOUT normalization, '081-234-5678' could never equal '+66812345678'", () => {
    // Not a DB call — documents the exact defect migration 0037's own header
    // describes, so this test file fails loudly if someone reverts the
    // normalization logic to a literal string-equality check. Typed as
    // `string`, not string-literal types, so this stays a runtime
    // inequality check rather than TS narrowing it to a compile-time
    // "these literals never overlap" error (TS2367).
    const typed: string = "081-234-5678";
    const stored: string = "+66812345678";
    expect(typed === stored).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Terminal states — every value orders.status's check constraint allows
//    passes through public_order_status/public_order_lookup verbatim, plus
//    the unknown-code case. This is the read-path this WBS entry owns;
//    state-machine LEGALITY of a transition is WBS 5.7's own test domain
//    (packages/db/tests/order_lifecycle.test.ts) — these fixtures write
//    `orders.status` directly as service-role-equivalent setup, the same
//    way every other fixture builder in this suite does.
// ---------------------------------------------------------------------------
describe("terminal states: every orders.status value renders through the RPCs unchanged", () => {
  const ALL_STATUSES = [
    "PENDING_PAYMENT",
    "ACCEPTED",
    "PREPARING",
    "READY",
    "COLLECTED",
    "CANCELLED",
    "REFUNDED",
    "EXPIRED",
  ] as const;

  let store: StoreFixture;
  const ordersByStatus = new Map<string, OrderFixture>();

  beforeAll(async () => {
    if (!ready) return;
    store = await createStoreFixture(pg, "terminal");
    for (const status of ALL_STATUSES) {
      const fixture = await insertOrder(pg, store.storeId, {
        status,
        phone: "+66811119999",
        codeSuffix: `term-${status}`,
      });
      ordersByStatus.set(status, fixture);
    }
  });

  afterAll(async () => {
    if (!ready) return;
    await store?.cleanup();
  });

  it.each(ALL_STATUSES)("status=%s round-trips verbatim through public_order_status, one row, no error", async (status) => {
    if (!ready) return;
    const anon = anonClient();
    const fixture = ordersByStatus.get(status)!;
    const { data, error } = await anon.rpc("public_order_status", { p_order_code: fixture.orderCode });
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect((data as Array<{ status: string }>)[0].status).toBe(status);
  });

  it("an unknown order code (never issued) is indistinguishable in shape from a real empty result — zero rows, no error, no 'invalid format' hint", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.rpc("public_order_status", { p_order_code: "QAOT-NEVER-ISSUED-000" });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});
