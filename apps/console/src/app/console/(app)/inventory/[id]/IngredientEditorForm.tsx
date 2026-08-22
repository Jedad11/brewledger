"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Button } from "@brewledger/ui";
import type { BaseUnit } from "@brewledger/costing/dist/units";
import { saveIngredient, deleteIngredient, archiveIngredient, type SaveIngredientInput } from "./actions";

export interface IngredientEditorInitialData {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  lowStockThreshold: number | null;
  packSize: number | null;
  /** true once any purchase_line_item or stock_ledger row references this
   * ingredient -- base_unit becomes read-only (WBS 6.5, enforced for real
   * by 0036's DB trigger; this is the UI layer's own explanation). */
  baseUnitLocked: boolean;
}

const SAVE_SUCCESS = "บันทึกแล้ว";
const NAME_REQUIRED = "กรอกชื่อวัตถุดิบ";
const BASE_UNIT_LOCKED_NOTE =
  "เปลี่ยนหน่วยพื้นฐานไม่ได้แล้ว เพราะมีบิลซื้อหรือรายการสต๊อกที่อ้างอิงวัตถุดิบนี้อยู่";
const DELETE_CONFIRM = "ลบวัตถุดิบนี้ใช่หรือไม่";
const ARCHIVE_CONFIRM = "ซ่อนวัตถุดิบนี้ใช่หรือไม่ ยังกู้คืนได้ทีหลังผ่านฐานข้อมูล";

const BASE_UNIT_LABELS: Record<BaseUnit, string> = { g: "กรัม (ซื้อเป็น กก.)", ml: "มิลลิลิตร (ซื้อเป็น ล.)", piece: "ชิ้น" };

export function IngredientEditorForm({
  storeId,
  ingredient,
}: {
  storeId: string;
  ingredient: IngredientEditorInitialData | null;
}) {
  const router = useRouter();

  const [ingredientId, setIngredientId] = React.useState<string | null>(ingredient?.id ?? null);
  const [name, setName] = React.useState(ingredient?.name ?? "");
  const [baseUnit, setBaseUnit] = React.useState<BaseUnit>(ingredient?.baseUnit ?? "g");
  const [lowStockThreshold, setLowStockThreshold] = React.useState(
    ingredient?.lowStockThreshold != null ? String(ingredient.lowStockThreshold) : "",
  );
  const [packSize, setPackSize] = React.useState(ingredient?.packSize != null ? String(ingredient.packSize) : "");

  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  const baseUnitLocked = ingredient?.baseUnitLocked ?? false;
  const nameError = touched && name.trim().length === 0 ? NAME_REQUIRED : undefined;
  const canSubmit = name.trim().length > 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit || saving) return;

    setSaving(true);
    setError(null);
    setSavedAt(null);

    const input: SaveIngredientInput = {
      ingredientId,
      storeId,
      name,
      baseUnit,
      lowStockThreshold: lowStockThreshold.trim() === "" ? null : Number(lowStockThreshold),
      packSize: baseUnit === "piece" && packSize.trim() !== "" ? Number(packSize) : null,
    };

    const result = await saveIngredient(input);
    setSaving(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }

    setSavedAt(Date.now());
    if (!ingredientId) {
      setIngredientId(result.ingredientId);
      router.replace(`/console/inventory/${result.ingredientId}`);
    }
  }

  async function handleDelete() {
    if (!ingredientId || busy) return;
    if (!window.confirm(DELETE_CONFIRM)) return;

    setBusy(true);
    setError(null);
    const result = await deleteIngredient(storeId, ingredientId);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push("/console/inventory");
  }

  async function handleArchive() {
    if (!ingredientId || busy) return;
    if (!window.confirm(ARCHIVE_CONFIRM)) return;

    setBusy(true);
    setError(null);
    const result = await archiveIngredient(storeId, ingredientId);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    router.push("/console/inventory");
  }

  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="quiet" onClick={() => router.push("/console/inventory")}>
        ย้อนกลับ
      </Button>
      <h1 className="font-serif text-2xl font-bold leading-[1.35] text-ink">
        {ingredientId ? "แก้ไขวัตถุดิบ" : "วัตถุดิบใหม่"}
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Card>
          <div className="flex flex-col gap-4">
            <Input
              label="ชื่อวัตถุดิบ"
              placeholder="เช่น นมสด"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={nameError}
            />

            <div className="field">
              <label>หน่วยพื้นฐาน</label>
              <div className="flex gap-2">
                {(Object.keys(BASE_UNIT_LABELS) as BaseUnit[]).map((unit) => (
                  <Button
                    key={unit}
                    type="button"
                    variant={baseUnit === unit ? "dark" : "outline"}
                    disabled={baseUnitLocked}
                    onClick={() => setBaseUnit(unit)}
                  >
                    {BASE_UNIT_LABELS[unit]}
                  </Button>
                ))}
              </div>
              {baseUnitLocked ? <span className="note-plain">{BASE_UNIT_LOCKED_NOTE}</span> : null}
            </div>

            <Input
              label="แจ้งเตือนเมื่อสต๊อกต่ำกว่า (หน่วยพื้นฐาน, ไม่บังคับ)"
              placeholder="ไม่บังคับ"
              inputMode="decimal"
              value={lowStockThreshold}
              onChange={(e) => setLowStockThreshold(e.target.value)}
            />

            {baseUnit === "piece" ? (
              <Input
                label="จำนวนชิ้นต่อแพ็ค (ถ้าซื้อเป็นแพ็ค, ไม่บังคับ)"
                placeholder="เช่น 50"
                inputMode="decimal"
                value={packSize}
                onChange={(e) => setPackSize(e.target.value)}
              />
            ) : null}

            {error ? (
              <p role="alert" className="err">
                {error}
              </p>
            ) : null}
            {savedAt && !error ? (
              <p className="note-plain" role="status">
                {SAVE_SUCCESS}
              </p>
            ) : null}

            <Button type="submit" wet loading={saving} disabled={!canSubmit}>
              บันทึก
            </Button>
          </div>
        </Card>
      </form>

      {ingredientId ? (
        <div className="flex gap-2">
          <Button type="button" variant="quiet" onClick={handleArchive} disabled={busy}>
            ซ่อน
          </Button>
          <Button type="button" variant="danger" onClick={handleDelete} disabled={busy}>
            ลบ
          </Button>
        </div>
      ) : null}
    </div>
  );
}
