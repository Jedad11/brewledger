"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Button, MoneyValue } from "@brewledger/ui";
import { thbToSatang } from "@brewledger/shared/dist/money";
import { compressImage } from "@brewledger/shared/dist/storage/compress";
import { createPurchaseInvoice, uploadPurchaseInvoicePhoto, type PurchaseLineItemInput } from "./actions";

const PHOTO_UPLOAD_ERROR = "อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง";

interface DraftLineItem {
  key: string;
  name: string;
  qtyText: string;
  unitText: string;
  unitCostThb: string;
}

let draftKeyCounter = 0;
function nextDraftKey(): string {
  draftKeyCounter += 1;
  return `draft-${draftKeyCounter}`;
}

function blankLineItem(): DraftLineItem {
  return { key: nextDraftKey(), name: "", qtyText: "", unitText: "", unitCostThb: "" };
}

function todayDateInput(): string {
  return new Date().toISOString().slice(0, 10);
}

// null (not 0) for an incomplete row — the running total below must not
// treat a half-typed row as a real ฿0 line, same "unknown is null" posture
// RL-2 takes for cost everywhere else in this console.
function lineTotalSatang(item: DraftLineItem): number | null {
  if (item.name.trim().length === 0) return null;
  const qty = Number(item.qtyText);
  const unitCostThb = Number(item.unitCostThb);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(unitCostThb) || unitCostThb <= 0) return null;
  return Math.round(qty * thbToSatang(unitCostThb));
}

function isCompleteRow(item: DraftLineItem): boolean {
  return lineTotalSatang(item) !== null;
}

export function PurchaseCaptureForm({ storeId }: { storeId: string }) {
  const router = useRouter();

  const [vendorName, setVendorName] = React.useState("");
  const [invoiceDate, setInvoiceDate] = React.useState(todayDateInput);
  const [lineItems, setLineItems] = React.useState<DraftLineItem[]>(() => [blankLineItem()]);
  const [photoFile, setPhotoFile] = React.useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = React.useState<string | null>(null);

  const [invoiceId, setInvoiceId] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [photoError, setPhotoError] = React.useState<string | null>(null);

  const committed = invoiceId !== null;
  const completeRows = lineItems.filter(isCompleteRow);
  const canSubmit = completeRows.length > 0 && !saving && !committed;
  const totalSatang =
    completeRows.length > 0 ? completeRows.reduce((sum, item) => sum + (lineTotalSatang(item) ?? 0), 0) : null;

  function updateLineItem(key: string, patch: Partial<DraftLineItem>) {
    setLineItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function addLineItem() {
    setLineItems((rows) => [...rows, blankLineItem()]);
  }
  function removeLineItem(key: string) {
    setLineItems((rows) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows));
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setPhotoError(null);
  }

  async function uploadPhotoIfAny(targetInvoiceId: string): Promise<boolean> {
    if (!photoFile) return true;
    try {
      const compressed = await compressImage(photoFile);
      const formData = new FormData();
      formData.set("file", compressed, "bill.jpg");
      const result = await uploadPurchaseInvoicePhoto(targetInvoiceId, storeId, formData);
      if ("error" in result) throw new Error(result.error);
      return true;
    } catch (err) {
      console.error("purchase invoice photo upload failed", err);
      setPhotoError(PHOTO_UPLOAD_ERROR);
      return false;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSaving(true);
    setError(null);
    setPhotoError(null);

    const input: PurchaseLineItemInput[] = completeRows.map((item) => ({
      name: item.name.trim(),
      qtyText: item.qtyText.trim(),
      unitText: item.unitText.trim(),
      unitCostSatang: thbToSatang(Number(item.unitCostThb)),
    }));

    const result = await createPurchaseInvoice({
      storeId,
      vendorName: vendorName.trim() || null,
      invoiceDate,
      lineItems: input,
    });

    if ("error" in result) {
      setSaving(false);
      setError(result.error);
      return;
    }

    setInvoiceId(result.invoiceId);
    const photoOk = await uploadPhotoIfAny(result.invoiceId);
    setSaving(false);

    // Photo failure never discards the already-saved invoice — the form
    // stays put (now locked, committed === true) with a retry / continue-
    // without-it path instead of silently losing the typed line items.
    if (photoOk) {
      router.push(`/console/expenses/${result.invoiceId}/review`);
    }
  }

  async function retryPhotoUpload() {
    if (!invoiceId) return;
    setSaving(true);
    const photoOk = await uploadPhotoIfAny(invoiceId);
    setSaving(false);
    if (photoOk) {
      router.push(`/console/expenses/${invoiceId}/review`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl font-bold leading-[1.35] text-ink">บันทึกบิลซื้อ</h1>
      <p className="note-plain">บันทึกต้นทุนจากบิลผู้ขาย</p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Card>
          <div className="flex flex-col gap-4">
            <Input
              label="ผู้ขาย"
              placeholder="เช่น ซัพพลายเออร์ ก.ไก่ เทรดดิ้ง"
              value={vendorName}
              onChange={(e) => setVendorName(e.target.value)}
              disabled={committed}
            />
            <Input
              label="วันที่"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              disabled={committed}
            />
          </div>
        </Card>

        <Card>
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-bold">รายการในบิล</h2>
            {lineItems.map((item) => (
              <div key={item.key} className="flex flex-col gap-2 rounded-(--radius-card) border border-black/10 p-3">
                <Input
                  label="ชื่อ"
                  placeholder="เช่น นมสด ตราหมี 1 ลิตร"
                  value={item.name}
                  onChange={(e) => updateLineItem(item.key, { name: e.target.value })}
                  disabled={committed}
                />
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      label="จำนวน"
                      inputMode="decimal"
                      placeholder="5"
                      value={item.qtyText}
                      onChange={(e) => updateLineItem(item.key, { qtyText: e.target.value })}
                      disabled={committed}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Input
                      label="หน่วย"
                      placeholder="เช่น กก., ขวด, ถุง"
                      value={item.unitText}
                      onChange={(e) => updateLineItem(item.key, { unitText: e.target.value })}
                      disabled={committed}
                    />
                  </div>
                </div>
                <Input
                  label="ราคาต่อหน่วย (บาท)"
                  inputMode="decimal"
                  placeholder="120"
                  value={item.unitCostThb}
                  onChange={(e) => updateLineItem(item.key, { unitCostThb: e.target.value })}
                  disabled={committed}
                />
                <div className="flex items-center justify-between">
                  <span className="note-plain">รวม</span>
                  <MoneyValue value={lineTotalSatang(item)} role="cost" />
                </div>
                {lineItems.length > 1 ? (
                  <Button type="button" variant="quiet" onClick={() => removeLineItem(item.key)} disabled={committed}>
                    ลบ
                  </Button>
                ) : null}
              </div>
            ))}
            <Button type="button" variant="outline" onClick={addLineItem} disabled={committed}>
              เพิ่มรายการ
            </Button>

            <div className="flex items-center justify-between border-t border-black/10 pt-3">
              <span className="font-bold">รวมทั้งบิล</span>
              <MoneyValue value={totalSatang} role="cost" size="lg" />
            </div>
          </div>
        </Card>

        <Card>
          <div className="field">
            <label>รูปภาพ (ไม่บังคับ)</label>
            <label className="oc-drop">
              {photoPreviewUrl ? (
                <img
                  src={photoPreviewUrl}
                  alt=""
                  style={{ width: 72, height: 72 }}
                  className="rounded-(--radius-input) object-cover"
                />
              ) : (
                <div className="oc-photo" style={{ width: 72, height: 72 }} aria-hidden="true" />
              )}
              <span className="note-plain">แตะเพื่อถ่ายหรือเลือกรูป</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                onChange={handlePhotoChange}
                disabled={committed}
              />
            </label>
          </div>
        </Card>

        {error ? (
          <p role="alert" className="err">
            {error}
          </p>
        ) : null}

        {!committed ? (
          <Button type="submit" wet loading={saving} disabled={!canSubmit}>
            บันทึก
          </Button>
        ) : photoError ? (
          <div className="flex flex-col gap-2">
            <p role="alert" className="err">
              {photoError}
            </p>
            <Button type="button" wet loading={saving} onClick={retryPhotoUpload}>
              ลองอัปโหลดรูปอีกครั้ง
            </Button>
            <Button type="button" variant="outline" onClick={() => router.push(`/console/expenses/${invoiceId}/review`)}>
              ไปหน้าตรวจบิลโดยไม่มีรูป
            </Button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
