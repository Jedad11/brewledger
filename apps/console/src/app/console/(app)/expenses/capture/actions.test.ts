// WBS 6.1 testing block — createPurchaseInvoice / uploadPurchaseInvoicePhoto.
// Mocking pattern mirrors ../../menu/[id]/actions.test.ts (WBS 4.4).
//
// This entry's own risk is different from 4.4's: it doesn't need to prove
// "succeeds with the minimum required fields" (RL-2's zero-BOM concern
// doesn't apply to a purchase bill) — it needs to prove the entry stays
// inside the boundary drawn in the WBS 6.1 dispatch: no purchase_line_items
// write (that's WBS 6.4's confirm transaction, after ingredient mapping
// resolves a base_unit), no job_queue row (nothing runs in the background,
// OCR is deferred), and image_path stays NULL with no storage call at all
// when no photo is attached.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/merchant", () => ({
  resolveMerchantCtx: vi.fn(),
}));
vi.mock("@brewledger/shared/dist/storage/bills", () => ({
  uploadCompressedBill: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { resolveMerchantCtx } from "@/lib/merchant";
import { uploadCompressedBill } from "@brewledger/shared/dist/storage/bills";
import {
  createPurchaseInvoice,
  uploadPurchaseInvoicePhoto,
  type CreatePurchaseInvoiceInput,
} from "./actions";

const mockedCreateClient = vi.mocked(createClient);
const mockedResolveMerchantCtx = vi.mocked(resolveMerchantCtx);
const mockedUploadCompressedBill = vi.mocked(uploadCompressedBill);

const MERCHANT_ID = "22222222-2222-4222-8222-222222222222";
const OWNED_STORE_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_STORE_ID = "99999999-9999-4999-8999-999999999999";
const INVOICE_ID = "55555555-5555-4555-8555-555555555555";

const BASE_INPUT: CreatePurchaseInvoiceInput = {
  storeId: OWNED_STORE_ID,
  vendorName: "ซัพพลายเออร์ ก.ไก่ เทรดดิ้ง",
  invoiceDate: "2026-08-22",
  lineItems: [
    { name: "นมสด ตราหมี 1 ลิตร", qtyText: "12", unitText: "ขวด", unitCostSatang: 4500 },
    { name: "เมล็ดกาแฟคั่วกลาง 1 กก.", qtyText: "2", unitText: "ถุง", unitCostSatang: 42000 },
  ],
};

/**
 * Records every table `.from()` is called with (the job_queue /
 * purchase_line_items assertions below read this list directly) and gives
 * `purchase_invoices` a working insert/select/single + update/eq/eq chain.
 */
function buildSuccessClient(opts: { insertedRows: Array<Record<string, unknown>>; calledTables: string[] }) {
  const fromMock = vi.fn((table: string) => {
    opts.calledTables.push(table);
    if (table === "purchase_invoices") {
      return {
        insert: (row: Record<string, unknown>) => {
          opts.insertedRows.push(row);
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: INVOICE_ID }, error: null }),
            }),
          };
        },
        update: (row: Record<string, unknown>) => {
          opts.insertedRows.push(row);
          return {
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          };
        },
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });
  return { from: fromMock, storage: {} };
}

function buildUnreachableClient() {
  return {
    from: vi.fn(() => {
      throw new Error("must not touch the DB client for a rejected storeId");
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createPurchaseInvoice — WBS 6.1 scope boundary", () => {
  it("inserts exactly one purchase_invoices row, ocr_status 'manual', image_path unset (stays NULL), no purchase_line_items or job_queue touched", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({
      merchantId: MERCHANT_ID,
      subscriptionTier: "free",
      storeIds: [OWNED_STORE_ID],
      stores: [],
    });
    const insertedRows: Array<Record<string, unknown>> = [];
    const calledTables: string[] = [];
    mockedCreateClient.mockResolvedValue(buildSuccessClient({ insertedRows, calledTables }) as never);

    const result = await createPurchaseInvoice(BASE_INPUT);

    expect(result).toEqual({ ok: true, invoiceId: INVOICE_ID });
    expect(calledTables).toEqual(["purchase_invoices"]);
    expect(calledTables).not.toContain("purchase_line_items");
    expect(calledTables).not.toContain("job_queue");

    const row = insertedRows[0];
    expect(row.store_id).toBe(OWNED_STORE_ID);
    expect(row.ocr_status).toBe("manual");
    expect("image_path" in row).toBe(false);
    expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["job_type", "job_queue_id"]));
  });

  it("computes total_satang as the sum of qty * unitCostSatang across lines (12*4500 + 2*42000)", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({
      merchantId: MERCHANT_ID,
      subscriptionTier: "free",
      storeIds: [OWNED_STORE_ID],
      stores: [],
    });
    const insertedRows: Array<Record<string, unknown>> = [];
    mockedCreateClient.mockResolvedValue(buildSuccessClient({ insertedRows, calledTables: [] }) as never);

    await createPurchaseInvoice(BASE_INPUT);

    expect(insertedRows[0].total_satang).toBe(12 * 4500 + 2 * 42000);
  });

  it("parks the typed line items verbatim in raw_ocr_output as { source: 'manual', version: 1, lineItems }, no base-unit conversion applied", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({
      merchantId: MERCHANT_ID,
      subscriptionTier: "free",
      storeIds: [OWNED_STORE_ID],
      stores: [],
    });
    const insertedRows: Array<Record<string, unknown>> = [];
    mockedCreateClient.mockResolvedValue(buildSuccessClient({ insertedRows, calledTables: [] }) as never);

    await createPurchaseInvoice(BASE_INPUT);

    const raw = insertedRows[0].raw_ocr_output as { source: string; version: number; lineItems: unknown[] };
    expect(raw.source).toBe("manual");
    expect(raw.version).toBe(1);
    expect(raw.lineItems).toEqual([
      { name: "นมสด ตราหมี 1 ลิตร", qtyText: "12", unitText: "ขวด", unitCostSatang: 4500, totalSatang: 54000 },
      { name: "เมล็ดกาแฟคั่วกลาง 1 กก.", qtyText: "2", unitText: "ถุง", unitCostSatang: 42000, totalSatang: 84000 },
    ]);
  });

  it("rejects zero line items without a DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({
      merchantId: MERCHANT_ID,
      subscriptionTier: "free",
      storeIds: [OWNED_STORE_ID],
      stores: [],
    });

    const result = await createPurchaseInvoice({ ...BASE_INPUT, lineItems: [] });

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("rejects the whole submission when a surviving line item's qtyText is non-numeric, instead of coercing it to a ฿0 line", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({
      merchantId: MERCHANT_ID,
      subscriptionTier: "free",
      storeIds: [OWNED_STORE_ID],
      stores: [],
    });

    const result = await createPurchaseInvoice({
      ...BASE_INPUT,
      lineItems: [{ name: "นมสด", qtyText: "abc", unitText: "ขวด", unitCostSatang: 4500 }],
    });

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("rejects the whole submission when unitCostSatang is negative, even if qtyText is valid", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({
      merchantId: MERCHANT_ID,
      subscriptionTier: "free",
      storeIds: [OWNED_STORE_ID],
      stores: [],
    });

    const result = await createPurchaseInvoice({
      ...BASE_INPUT,
      lineItems: [{ name: "นมสด", qtyText: "12", unitText: "ขวด", unitCostSatang: -4500 }],
    });

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it("a storeId not owned by the merchant is rejected before any DB call", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({
      merchantId: MERCHANT_ID,
      subscriptionTier: "free",
      storeIds: [OWNED_STORE_ID],
      stores: [],
    });
    mockedCreateClient.mockResolvedValue(buildUnreachableClient() as never);

    const result = await createPurchaseInvoice({ ...BASE_INPUT, storeId: OTHER_STORE_ID });

    expect(result).toEqual({ error: expect.any(String) });
  });
});

describe("uploadPurchaseInvoicePhoto — private bills bucket only when a photo is actually attached", () => {
  it("no photo attached: createPurchaseInvoice alone never calls uploadCompressedBill (no bills-bucket object is ever created)", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({
      merchantId: MERCHANT_ID,
      subscriptionTier: "free",
      storeIds: [OWNED_STORE_ID],
      stores: [],
    });
    mockedCreateClient.mockResolvedValue(
      buildSuccessClient({ insertedRows: [], calledTables: [] }) as never,
    );

    await createPurchaseInvoice(BASE_INPUT);

    expect(mockedUploadCompressedBill).not.toHaveBeenCalled();
  });

  it("with a photo: uploads via uploadCompressedBill and updates image_path, scoped by id AND store_id", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({
      merchantId: MERCHANT_ID,
      subscriptionTier: "free",
      storeIds: [OWNED_STORE_ID],
      stores: [],
    });
    mockedUploadCompressedBill.mockResolvedValue(`${OWNED_STORE_ID}/${INVOICE_ID}.jpg`);
    const insertedRows: Array<Record<string, unknown>> = [];
    const updateEqSpy = vi.fn();
    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== "purchase_invoices") throw new Error(`unexpected table: ${table}`);
        return {
          update: (row: Record<string, unknown>) => {
            insertedRows.push(row);
            return {
              eq: (col1: string, val1: unknown) => {
                updateEqSpy(col1, val1);
                return {
                  eq: (col2: string, val2: unknown) => {
                    updateEqSpy(col2, val2);
                    return Promise.resolve({ error: null });
                  },
                };
              },
            };
          },
        };
      }),
    } as never);

    const formData = new FormData();
    formData.set("file", new Blob(["x"], { type: "image/jpeg" }), "bill.jpg");

    const result = await uploadPurchaseInvoicePhoto(INVOICE_ID, OWNED_STORE_ID, formData);

    expect(result).toEqual({ ok: true });
    expect(mockedUploadCompressedBill).toHaveBeenCalledWith(expect.anything(), expect.any(Blob), OWNED_STORE_ID, INVOICE_ID);
    expect(insertedRows[0]).toEqual({ image_path: `${OWNED_STORE_ID}/${INVOICE_ID}.jpg` });
    expect(updateEqSpy).toHaveBeenCalledWith("id", INVOICE_ID);
    expect(updateEqSpy).toHaveBeenCalledWith("store_id", OWNED_STORE_ID);
  });

  it("a storeId not owned by the merchant is rejected before any upload attempt", async () => {
    mockedResolveMerchantCtx.mockResolvedValue({
      merchantId: MERCHANT_ID,
      subscriptionTier: "free",
      storeIds: [OWNED_STORE_ID],
      stores: [],
    });

    const formData = new FormData();
    formData.set("file", new Blob(["x"], { type: "image/jpeg" }), "bill.jpg");

    const result = await uploadPurchaseInvoicePhoto(INVOICE_ID, OTHER_STORE_ID, formData);

    expect(result).toEqual({ error: expect.any(String) });
    expect(mockedUploadCompressedBill).not.toHaveBeenCalled();
  });
});
