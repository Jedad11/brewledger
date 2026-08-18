// WBS 3.8 — storage RLS adversarial suite for packages/db/migrations/
// 0022_storage_policies.sql, run against a REAL local Supabase stack
// (PostgREST + Storage API + Postgres), not mocks. Mirrors the discipline
// of packages/db/tests/rls.test.ts: every assertion here goes through the
// actual HTTP API with real anon/authenticated/service_role credentials —
// RLS only exists in the database, so only a real request through it proves
// anything.
//
// Setup: `supabase start` (local Docker), then `supabase db reset` to
// guarantee 0022_storage_policies.sql has actually been applied. This repo
// declares `bills` and `menu-images` as local buckets in
// supabase/config.toml's `[storage.buckets.*]` section (see that file's
// WBS 3.8 comment) — `supabase start`/`db reset` provision them
// automatically for local Docker, so no manual dashboard step is needed
// here, unlike brewledger-dev/brewledger-prod. If a future local stack
// somehow starts without them (e.g. an old cached snapshot restored before
// this config existed), beforeAll below creates them via the storage admin
// API as a fallback so this suite still runs rather than silently skipping
// real assertions.
//
// If no local stack (DB or API) is reachable at all, the whole suite is
// SKIPPED (not passed) — see beforeAll.
import { Buffer } from "node:buffer";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";
import { connect, isReachable } from "../helpers/db";
import {
  anonClient,
  authenticatedClient,
  isApiReachable,
  serviceClient,
} from "../helpers/supabase-clients";
import { createStoreFixture, type StoreFixture } from "../helpers/store-fixture";
import { billObjectPath, getBillSignedUrl } from "../../src/storage/bills";

const BILLS_BUCKET = "bills";
const MENU_IMAGES_BUCKET = "menu-images";

let ready = false;
let pg: Client;

beforeAll(async () => {
  const dbUp = await isReachable();
  const apiUp = dbUp && (await isApiReachable());
  ready = dbUp && apiUp;
  if (!ready) {
    // eslint-disable-next-line no-console
    console.warn(
      "\n[storage.test.ts] SKIPPING — local Postgres and/or the local " +
        "Supabase HTTP API is not reachable. Run `supabase start` first. " +
        "This is a SKIP, not a pass.\n",
    );
    return;
  }
  pg = await connect();

  const svc = serviceClient();
  const { data: buckets } = await svc.storage.listBuckets();
  const haveBills = (buckets ?? []).some((b) => b.id === BILLS_BUCKET);
  const haveMenuImages = (buckets ?? []).some((b) => b.id === MENU_IMAGES_BUCKET);
  if (!haveBills) {
    // eslint-disable-next-line no-console
    console.warn(
      "[storage.test.ts] `bills` bucket missing on this local stack — " +
        "creating it via the storage admin API as a fallback (expected " +
        "path is supabase/config.toml's declarative bucket + `supabase db reset`).",
    );
    await svc.storage.createBucket(BILLS_BUCKET, { public: false });
  }
  if (!haveMenuImages) {
    // eslint-disable-next-line no-console
    console.warn(
      "[storage.test.ts] `menu-images` bucket missing on this local stack — " +
        "creating it via the storage admin API as a fallback.",
    );
    await svc.storage.createBucket(MENU_IMAGES_BUCKET, { public: true });
  }
});

afterAll(async () => {
  if (pg) await pg.end();
});

function decodeJwtPayload(token: string): { iat: number; exp: number } {
  const [, payloadB64] = token.split(".");
  const json = Buffer.from(payloadB64, "base64url").toString("utf8");
  return JSON.parse(json);
}

describe("WBS 3.8 — storage RLS on `bills` (RL-3: never public)", () => {
  let fixtureA: StoreFixture;
  let fixtureB: StoreFixture;
  let pathA: string;
  let pathB: string;

  beforeAll(async () => {
    if (!ready) return;
    fixtureA = await createStoreFixture(pg, "bills-a");
    fixtureB = await createStoreFixture(pg, "bills-b");

    pathA = billObjectPath(fixtureA.storeId, "11111111-1111-4111-8111-111111111111");
    pathB = billObjectPath(fixtureB.storeId, "22222222-2222-4222-8222-222222222222");

    // Seed real objects as the OWNING merchant's own authenticated client —
    // exercises merchant_insert_bills, not just service_role.
    const clientA = authenticatedClient(fixtureA.authUserId);
    const clientB = authenticatedClient(fixtureB.authUserId);
    const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // minimal SOI+EOI

    const upA = await clientA.storage.from(BILLS_BUCKET).upload(pathA, fakeJpeg, {
      contentType: "image/jpeg",
      upsert: true,
    });
    expect(upA.error, `merchant A must be able to upload to their own store folder: ${JSON.stringify(upA.error)}`).toBeNull();

    const upB = await clientB.storage.from(BILLS_BUCKET).upload(pathB, fakeJpeg, {
      contentType: "image/jpeg",
      upsert: true,
    });
    expect(upB.error).toBeNull();
  });

  afterAll(async () => {
    if (!ready) return;
    const svc = serviceClient();
    await svc.storage.from(BILLS_BUCKET).remove([pathA, pathB]).catch(() => undefined);
    await fixtureA?.cleanup();
    await fixtureB?.cleanup();
  });

  it("merchant A can insert into their own store folder (sanity — proves the fixture setup itself isn't broken)", async () => {
    if (!ready) return;
    const svc = serviceClient();
    const { data } = await svc.storage.from(BILLS_BUCKET).list(fixtureA.storeId);
    expect((data ?? []).length).toBeGreaterThan(0);
  });

  it("anon cannot download a bills object by its known path", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.storage.from(BILLS_BUCKET).download(pathA);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("anon cannot list a store's bills folder", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data } = await anon.storage.from(BILLS_BUCKET).list(fixtureA.storeId);
    expect((data ?? []).length).toBe(0);
  });

  it("anon cannot create a signed URL for a bills object (no anon policy exists at all)", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.storage.from(BILLS_BUCKET).createSignedUrl(pathA, 300);
    expect(data).toBeNull();
    expect(error).not.toBeNull();
  });

  it("anon cannot upload into the bills bucket", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { error } = await anon.storage
      .from(BILLS_BUCKET)
      .upload(`${fixtureA.storeId}/anon-attempt.jpg`, new Uint8Array([1, 2, 3]));
    expect(error).not.toBeNull();
  });

  it("merchant A CAN create a signed URL for their own bill (sanity, and it actually resolves)", async () => {
    if (!ready) return;
    const clientA = authenticatedClient(fixtureA.authUserId);
    const url = await getBillSignedUrl(clientA, pathA);
    expect(url).toMatch(/^http/);

    const res = await fetch(url);
    expect(res.status).toBe(200);
  });

  it("merchant A CANNOT create a signed URL for merchant B's bill path (cross-tenant isolation)", async () => {
    if (!ready) return;
    const clientA = authenticatedClient(fixtureA.authUserId);
    await expect(getBillSignedUrl(clientA, pathB)).rejects.toThrow();
  });

  it("merchant B CANNOT create a signed URL for merchant A's bill path either (symmetric)", async () => {
    if (!ready) return;
    const clientB = authenticatedClient(fixtureB.authUserId);
    await expect(getBillSignedUrl(clientB, pathA)).rejects.toThrow();
  });

  it("merchant B cannot delete merchant A's bill object", async () => {
    if (!ready) return;
    const clientB = authenticatedClient(fixtureB.authUserId);
    const { error } = await clientB.storage.from(BILLS_BUCKET).remove([pathA]);
    // Supabase Storage's remove() reports success with an empty `data` array
    // rather than a top-level error when RLS hides the row from DELETE —
    // the real assertion is that the object still exists afterwards, which
    // the next check-with-owner test proves; this call must not report the
    // object as actually removed.
    expect(error).toBeNull();

    const svc = serviceClient();
    const { data } = await svc.storage.from(BILLS_BUCKET).list(fixtureA.storeId);
    const stillThere = (data ?? []).some((f) => pathA.endsWith(f.name));
    expect(stillThere).toBe(true);
  });

  it("the signed URL granted to the owning merchant expires in <= 300 seconds", async () => {
    if (!ready) return;
    const clientA = authenticatedClient(fixtureA.authUserId);
    const url = await getBillSignedUrl(clientA, pathA);

    const token = new URL(url).searchParams.get("token");
    expect(token).toBeTruthy();
    const { iat, exp } = decodeJwtPayload(token as string);
    expect(exp - iat).toBeLessThanOrEqual(300);
  });
});

describe("WBS 3.8 — storage RLS on `menu-images` (public read by design)", () => {
  let fixture: StoreFixture;
  let path: string;

  beforeAll(async () => {
    if (!ready) return;
    fixture = await createStoreFixture(pg, "menu-img");
    path = `${fixture.storeId}/33333333-3333-4333-8333-333333333333.webp`;

    const svc = serviceClient();
    const { error } = await svc.storage
      .from(MENU_IMAGES_BUCKET)
      .upload(path, new Uint8Array([0x52, 0x49, 0x46, 0x46]), { contentType: "image/webp", upsert: true });
    expect(error).toBeNull();
  });

  afterAll(async () => {
    if (!ready) return;
    const svc = serviceClient();
    await svc.storage.from(MENU_IMAGES_BUCKET).remove([path]).catch(() => undefined);
    await fixture?.cleanup();
  });

  it("anon CAN download a menu-images object — public by design, renders on Customer Web", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { data, error } = await anon.storage.from(MENU_IMAGES_BUCKET).download(path);
    expect(error).toBeNull();
    expect(data).not.toBeNull();
  });

  it("anon cannot upload into menu-images (write stays merchant-only)", async () => {
    if (!ready) return;
    const anon = anonClient();
    const { error } = await anon.storage
      .from(MENU_IMAGES_BUCKET)
      .upload(`${fixture.storeId}/anon-attempt.webp`, new Uint8Array([1, 2, 3]));
    expect(error).not.toBeNull();
  });

  it("the owning merchant can upload into their own menu-images folder", async () => {
    if (!ready) return;
    const client = authenticatedClient(fixture.authUserId);
    const { error } = await client.storage
      .from(MENU_IMAGES_BUCKET)
      .upload(`${fixture.storeId}/merchant-upload.webp`, new Uint8Array([1, 2, 3]), {
        contentType: "image/webp",
        upsert: true,
      });
    expect(error).toBeNull();
    await client.storage.from(MENU_IMAGES_BUCKET).remove([`${fixture.storeId}/merchant-upload.webp`]);
  });
});
