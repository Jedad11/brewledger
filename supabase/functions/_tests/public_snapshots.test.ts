// WBS 3.7 §7 test contract — "Response snapshot, one per public endpoint".
//
// Target: the four public-* Edge Functions, hit over real HTTP against a
// local `supabase functions serve` process (not an in-process import of the
// handler modules — see the reasoning at the bottom of this file's header
// comment block). Each response body is compared, byte-for-byte on every
// STABLE field, against a committed fixture in __snapshots__/. Volatile
// fields (gen_random_uuid() ids, "now"-relative timestamps) are normalized
// to a placeholder on both sides before comparison — see
// helpers/clients.ts's normalizeForSnapshot. A field added to (or removed
// from, or renamed in) a DTO changes the response's shape and therefore
// fails this comparison, which is the whole point: nobody can widen what
// Customer Web receives without a human editing a committed fixture file in
// the same diff.
//
// Prerequisites (documented, not automated — same discipline as
// packages/db/tests/rls.test.ts): `supabase start`, then `supabase db
// reset` (applies all migrations + packages/db/seed.sql's demo-cafe
// fixture), then `supabase functions serve --no-verify-jwt --import-map
// supabase/functions/deno.json` (or `pnpm functions:serve -- --no-verify-jwt`)
// running in a separate process. --no-verify-jwt matters for
// console_auth_guard.test.ts, not this file, but both share one server.
//
// If the local stack or the functions server isn't reachable, every test in
// this file is SKIPPED (not passed) via the `ready` guard below.
//
// Why HTTP-against-a-served-function, not a direct TS import of
// public-store/index.ts etc: the handlers are Deno modules — `Deno.serve`,
// `npm:@supabase/supabase-js@2` specifiers, `Deno.env.get` — none of which
// run in a Node/vitest process without a large amount of shimming that
// would itself become an untested translation layer standing between the
// test and the real deployed artifact. Hitting the actual `supabase
// functions serve` process over HTTP, the same way a real browser request
// would, proves the real Deno runtime + real import map + real handler code
// all actually cooperate to produce this exact response — closer to the
// "RLS/triggers live in the database, a mock proves nothing" principle this
// whole test suite already follows for Postgres, applied one layer up to
// the Edge Function runtime.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  anonClient,
  functionUrl,
  isFunctionReachable,
  LOCAL_ANON_KEY,
  normalizeForSnapshot,
  serviceClient,
} from "./helpers/clients";

const SNAPSHOT_DIR = fileURLToPath(new URL("./__snapshots__/", import.meta.url));

function loadSnapshot(name: string): unknown {
  return JSON.parse(readFileSync(`${SNAPSHOT_DIR}${name}.json`, "utf8"));
}

async function getJson(name: string, query: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${functionUrl(name)}${query}`, {
    headers: { apikey: LOCAL_ANON_KEY },
  });
  const body = await res.json();
  return { status: res.status, body };
}

let ready = false;
const service = serviceClient();
const anon = anonClient();

let storeId: string;
let fixtureSlotId: string | null = null;
let fixtureOrderId: string | null = null;

beforeAll(async () => {
  const reachable = await isFunctionReachable("public-store");
  if (!reachable) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[public_snapshots.test.ts] SKIPPING — the local Edge Functions " +
        "server isn't reachable at http://127.0.0.1:54321/functions/v1/. " +
        "Run `supabase start`, `supabase db reset`, then " +
        "`supabase functions serve --no-verify-jwt --import-map " +
        "supabase/functions/deno.json` in a separate process first. This " +
        "is a SKIP, not a pass.\n",
    );
    return;
  }
  ready = true;

  const { data: store, error } = await service
    .from("stores")
    .select("id")
    .eq("slug", "demo-cafe")
    .single();
  if (error || !store) {
    throw new Error(
      `[public_snapshots.test.ts] demo-cafe store not found via service_role — ` +
        `has \`supabase db reset\` been run (packages/db/seed.sql)? ${error?.message ?? ""}`,
    );
  }
  storeId = store.id as string;

  // public-slots fixture: today's seeded slots (packages/db/seed.sql, 07:00-
  // 10:00 same-day) are past `now()` by the time any test runs, and RLS's
  // anon SELECT policy on pickup_slots requires slot_start > now() — so the
  // seed alone can never produce a snapshot-able response for this endpoint.
  // Insert one deterministic-shape (not deterministic-value — see
  // normalizeForSnapshot) future slot via service_role, clean it up after.
  const slotStart = new Date(Date.now() + 25 * 60 * 60 * 1000); // +25h, clear of "today"
  const slotEnd = new Date(slotStart.getTime() + 15 * 60 * 1000);
  const { data: slot, error: slotErr } = await service
    .from("pickup_slots")
    .insert({
      store_id: storeId,
      slot_start: slotStart.toISOString(),
      slot_end: slotEnd.toISOString(),
      capacity: 5,
      booked_count: 2,
      is_open: true,
    })
    .select("id")
    .single();
  if (slotErr || !slot) {
    throw new Error(`[public_snapshots.test.ts] failed to insert fixture slot: ${slotErr?.message}`);
  }
  fixtureSlotId = slot.id as string;

  // public-order-status fixture: a real order + order_item, no pickup slot
  // (pickup_slot_id is nullable — keeps this fixture independent of the
  // slots fixture above) so pickupAt is deterministically null.
  const { data: order, error: orderErr } = await service
    .from("orders")
    .insert({
      store_id: storeId,
      order_code: "QASNAP01",
      customer_name: "QA Snapshot",
      customer_phone: "+66899999999",
      status: "PENDING_PAYMENT",
      subtotal_satang: 13000,
      total_satang: 13000,
    })
    .select("id")
    .single();
  if (orderErr || !order) {
    throw new Error(`[public_snapshots.test.ts] failed to insert fixture order: ${orderErr?.message}`);
  }
  fixtureOrderId = order.id as string;

  const { error: itemErr } = await service.from("order_items").insert({
    order_id: fixtureOrderId,
    store_id: storeId,
    item_name_snapshot: "Latte",
    quantity: 2,
    unit_price_snapshot_satang: 6500,
  });
  if (itemErr) {
    throw new Error(`[public_snapshots.test.ts] failed to insert fixture order_item: ${itemErr.message}`);
  }
});

afterAll(async () => {
  if (fixtureOrderId) {
    await service.from("order_items").delete().eq("order_id", fixtureOrderId);
    await service.from("orders").delete().eq("id", fixtureOrderId);
  }
  if (fixtureSlotId) {
    await service.from("pickup_slots").delete().eq("id", fixtureSlotId);
  }
});

describe("public-store response snapshot", () => {
  it("matches the committed fixture for demo-cafe", async () => {
    if (!ready) return;
    const { status, body } = await getJson("public-store", "?slug=demo-cafe");
    expect(status).toBe(200);
    expect(normalizeForSnapshot(body)).toEqual(loadSnapshot("public-store"));
  });

  it("404s for a nonexistent slug with no body detail leak", async () => {
    if (!ready) return;
    const { status, body } = await getJson("public-store", "?slug=does-not-exist");
    expect(status).toBe(404);
    expect(body).toEqual({ error: "store not found" });
  });
});

describe("public-menu response snapshot", () => {
  it("matches the committed fixture for demo-cafe, including the zero-BOM Butter Cookie", async () => {
    if (!ready) return;
    const { status, body } = await getJson("public-menu", "?slug=demo-cafe");
    expect(status).toBe(200);
    expect(normalizeForSnapshot(body)).toEqual(loadSnapshot("public-menu"));
  });

  it("every item's categoryId genuinely resolves to the returned category's id (pre-normalization)", async () => {
    if (!ready) return;
    const { body } = await getJson("public-menu", "?slug=demo-cafe");
    const menu = body as { categories: Array<{ id: string }>; items: Array<{ categoryId: string | null }> };
    const categoryIds = new Set(menu.categories.map((c) => c.id));
    for (const item of menu.items) {
      expect(item.categoryId === null || categoryIds.has(item.categoryId)).toBe(true);
    }
  });
});

describe("public-slots response snapshot", () => {
  it("matches the committed fixture for one open, non-full, future slot", async () => {
    if (!ready) return;
    const { status, body } = await getJson("public-slots", "?slug=demo-cafe");
    expect(status).toBe(200);
    expect(normalizeForSnapshot(body)).toEqual(loadSnapshot("public-slots"));
  });
});

describe("public-order-status response snapshot", () => {
  it("matches the committed fixture for a code-only lookup", async () => {
    if (!ready) return;
    const { status, body } = await getJson("public-order-status", "?code=QASNAP01");
    expect(status).toBe(200);
    expect(normalizeForSnapshot(body)).toEqual(loadSnapshot("public-order-status"));
  });

  it("returns the identical shape for a code+correct-phone lookup", async () => {
    if (!ready) return;
    const { status, body } = await getJson(
      "public-order-status",
      "?code=QASNAP01&phone=%2B66899999999",
    );
    expect(status).toBe(200);
    expect(normalizeForSnapshot(body)).toEqual(loadSnapshot("public-order-status"));
  });

  it("returns an empty array for code+wrong-phone (AND, not OR)", async () => {
    if (!ready) return;
    const { status, body } = await getJson(
      "public-order-status",
      "?code=QASNAP01&phone=%2B66800000000",
    );
    expect(status).toBe(200);
    expect(body).toEqual([]);
  });

  it("400s when code is missing", async () => {
    if (!ready) return;
    const { status, body } = await getJson("public-order-status", "");
    expect(status).toBe(400);
    expect(body).toEqual({ error: "code is required" });
  });
});

describe("sanity — anon client sees the same demo-cafe data the functions serve", () => {
  it("anon REST also sees the published demo-cafe store (proves the fixture isn't empty)", async () => {
    if (!ready) return;
    const { data, error } = await anon.from("stores").select("slug").eq("slug", "demo-cafe");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});
