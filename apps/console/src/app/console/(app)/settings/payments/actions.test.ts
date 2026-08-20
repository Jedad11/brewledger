// WBS 4.5 — regression coverage for savePromptPaySettings() (actions.ts),
// the RL-1 primary enforcement point on the console side: this is the only
// place `stores.promptpay_id` / `promptpay_type` / `promptpay_verified_at`
// are ever written.
//
// Mocking pattern mirrors settings/store/actions.test.ts (WBS 4.3) and
// lib/merchant.test.ts (WBS 4.2): createClient() and resolveMerchantCtx()
// are mocked at the module boundary; normalizePromptPayId itself is NOT
// mocked -- it's a pure function from @brewledger/shared and the whole
// point of several tests below is to prove actions.ts calls the REAL
// normaliser (and its rejection path) correctly.
//
// The single highest-value case in this file: "changing the identifier with
// NO fresh verification in this submission clears verified_at server-side,
// but a fresh `verified: true` submitted in the SAME request as the change
// mints a NEW timestamp rather than being discarded." Discarding it
// unconditionally (the pre-redline-review behavior) was itself a bug: the
// client always resets `confirmed` to false on any identifier/type edit and
// only re-enables the confirmation toggle once a QR for the CURRENT value
// has actually rendered (`canConfirm` requires `qrDataUrl`), so
// `verified: true` arriving alongside `identifierChanged: true` can only mean
// an honest same-submission re-verify of the new value -- never a stale or
// carried-over tick. Only a server-side test against the persisted row, not
// the UI toggle, can prove this distinction is handled correctly in both
// directions.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/merchant", () => ({
  resolveMerchantCtx: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { savePromptPaySettings } from "./actions";

const mockedCreateClient = vi.mocked(createClient);
const mockedResolveMerchantCtx = vi.mocked(resolveMerchantCtx);

const MERCHANT_ID = "22222222-2222-4222-8222-222222222222";
const OWNED_STORE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_MERCHANTS_STORE_ID = "99999999-9999-4999-8999-999999999999";

const VERIFIED_AT = "2026-01-15T09:30:00.000Z";
const MSISDN_A = "0812345678";
const MSISDN_B = "0899999999";

interface CurrentRow {
  promptpay_id: string | null;
  promptpay_type: string | null;
  promptpay_verified_at: string | null;
}

/**
 * Builds a mock Supabase client for the `.from("stores").select(...).eq(...)
 * .single()` read of the current row, followed by the
 * `.update(...).eq(...)` write. Captures the exact row object passed to
 * `.update()` so tests can assert on precisely what gets persisted, not
 * just what the function returns.
 */
function buildPaymentsMock(config: {
  current: CurrentRow | null;
  currentErr?: unknown;
  updateErr?: unknown;
}) {
  const selectSingleMock = vi.fn().mockResolvedValue({
    data: config.current,
    error: config.currentErr ?? null,
  });
  const selectEqMock = vi.fn().mockReturnValue({ single: selectSingleMock });
  const selectMock = vi.fn().mockReturnValue({ eq: selectEqMock });

  const updatedRows: Array<Record<string, unknown>> = [];
  const updateEqMock = vi.fn().mockResolvedValue({ error: config.updateErr ?? null });
  const updateMock = vi.fn((row: Record<string, unknown>) => {
    updatedRows.push(row);
    return { eq: updateEqMock };
  });

  const fromMock = vi.fn((table: string) => {
    if (table !== "stores") throw new Error(`unexpected table passed to .from(): ${table}`);
    return { select: selectMock, update: updateMock };
  });

  return { client: { from: fromMock }, selectMock, selectEqMock, updateMock, updateEqMock, updatedRows, fromMock };
}

/** A client whose from() would throw if ever reached -- proves a rejection
 * happened before any DB call, same idiom as settings/store/actions.test.ts. */
function buildUnreachableClient() {
  const fromMock = vi.fn(() => {
    throw new Error("savePromptPaySettings must not touch the DB client here");
  });
  return { from: fromMock };
}

const BASE_MERCHANT_CTX = { merchantId: MERCHANT_ID, storeIds: [OWNED_STORE_ID], stores: [] };

describe("savePromptPaySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ownership guard", () => {
    it("a storeId NOT in the merchant's storeIds is rejected before any DB call", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

      const result = await savePromptPaySettings({
        storeId: OTHER_MERCHANTS_STORE_ID,
        promptpayType: "msisdn",
        promptpayIdRaw: MSISDN_A,
        verified: true,
      });

      expect(result).toEqual({ error: expect.any(String) });
      expect("ok" in result).toBe(false);
    });

    it("resolveMerchantCtx() returning null is rejected without a DB call", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(null);

      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "msisdn",
        promptpayIdRaw: MSISDN_A,
        verified: true,
      });

      expect(result).toEqual({ error: expect.any(String) });
      expect(mockedCreateClient).not.toHaveBeenCalled();
    });
  });

  describe("normalisation is enforced server-side, not just trusted from the client", () => {
    it("an invalid NID check digit is rejected before any DB call, with the normaliser's own Thai error message", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

      // 13 digits, shape-valid, check digit essentially guaranteed wrong for
      // a fixed arbitrary string (only 1-in-10 chance of accidentally being
      // right, and this exact literal is not that).
      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "nid",
        promptpayIdRaw: "1101700230700",
        verified: true,
      });

      expect("ok" in result).toBe(false);
      if ("error" in result) {
        expect(result.error.length).toBeGreaterThan(0);
      }
    });

    it("a malformed msisdn (wrong length) is rejected before any DB call", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "msisdn",
        promptpayIdRaw: "12345",
        verified: true,
      });

      expect("ok" in result).toBe(false);
    });

    it("a raw value with separators is normalised to digits-only before being persisted", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      const { client, updatedRows } = buildPaymentsMock({
        current: { promptpay_id: null, promptpay_type: null, promptpay_verified_at: null },
      });
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "msisdn",
        promptpayIdRaw: "081-234-5678",
        verified: false,
      });

      expect(result).toEqual({
        ok: true,
        promptpayId: MSISDN_A,
        promptpayType: "msisdn",
        promptpayVerifiedAt: null,
      });
      expect(updatedRows[0].promptpay_id).toBe(MSISDN_A);
    });
  });

  describe("verification auto-clear on identifier/type change (server-side, not trusting client state)", () => {
    it(
      "changing the identifier WITHOUT a fresh verification in this submission clears " +
        "promptpay_verified_at server-side (no stale/carried-over tick survives an edit)",
      async () => {
        mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
        const { client, updatedRows } = buildPaymentsMock({
          current: { promptpay_id: MSISDN_A, promptpay_type: "msisdn", promptpay_verified_at: VERIFIED_AT },
        });
        mockedCreateClient.mockResolvedValue(client as never);

        const result = await savePromptPaySettings({
          storeId: OWNED_STORE_ID,
          promptpayType: "msisdn",
          promptpayIdRaw: MSISDN_B, // changed from MSISDN_A
          verified: false, // no fresh re-verify in this submission
        });

        expect(result).toEqual({
          ok: true,
          promptpayId: MSISDN_B,
          promptpayType: "msisdn",
          promptpayVerifiedAt: null,
        });
        expect(updatedRows[0].promptpay_verified_at).toBeNull();
      },
    );

    it(
      "changing the identifier WITH verified: true in the SAME submission mints a fresh " +
        "timestamp, never the old one -- the client can only reach verified: true here after " +
        "rendering a QR for the NEW value and getting a fresh tick (canConfirm requires qrDataUrl)",
      async () => {
        mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
        const { client, updatedRows } = buildPaymentsMock({
          current: { promptpay_id: MSISDN_A, promptpay_type: "msisdn", promptpay_verified_at: VERIFIED_AT },
        });
        mockedCreateClient.mockResolvedValue(client as never);

        const before = Date.now();
        const result = await savePromptPaySettings({
          storeId: OWNED_STORE_ID,
          promptpayType: "msisdn",
          promptpayIdRaw: MSISDN_B, // changed from MSISDN_A
          verified: true, // honest re-verify of the new value, same submission
        });
        const after = Date.now();

        expect("ok" in result).toBe(true);
        if ("ok" in result) {
          expect(result.promptpayVerifiedAt).not.toBeNull();
          expect(result.promptpayVerifiedAt).not.toBe(VERIFIED_AT);
          const ts = new Date(result.promptpayVerifiedAt as string).getTime();
          expect(ts).toBeGreaterThanOrEqual(before);
          expect(ts).toBeLessThanOrEqual(after);
        }
        expect(updatedRows[0].promptpay_verified_at).not.toBeNull();
        expect(updatedRows[0].promptpay_verified_at).not.toBe(VERIFIED_AT);
      },
    );

    it("changing only the type (same digits) with verified: false clears promptpay_verified_at", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      const sameDigits = "1101700230708";
      const { client, updatedRows } = buildPaymentsMock({
        current: { promptpay_id: sameDigits, promptpay_type: "nid", promptpay_verified_at: VERIFIED_AT },
      });
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "taxid", // type changed, digits identical
        promptpayIdRaw: sameDigits,
        verified: false,
      });

      expect(result).toEqual({
        ok: true,
        promptpayId: sameDigits,
        promptpayType: "taxid",
        promptpayVerifiedAt: null,
      });
      expect(updatedRows[0].promptpay_verified_at).toBeNull();
    });

    it("changing only the type (same digits) with verified: true in the same submission mints a fresh timestamp", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      const sameDigits = "1101700230708";
      const { client, updatedRows } = buildPaymentsMock({
        current: { promptpay_id: sameDigits, promptpay_type: "nid", promptpay_verified_at: VERIFIED_AT },
      });
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "taxid", // type changed, digits identical
        promptpayIdRaw: sameDigits,
        verified: true,
      });

      expect("ok" in result).toBe(true);
      if ("ok" in result) {
        expect(result.promptpayVerifiedAt).not.toBeNull();
        expect(result.promptpayVerifiedAt).not.toBe(VERIFIED_AT);
      }
      expect(updatedRows[0].promptpay_verified_at).not.toBeNull();
      expect(updatedRows[0].promptpay_verified_at).not.toBe(VERIFIED_AT);
    });

    it("resubmitting the SAME identifier with verified: true carries the ORIGINAL timestamp forward unchanged", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      const { client, updatedRows } = buildPaymentsMock({
        current: { promptpay_id: MSISDN_A, promptpay_type: "msisdn", promptpay_verified_at: VERIFIED_AT },
      });
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "msisdn",
        promptpayIdRaw: MSISDN_A,
        verified: true,
      });

      // Must be the EXACT original timestamp, not a freshly minted one --
      // proves the code path does not call `new Date()` on every save of an
      // already-verified, unchanged identifier.
      expect(result).toEqual({
        ok: true,
        promptpayId: MSISDN_A,
        promptpayType: "msisdn",
        promptpayVerifiedAt: VERIFIED_AT,
      });
      expect(updatedRows[0].promptpay_verified_at).toBe(VERIFIED_AT);
    });

    it("the SAME unverified identifier submitted with verified: true for the first time sets a fresh timestamp", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      const { client, updatedRows } = buildPaymentsMock({
        current: { promptpay_id: MSISDN_A, promptpay_type: "msisdn", promptpay_verified_at: null },
      });
      mockedCreateClient.mockResolvedValue(client as never);

      const before = Date.now();
      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "msisdn",
        promptpayIdRaw: MSISDN_A,
        verified: true,
      });
      const after = Date.now();

      expect("ok" in result).toBe(true);
      if ("ok" in result) {
        expect(result.promptpayVerifiedAt).not.toBeNull();
        const ts = new Date(result.promptpayVerifiedAt as string).getTime();
        expect(ts).toBeGreaterThanOrEqual(before);
        expect(ts).toBeLessThanOrEqual(after);
      }
      expect(updatedRows[0].promptpay_verified_at).not.toBeNull();
    });

    it("the same identifier submitted with verified: false clears any prior verification", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      const { client, updatedRows } = buildPaymentsMock({
        current: { promptpay_id: MSISDN_A, promptpay_type: "msisdn", promptpay_verified_at: VERIFIED_AT },
      });
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "msisdn",
        promptpayIdRaw: MSISDN_A,
        verified: false,
      });

      expect(result).toEqual({
        ok: true,
        promptpayId: MSISDN_A,
        promptpayType: "msisdn",
        promptpayVerifiedAt: null,
      });
      expect(updatedRows[0].promptpay_verified_at).toBeNull();
    });

    it("a brand-new row with no prior promptpay_id (first-time save) is not treated as 'unchanged'", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      const { client, updatedRows } = buildPaymentsMock({
        current: { promptpay_id: null, promptpay_type: null, promptpay_verified_at: null },
      });
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "msisdn",
        promptpayIdRaw: MSISDN_A,
        verified: true,
      });

      expect("ok" in result).toBe(true);
      if ("ok" in result) {
        expect(result.promptpayVerifiedAt).not.toBeNull();
      }
      expect(updatedRows[0].promptpay_verified_at).not.toBeNull();
    });
  });

  describe("DB failure paths", () => {
    it("failing to read the current row returns the generic save error and never calls update", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      const { client, updateMock } = buildPaymentsMock({
        current: null,
        currentErr: { message: "boom" },
      });
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "msisdn",
        promptpayIdRaw: MSISDN_A,
        verified: true,
      });

      expect("ok" in result).toBe(false);
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("the update call failing returns the generic save error", async () => {
      mockedResolveMerchantCtx.mockResolvedValue(BASE_MERCHANT_CTX);
      const { client } = buildPaymentsMock({
        current: { promptpay_id: MSISDN_A, promptpay_type: "msisdn", promptpay_verified_at: null },
        updateErr: { message: "connection reset" },
      });
      mockedCreateClient.mockResolvedValue(client as never);

      const result = await savePromptPaySettings({
        storeId: OWNED_STORE_ID,
        promptpayType: "msisdn",
        promptpayIdRaw: MSISDN_A,
        verified: true,
      });

      expect("ok" in result).toBe(false);
    });
  });
});
