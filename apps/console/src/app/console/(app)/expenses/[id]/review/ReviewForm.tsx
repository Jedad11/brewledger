"use client";

// WBS 6.4 -- Purchase Confirmation Screen (Manual): the client half of
// /console/expenses/{id}/review.
//
// ARCHITECTURAL RULE THIS SCREEN ENFORCES: nothing writes to
// ingredients.current_unit_cost_satang until the merchant taps "ยืนยัน"
// below, even though every field on this screen was typed by the merchant
// themselves in WBS 6.1 -- a fat-fingered price would silently corrupt the
// cost of every menu item using that ingredient, and the merchant would only
// discover it as a profit figure they cannot explain. Nothing in this
// component calls confirmPurchaseInvoice except handleConfirm, and
// handleConfirm only ever runs from the confirm button's onClick.
//
// OCR is deferred (Phase 6.0 banner) -- every field here was typed, not
// extracted, so this screen deliberately carries NONE of the deferred
// confidence-driven UI described in the WBS 6.4 entry's own <details> block:
// no per-field confidence score, no amber/low-confidence styling, no
// confidence-ordered focus, no arithmetic-mismatch banner. ConfidenceField
// (packages/ui) is not used anywhere in this file for that reason.
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Button, MoneyValue } from "@brewledger/ui";
import { thbToSatang } from "@brewledger/shared/dist/money";
import {
  toBaseUnit,
  costPerBaseUnit,
  costPerHumanUnit,
  type BaseUnit,
  type PurchaseUnit,
} from "@brewledger/costing/dist/units";
import {
  createIngredientInline,
  confirmPurchaseInvoice,
  type ConfirmLineInput,
  type ChangedIngredient,
} from "./actions";

const NAME_REQUIRED = "กรอกชื่อวัตถุดิบ";

export interface ReviewIngredientOption {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  currentCostSatang: number | null;
  packSize: number | null;
  affectedMenuItemCount: number;
}

export interface ReviewLineDraft {
  name: string;
  qtyText: string;
  unitText: string;
  unitCostThb: string;
}

const UNMAPPED = "";
const CREATE_NEW = "__new__";

const PURCHASE_UNIT_LABELS: Record<PurchaseUnit, string> = {
  kg: "กก.",
  g: "ก.",
  L: "ล.",
  ml: "มล.",
  dozen: "โหล",
  pack: "แพ็ค",
  piece: "ชิ้น",
};

const NEW_INGREDIENT_BASE_UNIT_LABELS: Record<BaseUnit, string> = {
  g: "กรัม (ซื้อเป็น กก.)",
  ml: "มิลลิลิตร (ซื้อเป็น ล.)",
  piece: "ชิ้น",
};

function purchaseUnitOptionsFor(baseUnit: BaseUnit, packSizeAvailable: boolean): PurchaseUnit[] {
  if (baseUnit === "g") return ["kg", "g"];
  if (baseUnit === "ml") return ["L", "ml"];
  return packSizeAvailable ? ["piece", "dozen", "pack"] : ["piece", "dozen"];
}

function guessPurchaseUnit(unitText: string, baseUnit: BaseUnit): PurchaseUnit {
  const t = unitText.trim().toLowerCase();
  if (baseUnit === "g") return /กก|กิโล|kilo|\bkg\b/.test(t) ? "kg" : "g";
  if (baseUnit === "ml") return /ลิตร|^ล\.?$|litre|liter|\bl\b/.test(t) ? "L" : "ml";
  if (/โหล|dozen/.test(t)) return "dozen";
  if (/แพ็ค|แพค|\bpack\b/.test(t)) return "pack";
  return "piece";
}

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Exact/near-exact match is enough here (WBS 6.4's own prompt: no OCR
 * confidence score to threshold against) -- best textual match first, then
 * alphabetical, so the merchant sees the most likely candidates at the top
 * of the dropdown without a Thai-aware fuzzy matcher (that belongs to WBS
 * 6.7's suggested-BOM matcher, a distinct feature). */
function sortedIngredientOptions(options: ReviewIngredientOption[], typedName: string): ReviewIngredientOption[] {
  const needle = normalize(typedName);
  function score(option: ReviewIngredientOption): number {
    const hay = normalize(option.name);
    if (hay === needle) return 2;
    if (needle.length > 0 && (hay.includes(needle) || needle.includes(hay))) return 1;
    return 0;
  }
  return [...options].sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, "th"));
}

function exactMatch(options: ReviewIngredientOption[], typedName: string): ReviewIngredientOption | null {
  const needle = normalize(typedName);
  return options.find((o) => normalize(o.name) === needle) ?? null;
}

interface DraftLine {
  key: string;
  name: string;
  qtyText: string;
  unitText: string;
  unitCostThb: string;
  purchaseUnit: PurchaseUnit;
  ingredientId: string; // UNMAPPED | CREATE_NEW | a real ingredient id
  newName: string;
  newBaseUnit: BaseUnit;
  newPackSizeText: string;
  createError: string | null;
  creating: boolean;
}

let draftKeyCounter = 0;
function nextDraftKey(): string {
  draftKeyCounter += 1;
  return `review-${draftKeyCounter}`;
}

function draftFromInitial(item: ReviewLineDraft, options: ReviewIngredientOption[]): DraftLine {
  const match = exactMatch(options, item.name);
  const baseUnit = match?.baseUnit ?? "g";
  return {
    key: nextDraftKey(),
    name: item.name,
    qtyText: item.qtyText,
    unitText: item.unitText,
    unitCostThb: item.unitCostThb,
    purchaseUnit: guessPurchaseUnit(item.unitText, baseUnit),
    ingredientId: match ? match.id : UNMAPPED,
    newName: item.name,
    newBaseUnit: "g",
    newPackSizeText: "",
    createError: null,
    creating: false,
  };
}

interface LineConversion {
  qtyBaseUnit: number;
  unitCostSatang: number;
  totalSatang: number;
}

function computeConversion(line: DraftLine, ingredient: ReviewIngredientOption | undefined): LineConversion | null {
  const qty = Number(line.qtyText);
  const unitCostThb = Number(line.unitCostThb);
  if (!Number.isFinite(qty) || qty <= 0) return null;
  if (!Number.isFinite(unitCostThb) || unitCostThb < 0) return null;
  const totalSatang = Math.round(qty * thbToSatang(unitCostThb));

  if (!ingredient) return { qtyBaseUnit: 0, unitCostSatang: 0, totalSatang };

  const packSize = line.purchaseUnit === "pack" ? (ingredient.packSize ?? undefined) : undefined;
  try {
    const qtyBaseUnit = toBaseUnit(qty, line.purchaseUnit, ingredient.baseUnit, packSize);
    const rawCost = costPerBaseUnit(totalSatang, qty, line.purchaseUnit, ingredient.baseUnit, packSize);
    return { qtyBaseUnit, unitCostSatang: Math.round(rawCost), totalSatang };
  } catch {
    return null;
  }
}

function formatHumanCost(costPerBaseUnitSatang: number, baseUnit: BaseUnit): string {
  const { satangPerHumanUnit, label } = costPerHumanUnit(costPerBaseUnitSatang, baseUnit);
  const baht = satangPerHumanUnit / 100;
  return `${baht.toLocaleString("th-TH", { maximumFractionDigits: 2 })} บาท/${label}`;
}

export function ReviewForm({
  storeId,
  invoiceId,
  vendorName: initialVendorName,
  invoiceDate: initialInvoiceDate,
  imageUrl,
  initialLines,
  ingredientOptions: initialIngredientOptions,
}: {
  storeId: string;
  invoiceId: string;
  vendorName: string;
  invoiceDate: string;
  imageUrl: string | null;
  initialLines: ReviewLineDraft[];
  ingredientOptions: ReviewIngredientOption[];
}) {
  const router = useRouter();

  const [ingredientOptions, setIngredientOptions] = React.useState(initialIngredientOptions);
  const [vendorName, setVendorName] = React.useState(initialVendorName);
  const [invoiceDate, setInvoiceDate] = React.useState(initialInvoiceDate);
  const [lines, setLines] = React.useState<DraftLine[]>(() =>
    initialLines.map((item) => draftFromInitial(item, initialIngredientOptions)),
  );
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmedChanges, setConfirmedChanges] = React.useState<ChangedIngredient[] | null>(null);

  const ingredientById = React.useMemo(() => new Map(ingredientOptions.map((o) => [o.id, o])), [ingredientOptions]);

  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function handleIngredientChange(key: string, ingredientId: string) {
    const ingredient = ingredientById.get(ingredientId);
    setLines((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r;
        if (ingredient) {
          const options = purchaseUnitOptionsFor(ingredient.baseUnit, ingredient.packSize !== null);
          const purchaseUnit = options.includes(r.purchaseUnit) ? r.purchaseUnit : guessPurchaseUnit(r.unitText, ingredient.baseUnit);
          return { ...r, ingredientId, purchaseUnit };
        }
        return { ...r, ingredientId };
      }),
    );
  }

  async function handleCreateIngredient(key: string) {
    const line = lines.find((r) => r.key === key);
    if (!line) return;
    const name = line.newName.trim();
    if (!name) {
      updateLine(key, { createError: NAME_REQUIRED });
      return;
    }
    updateLine(key, { creating: true, createError: null });

    const packSize = line.newBaseUnit === "piece" && line.newPackSizeText.trim() !== "" ? Number(line.newPackSizeText) : null;
    const result = await createIngredientInline({ storeId, name, baseUnit: line.newBaseUnit, packSize });

    if ("error" in result) {
      updateLine(key, { creating: false, createError: result.error });
      return;
    }

    const created: ReviewIngredientOption = {
      id: result.ingredient.id,
      name: result.ingredient.name,
      baseUnit: result.ingredient.baseUnit,
      currentCostSatang: result.ingredient.currentCostSatang,
      packSize: result.ingredient.packSize,
      affectedMenuItemCount: 0,
    };
    setIngredientOptions((rows) => [...rows, created].sort((a, b) => a.name.localeCompare(b.name, "th")));
    const options = purchaseUnitOptionsFor(created.baseUnit, created.packSize !== null);
    updateLine(key, {
      ingredientId: created.id,
      creating: false,
      createError: null,
      purchaseUnit: options.includes(line.purchaseUnit) ? line.purchaseUnit : guessPurchaseUnit(line.unitText, created.baseUnit),
    });
  }

  const conversions = React.useMemo(
    () => new Map(lines.map((line) => [line.key, computeConversion(line, ingredientById.get(line.ingredientId))])),
    [lines, ingredientById],
  );

  const totalSatang = lines.reduce((sum, line) => sum + (conversions.get(line.key)?.totalSatang ?? 0), 0);

  // "Before confirm" summary -- WBS 6.4's own example: "นมสด: ต้นทุนเปลี่ยน
  // จาก 42 เป็น 45 บาท/ลิตร กระทบ 6 เมนู". Only lines that are mapped, valid,
  // and whose computed cost actually differs from the ingredient's current
  // cost produce a line here -- an unmapped line or an unchanged price never
  // does, and this never runs the merchant's typed cost through
  // MoneyValue's own formatter (a plain-Thai sentence with two embedded
  // numbers, not a standalone money figure) -- flagged for redline_reviewer.
  const changeSummaries = lines
    .map((line) => {
      const ingredient = ingredientById.get(line.ingredientId);
      const conversion = conversions.get(line.key);
      if (!ingredient || !conversion) return null;
      const oldCost = ingredient.currentCostSatang;
      const newCost = conversion.unitCostSatang;
      if (oldCost === newCost) return null;
      const newLabel = formatHumanCost(newCost, ingredient.baseUnit);
      const impact = ingredient.affectedMenuItemCount > 0 ? ` กระทบ ${ingredient.affectedMenuItemCount} เมนู` : "";
      const text =
        oldCost === null
          ? `${ingredient.name}: ต้นทุนเริ่มต้นที่ ${newLabel}${impact}`
          : `${ingredient.name}: ต้นทุนเปลี่ยนจาก ${formatHumanCost(oldCost, ingredient.baseUnit)} เป็น ${newLabel}${impact}`;
      return { key: line.key, text };
    })
    .filter((x): x is { key: string; text: string } => x !== null);

  const hasCompleteLine = lines.some((line) => conversions.get(line.key) !== null);
  const allLinesValid = lines.every((line) => conversions.get(line.key) !== null);
  // A line left mid-"+ สร้างวัตถุดิบใหม่" (selected but never actually
  // created, or abandoned) must block confirm rather than silently falling
  // through as an unmapped/general-expense line — RL-2's "never force a
  // mapping" is about a merchant who deliberately leaves something unmapped,
  // not about a create flow they forgot to finish.
  const hasUnresolvedCreate = lines.some((line) => line.ingredientId === CREATE_NEW);
  const canConfirm = hasCompleteLine && allLinesValid && !hasUnresolvedCreate && !confirming && confirmedChanges === null;

  async function handleConfirm() {
    if (!canConfirm) return;
    setConfirming(true);
    setError(null);

    const payload: ConfirmLineInput[] = lines.map((line) => {
      const conversion = conversions.get(line.key)!;
      const ingredient = ingredientById.get(line.ingredientId);
      const rawText = `${line.name.trim()} (${line.qtyText.trim()} ${line.unitText.trim()})`;
      return {
        name: line.name.trim(),
        rawText,
        ingredientId: ingredient ? ingredient.id : null,
        qtyBaseUnit: ingredient ? conversion.qtyBaseUnit : null,
        unitCostSatang: ingredient ? conversion.unitCostSatang : null,
        totalSatang: conversion.totalSatang,
      };
    });

    const result = await confirmPurchaseInvoice({
      invoiceId,
      storeId,
      vendorName: vendorName.trim() || null,
      invoiceDate,
      lines: payload,
    });

    setConfirming(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setConfirmedChanges(result.changed);
  }

  if (confirmedChanges !== null) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-serif text-2xl font-bold leading-[1.35] text-ink">ยืนยันบิลแล้ว</h1>
        <Card>
          <div className="flex flex-col gap-2">
            {confirmedChanges.length > 0 ? (
              confirmedChanges.map((c) => (
                <p key={c.ingredientId} className="note-plain">
                  {ingredientById.get(c.ingredientId)?.name ?? c.ingredientId}: {formatHumanCost(c.newCostSatang, ingredientById.get(c.ingredientId)?.baseUnit ?? "g")}
                </p>
              ))
            ) : (
              <p className="note-plain">บันทึกเป็นค่าใช้จ่ายทั่วไปแล้ว</p>
            )}
          </div>
        </Card>
        <Button type="button" wet onClick={() => router.push("/console/inventory")}>
          ไปที่คลังวัตถุดิบ
        </Button>
        <Button type="button" variant="outline" onClick={() => router.push("/console/expenses/capture")}>
          บันทึกบิลใหม่
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-serif text-2xl font-bold leading-[1.35] text-ink">ตรวจบิล</h1>
      <p className="note-plain">ตรวจสอบและยืนยันบิลซื้อ</p>

      {imageUrl ? (
        <Card>
          <button
            type="button"
            className="block w-full"
            onClick={() => setLightboxOpen(true)}
            aria-label="แตะรูปเพื่อดูขยาย"
          >
            <img src={imageUrl} alt="รูปบิล" className="w-full rounded-(--radius-card) object-contain" style={{ maxHeight: 320 }} />
          </button>
          <p className="note-plain">แตะรูปเพื่อดูขยาย</p>
        </Card>
      ) : null}

      {lightboxOpen && imageUrl ? (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxOpen(false)}
          aria-label="ปิดรูปขยาย"
        >
          <img src={imageUrl} alt="รูปบิล ขยาย" className="max-h-full max-w-full object-contain" />
        </button>
      ) : null}

      <Card>
        <div className="flex flex-col gap-4">
          <Input label="ผู้ขาย" value={vendorName} onChange={(e) => setVendorName(e.target.value)} />
          <Input label="วันที่" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-bold">รายการในบิล</h2>
          {lines.map((line) => {
            const ingredient = ingredientById.get(line.ingredientId);
            const purchaseUnitOptions = purchaseUnitOptionsFor(
              ingredient?.baseUnit ?? "piece",
              ingredient?.packSize != null,
            );
            const conversion = conversions.get(line.key);
            const summary = changeSummaries.find((s) => s.key === line.key);

            return (
              <div key={line.key} className="flex flex-col gap-2 rounded-(--radius-card) border border-black/10 p-3">
                <Input label="ชื่อ" value={line.name} onChange={(e) => updateLine(line.key, { name: e.target.value })} />
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <Input
                      label="จำนวน"
                      inputMode="decimal"
                      value={line.qtyText}
                      onChange={(e) => updateLine(line.key, { qtyText: e.target.value })}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Input
                      label="หน่วย"
                      value={line.unitText}
                      onChange={(e) => updateLine(line.key, { unitText: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="field">
                      <label>หน่วยซื้อ (สำหรับคำนวณต้นทุน)</label>
                      <select
                        className="input"
                        value={line.purchaseUnit}
                        onChange={(e) => updateLine(line.key, { purchaseUnit: e.target.value as PurchaseUnit })}
                      >
                        {purchaseUnitOptions.map((u) => (
                          <option key={u} value={u}>
                            {PURCHASE_UNIT_LABELS[u]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <Input
                  label="ราคาต่อหน่วย (บาท)"
                  inputMode="decimal"
                  value={line.unitCostThb}
                  onChange={(e) => updateLine(line.key, { unitCostThb: e.target.value })}
                />

                <div className="field">
                  <label>ผูกกับวัตถุดิบ</label>
                  <select
                    className="input"
                    value={line.ingredientId}
                    onChange={(e) => handleIngredientChange(line.key, e.target.value)}
                  >
                    <option value={UNMAPPED}>ไม่ผูก (บันทึกเป็นค่าใช้จ่ายทั่วไป)</option>
                    <option value={CREATE_NEW}>+ สร้างวัตถุดิบใหม่</option>
                    {sortedIngredientOptions(ingredientOptions, line.name).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>

                {line.ingredientId === CREATE_NEW ? (
                  <div className="flex flex-col gap-2 rounded-(--radius-card) bg-black/5 p-3">
                    <Input
                      label="ชื่อวัตถุดิบใหม่"
                      value={line.newName}
                      onChange={(e) => updateLine(line.key, { newName: e.target.value })}
                    />
                    <div className="field">
                      <label>หน่วยพื้นฐาน</label>
                      <div className="flex gap-2">
                        {(Object.keys(NEW_INGREDIENT_BASE_UNIT_LABELS) as BaseUnit[]).map((unit) => (
                          <Button
                            key={unit}
                            type="button"
                            variant={line.newBaseUnit === unit ? "dark" : "outline"}
                            onClick={() => updateLine(line.key, { newBaseUnit: unit })}
                          >
                            {NEW_INGREDIENT_BASE_UNIT_LABELS[unit]}
                          </Button>
                        ))}
                      </div>
                    </div>
                    {line.newBaseUnit === "piece" ? (
                      <Input
                        label="จำนวนชิ้นต่อแพ็ค (ถ้าซื้อเป็นแพ็ค, ไม่บังคับ)"
                        inputMode="decimal"
                        value={line.newPackSizeText}
                        onChange={(e) => updateLine(line.key, { newPackSizeText: e.target.value })}
                      />
                    ) : null}
                    {line.createError ? (
                      <p role="alert" className="err">
                        {line.createError}
                      </p>
                    ) : null}
                    <Button type="button" loading={line.creating} onClick={() => handleCreateIngredient(line.key)}>
                      สร้างวัตถุดิบ
                    </Button>
                  </div>
                ) : null}

                {summary ? <p className="note-plain">{summary.text}</p> : null}

                <div className="flex items-center justify-between">
                  <span className="note-plain">รวม</span>
                  <MoneyValue value={conversion?.totalSatang ?? null} role="cost" />
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-between border-t border-black/10 pt-3">
            <span className="font-bold">รวมทั้งบิล</span>
            <MoneyValue value={totalSatang} role="cost" size="lg" />
          </div>
        </div>
      </Card>

      {error ? (
        <p role="alert" className="err">
          {error}
        </p>
      ) : null}

      <Button type="button" wet loading={confirming} disabled={!canConfirm} onClick={handleConfirm}>
        ยืนยัน
      </Button>
    </div>
  );
}
