// @vitest-environment jsdom
//
// WBS 6.1 testing block — the two behaviors that need a live, mounted
// component (same jsdom + @testing-library/react infra
// StoreProfileForm.test.tsx introduced, see its own header comment for
// why renderToStaticMarkup can't do this):
//
//   - "an EXIF-rotated / oversized fixture compresses/uploads correctly" is
//     already proven at the pure-function level by
//     packages/shared/src/storage/compress.test.ts (see that file's own
//     header for why compressImage() itself — the DOM-dependent wrapper —
//     isn't exercised there, or here: no headless canvas binary in this
//     sandbox). What THIS entry owns and that file can't prove is the
//     wiring: does the upload path actually call compressImage before
//     handing the result to the server action. compressImage is mocked
//     wholesale below; call order is what's asserted.
//   - submitting with no photo attached must never touch compression or
//     the photo-upload action at all (so no bills-bucket object is ever
//     created and image_path stays NULL — the server-side half of that
//     claim is actions.test.ts's job).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockCreatePurchaseInvoice = vi.fn();
const mockUploadPurchaseInvoicePhoto = vi.fn();
const mockCompressImage = vi.fn();
const mockPush = vi.fn();

vi.mock("./actions", () => ({
  createPurchaseInvoice: (...args: unknown[]) => mockCreatePurchaseInvoice(...args),
  uploadPurchaseInvoicePhoto: (...args: unknown[]) => mockUploadPurchaseInvoicePhoto(...args),
}));
vi.mock("@brewledger/shared/dist/storage/compress", () => ({
  compressImage: (...args: unknown[]) => mockCompressImage(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}));

// jsdom ships no createObjectURL implementation — only the photo-preview
// <img src> needs it, nothing under test reads the value back.
global.URL.createObjectURL = vi.fn(() => "blob:mock");

const { PurchaseCaptureForm } = await import("./PurchaseCaptureForm");

const STORE_ID = "33333333-3333-4333-8333-333333333333";
const INVOICE_ID = "55555555-5555-4555-8555-555555555555";

afterEach(() => {
  cleanup();
  mockCreatePurchaseInvoice.mockReset();
  mockUploadPurchaseInvoicePhoto.mockReset();
  mockCompressImage.mockReset();
  mockPush.mockReset();
});

function fillOneLineItem() {
  fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "นมสด ตราหมี 1 ลิตร" } });
  fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "12" } });
  fireEvent.change(screen.getByLabelText("หน่วย"), { target: { value: "ขวด" } });
  fireEvent.change(screen.getByLabelText("ราคาต่อหน่วย (บาท)"), { target: { value: "45" } });
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "บันทึก" }) as HTMLButtonElement;
}

describe("PurchaseCaptureForm — photo wiring (WBS 6.1)", () => {
  it("with a photo attached: compresses BEFORE uploading, then navigates to the review route", async () => {
    mockCreatePurchaseInvoice.mockResolvedValue({ ok: true, invoiceId: INVOICE_ID });
    const compressedBlob = new Blob(["compressed"], { type: "image/jpeg" });
    mockCompressImage.mockResolvedValue(compressedBlob);
    mockUploadPurchaseInvoicePhoto.mockResolvedValue({ ok: true });

    const { container } = render(<PurchaseCaptureForm storeId={STORE_ID} />);
    fillOneLineItem();

    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["raw"], "bill.jpg", { type: "image/jpeg" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    fireEvent.click(submitButton());

    await waitFor(() => expect(mockUploadPurchaseInvoicePhoto).toHaveBeenCalledTimes(1));

    expect(mockCompressImage).toHaveBeenCalledTimes(1);
    expect(mockCompressImage.mock.invocationCallOrder[0]).toBeLessThan(
      mockUploadPurchaseInvoicePhoto.mock.invocationCallOrder[0],
    );
    expect(mockCompressImage).toHaveBeenCalledWith(file);

    const [, storeIdArg, formDataArg] = mockUploadPurchaseInvoicePhoto.mock.calls[0];
    expect(storeIdArg).toBe(STORE_ID);
    // FormData.set(name, blob, filename) wraps the Blob in a File per spec
    // (that's why `.get("file")` isn't reference-equal to compressedBlob) --
    // size/type is what proves the COMPRESSED blob was sent, not the
    // original multi-MB photo File.
    const sentFile = (formDataArg as FormData).get("file") as File;
    expect(sentFile.size).toBe(compressedBlob.size);
    expect(sentFile.type).toBe(compressedBlob.type);

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/console/expenses/${INVOICE_ID}/review`));
  });

  it("with no photo attached: never calls compressImage or uploadPurchaseInvoicePhoto at all", async () => {
    mockCreatePurchaseInvoice.mockResolvedValue({ ok: true, invoiceId: INVOICE_ID });

    render(<PurchaseCaptureForm storeId={STORE_ID} />);
    fillOneLineItem();

    fireEvent.click(submitButton());

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/console/expenses/${INVOICE_ID}/review`));

    expect(mockCompressImage).not.toHaveBeenCalled();
    expect(mockUploadPurchaseInvoicePhoto).not.toHaveBeenCalled();
  });

  it("submit is disabled with zero complete line items -- no incomplete row is ever sent", () => {
    render(<PurchaseCaptureForm storeId={STORE_ID} />);
    expect(submitButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "นมสด" } });
    expect(submitButton().disabled).toBe(true);
  });
});
