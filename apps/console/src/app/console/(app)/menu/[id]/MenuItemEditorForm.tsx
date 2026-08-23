"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, Input, Button, MoneyValue, RecipeBlock, type RecipeRow, type CreateIngredientInput, type RecipeIngredientOption } from "@brewledger/ui";
import { thbToSatang, satangToThb } from "@brewledger/shared/dist/money";
import { compressImage } from "@brewledger/shared/dist/storage/compress";
import { matchRecipeSuggestion } from "@brewledger/costing/dist/recipes/library";
import { previewRecipeCostSatang, type RecipePreviewLine } from "@brewledger/costing/dist/recipes/preview";
import type { BaseUnit } from "@brewledger/costing/dist/units";
import {
  saveMenuItem,
  uploadMenuItemPhoto,
  dismissRecipeSuggestion,
  type SaveMenuItemInput,
} from "./actions";
// WBS 6.7 reuses WBS 6.4/6.5's inline ingredient-create action as-is rather
// than duplicating it -- same store-ownership check, same insert shape, the
// only two callers of a merchant creating an ingredient without leaving
// whatever screen they're on.
import { createIngredientInline } from "../../expenses/[id]/review/actions";

// Recipe rows are base-unit quantities (18 g, 200 ml) -- a smaller-scale
// label than units.ts's own "per kg/L" human-purchase-unit labels, so not
// reused from there. Kept in sync with the identical map in page.tsx (this
// file has no access to that server-only module boundary reason to share
// one file, same as ReviewForm/page.tsx's own per-file BASE_UNIT_LABELS).
const BASE_UNIT_LABEL: Record<BaseUnit, string> = { g: "กรัม", ml: "มล.", piece: "ชิ้น" };
const RECIPE_NULL_COST_NOTE =
  "ต้นทุนของวัตถุดิบที่ยังไม่มีราคาจะปรากฏเองเมื่อคุณยืนยันบิลซื้อของวัตถุดิบนั้น";

export interface MenuItemEditorOption {
  id: string | null;
  name: string;
  priceDeltaSatang: number;
}

export interface MenuItemEditorOptionGroup {
  id: string | null;
  name: string;
  options: MenuItemEditorOption[];
}

export interface MenuItemIngredientOption {
  id: string;
  name: string;
  baseUnit: BaseUnit;
  currentCostSatang: number | null;
}

export interface MenuItemEditorInitialData {
  id: string;
  name: string;
  description: string | null;
  priceSatang: number;
  imagePath: string | null;
  imageUrl: string | null;
  optionGroups: MenuItemEditorOptionGroup[];
  /** null = no bom_lines row exists at all (RL-2 baseline) -- distinct from
   * an explicitly-saved empty recipe, see MenuItemEditorForm's own recipe
   * derivation and actions.ts's saveMenuItem header comment. */
  recipe: RecipeRow[] | null;
  recipeSuggestionDismissed: boolean;
}

const SAVE_SUCCESS = "บันทึกแล้ว";
const NAME_REQUIRED = "กรอกชื่อรายการ";
const PRICE_REQUIRED = "กรอกราคา";
const PRICE_INVALID = "ราคาต้องมากกว่า 0 บาท";
const PHOTO_UPLOAD_ERROR = "อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง";

interface DraftOption {
  key: string;
  name: string;
  priceDeltaThb: string;
}
interface DraftGroup {
  key: string;
  name: string;
  options: DraftOption[];
}

let draftKeyCounter = 0;
function nextDraftKey(): string {
  draftKeyCounter += 1;
  return `draft-${draftKeyCounter}`;
}

function toDraftGroups(groups: MenuItemEditorOptionGroup[]): DraftGroup[] {
  return groups.map((g) => ({
    key: nextDraftKey(),
    name: g.name,
    options: g.options.map((o) => ({
      key: nextDraftKey(),
      name: o.name,
      priceDeltaThb: String(satangToThb(o.priceDeltaSatang)),
    })),
  }));
}

export function MenuItemEditorForm({
  storeId,
  item,
  ingredientOptions: initialIngredientOptions,
}: {
  storeId: string;
  item: MenuItemEditorInitialData | null;
  ingredientOptions: MenuItemIngredientOption[];
}) {
  const router = useRouter();

  const [itemId, setItemId] = React.useState<string | null>(item?.id ?? null);
  const [name, setName] = React.useState(item?.name ?? "");
  const [priceThb, setPriceThb] = React.useState(item ? String(satangToThb(item.priceSatang)) : "");
  const [description, setDescription] = React.useState(item?.description ?? "");
  const [photoFile, setPhotoFile] = React.useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = React.useState<string | null>(item?.imageUrl ?? null);
  const [optionGroups, setOptionGroups] = React.useState<DraftGroup[]>(() => toDraftGroups(item?.optionGroups ?? []));

  const [touched, setTouched] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);

  // WBS 6.7 -- recipe state. `recipe === null` is the RL-2 baseline ("no
  // recipe row exists"); RecipeBlock shows the suggestion/blank-start view
  // in that state and the edit table otherwise. See MenuItemEditorInitialData
  // and actions.ts's saveMenuItem for why null and [] are kept distinct.
  const [recipe, setRecipe] = React.useState<RecipeRow[] | null>(item?.recipe ?? null);
  const [recipeDismissed, setRecipeDismissed] = React.useState(item?.recipeSuggestionDismissed ?? false);
  const [recipeOpen, setRecipeOpen] = React.useState(false);
  const [ingredientOptions, setIngredientOptions] = React.useState<MenuItemIngredientOption[]>(initialIngredientOptions);

  const matchedRecipeEntry = React.useMemo(() => matchRecipeSuggestion(name), [name]);

  const suggestionRows = React.useMemo<RecipeRow[] | null>(() => {
    if (!matchedRecipeEntry) return null;
    return matchedRecipeEntry.lines.map((line) => {
      const match = ingredientOptions.find(
        (o) => o.baseUnit === line.baseUnit && o.name.trim().toLowerCase() === line.ingredientName.trim().toLowerCase(),
      );
      return {
        ingredientId: match?.id ?? "",
        ingredientName: match?.name ?? line.ingredientName,
        quantity: line.qtyBaseUnit,
        unit: BASE_UNIT_LABEL[line.baseUnit],
      };
    });
  }, [matchedRecipeEntry, ingredientOptions]);

  const recipeIngredientOptions: RecipeIngredientOption[] = React.useMemo(
    () => ingredientOptions.map((o) => ({ id: o.id, name: o.name, baseUnit: o.baseUnit })),
    [ingredientOptions],
  );

  function handleUseSuggestion(rows: RecipeRow[]) {
    setRecipe(rows);
  }

  function handleDismissSuggestion() {
    setRecipeDismissed(true);
    if (itemId) {
      dismissRecipeSuggestion(itemId, storeId).catch((err) => {
        console.error("dismissRecipeSuggestion failed", err);
      });
    }
    // No itemId yet (brand-new, unsaved item) -- persisted once this item
    // is actually saved, in handleSubmit below. Nothing to show the
    // merchant either way (interaction_spec.md: nothing else confirms).
  }

  async function handleCreateRecipeIngredient(input: CreateIngredientInput): Promise<RecipeIngredientOption | null> {
    const result = await createIngredientInline({
      storeId,
      name: input.name,
      baseUnit: input.baseUnit,
      packSize: input.packSize,
    });
    if ("error" in result) return null;

    const created: MenuItemIngredientOption = {
      id: result.ingredient.id,
      name: result.ingredient.name,
      baseUnit: result.ingredient.baseUnit,
      currentCostSatang: result.ingredient.currentCostSatang,
    };
    setIngredientOptions((opts) => [...opts, created].sort((a, b) => a.name.localeCompare(b.name, "th")));
    return { id: created.id, name: created.name, baseUnit: created.baseUnit };
  }

  const ingredientCostById = React.useMemo(
    () => new Map(ingredientOptions.map((o) => [o.id, o.currentCostSatang])),
    [ingredientOptions],
  );

  // Only rows the merchant has actually completed (a real ingredient +
  // a positive quantity) count toward the preview -- a half-filled row is
  // simply not there yet, never an error (RL-2: zero validation).
  const completeRecipeLines: RecipePreviewLine[] = React.useMemo(() => {
    if (recipe === null) return [];
    return recipe
      .filter((row): row is RecipeRow & { quantity: number } => row.ingredientId !== "" && row.quantity !== null && row.quantity > 0)
      .map((row) => ({ qtyBaseUnit: row.quantity, unitCostSatang: ingredientCostById.get(row.ingredientId) ?? null }));
  }, [recipe, ingredientCostById]);

  const recipeCostPreviewSatang = previewRecipeCostSatang(completeRecipeLines);
  const recipeHasUnknownCostLine = completeRecipeLines.some((l) => l.unitCostSatang === null);
  const [photoError, setPhotoError] = React.useState<string | null>(null);

  const priceSatang = priceThb.trim() === "" ? null : thbToSatang(Number(priceThb));
  const nameError = touched && name.trim().length === 0 ? NAME_REQUIRED : undefined;
  const priceError = touched
    ? priceThb.trim() === ""
      ? PRICE_REQUIRED
      : !priceSatang || priceSatang <= 0
        ? PRICE_INVALID
        : undefined
    : undefined;
  const canSubmit = name.trim().length > 0 && !!priceSatang && priceSatang > 0;

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setPhotoError(null);
  }

  function addOptionGroup() {
    setOptionGroups((groups) => [...groups, { key: nextDraftKey(), name: "", options: [] }]);
  }
  function removeOptionGroup(groupKey: string) {
    setOptionGroups((groups) => groups.filter((g) => g.key !== groupKey));
  }
  function updateGroupName(groupKey: string, value: string) {
    setOptionGroups((groups) => groups.map((g) => (g.key === groupKey ? { ...g, name: value } : g)));
  }
  function addOption(groupKey: string) {
    setOptionGroups((groups) =>
      groups.map((g) =>
        g.key === groupKey ? { ...g, options: [...g.options, { key: nextDraftKey(), name: "", priceDeltaThb: "0" }] } : g,
      ),
    );
  }
  function removeOption(groupKey: string, optionKey: string) {
    setOptionGroups((groups) =>
      groups.map((g) => (g.key === groupKey ? { ...g, options: g.options.filter((o) => o.key !== optionKey) } : g)),
    );
  }
  function updateOption(groupKey: string, optionKey: string, patch: Partial<DraftOption>) {
    setOptionGroups((groups) =>
      groups.map((g) =>
        g.key === groupKey
          ? { ...g, options: g.options.map((o) => (o.key === optionKey ? { ...o, ...patch } : o)) }
          : g,
      ),
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit || saving || !priceSatang) return;

    setSaving(true);
    setError(null);
    setSavedAt(null);
    setPhotoError(null);

    const input: SaveMenuItemInput = {
      itemId,
      storeId,
      name,
      priceSatang,
      description: description.trim() || null,
      optionGroups: optionGroups.map((g) => ({
        name: g.name,
        options: g.options.map((o) => ({
          name: o.name,
          priceDeltaSatang: thbToSatang(Number(o.priceDeltaThb || "0")),
        })),
      })),
      // null = recipe block never touched this save (RL-2 baseline, leaves
      // bom_lines alone); an array (even []) is only ever set once the
      // merchant has actually opened/edited the block, see this file's own
      // recipe state above. Incomplete rows (no ingredient picked, or no
      // quantity) are silently dropped here, never blocked -- same "zero
      // validation" rule as everywhere else in this recipe block.
      recipe:
        recipe === null
          ? null
          : recipe
              .filter((row) => row.ingredientId !== "" && row.quantity !== null && row.quantity > 0)
              .map((row) => ({ ingredientId: row.ingredientId, qtyBaseUnit: row.quantity as number })),
    };

    const result = await saveMenuItem(input);
    if ("error" in result) {
      setSaving(false);
      setError(result.error);
      return;
    }

    let photoUploadFailed = false;
    if (photoFile) {
      try {
        // Compression stays in the browser (WBS 3.8, Canvas-only) but the
        // actual Storage write goes through a Server Action -- the browser
        // Supabase client can never carry the merchant's session (the
        // session cookie is httpOnly per WBS 4.1), so a browser-client
        // storage call always runs as `anon` and RLS rejects it.
        const compressed = await compressImage(photoFile, { mimeType: "image/webp" });
        const formData = new FormData();
        formData.set("file", compressed, "photo.webp");
        const uploadResult = await uploadMenuItemPhoto(result.item.id, storeId, formData);
        if ("error" in uploadResult) throw new Error(uploadResult.error);
      } catch (err) {
        // Photo upload failure never fails the item save -- the photo is
        // optional (WBS 4.4), the item itself already saved successfully.
        // The merchant still needs to know their photo didn't stick, so this
        // surfaces separately from `error` rather than being swallowed.
        console.error("menu item photo upload failed", err);
        photoUploadFailed = true;
        setPhotoError(PHOTO_UPLOAD_ERROR);
      }
    }

    setSaving(false);
    setSavedAt(Date.now());

    if (!itemId) {
      setItemId(result.item.id);
      // The suggestion may have been dismissed before this brand-new item
      // ever had an id to persist that dismissal against (dismissRecipeSuggestion
      // needs a real row) -- catch up now that one exists.
      if (recipeDismissed) {
        dismissRecipeSuggestion(result.item.id, storeId).catch((err) => {
          console.error("dismissRecipeSuggestion failed", err);
        });
      }
      // A failed photo needs its error read before the route change remounts
      // this form (fresh server props) and discards photoError with it --
      // stay put so the merchant can see it and retry from here.
      if (!photoUploadFailed) {
        router.replace(`/console/menu/${result.item.id}`);
      }
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Button type="button" variant="quiet" onClick={() => router.push("/console/menu")}>
        ย้อนกลับ
      </Button>
      <h1 className="font-serif text-2xl font-bold leading-[1.35] text-ink">
        {itemId ? "แก้ไขรายการ" : "รายการใหม่"}
      </h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Card>
          <div className="flex flex-col gap-4">
            <Input
              label="ชื่อรายการ"
              placeholder="เช่น ลาเต้เย็น"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={nameError}
            />
            <Input
              label="ราคา"
              placeholder="60"
              inputMode="decimal"
              value={priceThb}
              onChange={(e) => setPriceThb(e.target.value)}
              error={priceError}
            />

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

            <hr className="hair" />

            <div className="field">
              <label>รูปภาพ</label>
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
                <input type="file" accept="image/*" className="sr-only" onChange={handlePhotoChange} />
              </label>
              {photoError ? (
                <p role="alert" className="err">
                  {photoError}
                </p>
              ) : null}
            </div>

            <Input
              label="คำอธิบาย"
              placeholder="นมสดกับเอสเพรสโซ่สองช็อต"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            <OptionGroupsEditor
              groups={optionGroups}
              onAddGroup={addOptionGroup}
              onRemoveGroup={removeOptionGroup}
              onGroupNameChange={updateGroupName}
              onAddOption={addOption}
              onRemoveOption={removeOption}
              onOptionChange={updateOption}
            />
          </div>
        </Card>
      </form>

      {/* WBS 4.4 / RL-2: this block is the point the whole entry exists to
          protect. A merchant who never opens it, or opens it and closes it
          empty, must reach exactly the same "saved successfully, item is
          sellable" outcome as one who fills it in fully -- saveMenuItem
          above never requires anything from here; an untouched `recipe`
          stays `null` and bom_lines is never written. WBS 6.7 wires real
          suggestion-matching, the ingredient picker, and bom_lines
          persistence (via the Save button above, not a separate confirm --
          interaction_spec.md: "Saving a menu item without a recipe never
          confirms," and neither does saving one WITH a recipe). Do NOT add
          a badge, asterisk, confirmation, or "you should really add a
          recipe" copy here or anywhere near this component, now or later. */}
      <RecipeBlock
        itemName={name}
        recipe={recipe}
        suggestion={recipeDismissed ? null : suggestionRows}
        ingredientOptions={recipeIngredientOptions}
        onUse={handleUseSuggestion}
        onChange={setRecipe}
        onDismiss={handleDismissSuggestion}
        onCreateIngredient={handleCreateRecipeIngredient}
        onOpenChange={setRecipeOpen}
      />
      {/* Rendered NEXT TO RecipeBlock, not inside it -- RecipeBlock (packages/ui)
          must never derive a cost figure (RL-3, no-cost-formatting-logic.cjs);
          this console page has packages/costing and does the arithmetic.
          Only shown once there's an actual recipe table open to read (the
          "Recipe editing" state in state_matrix.md), never during the
          suggestion/blank-start view. */}
      {recipeOpen && recipe !== null ? (
        <div className="flex flex-col gap-1 px-1">
          <div className="flex items-center justify-between">
            <span className="note-plain">ต้นทุนต่อแก้ว</span>
            <MoneyValue value={recipeCostPreviewSatang} role="cost" />
          </div>
          {recipeCostPreviewSatang === null && recipeHasUnknownCostLine ? (
            <p className="note-plain">{RECIPE_NULL_COST_NOTE}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OptionGroupsEditor({
  groups,
  onAddGroup,
  onRemoveGroup,
  onGroupNameChange,
  onAddOption,
  onRemoveOption,
  onOptionChange,
}: {
  groups: DraftGroup[];
  onAddGroup: () => void;
  onRemoveGroup: (groupKey: string) => void;
  onGroupNameChange: (groupKey: string, value: string) => void;
  onAddOption: (groupKey: string) => void;
  onRemoveOption: (groupKey: string, optionKey: string) => void;
  onOptionChange: (groupKey: string, optionKey: string, patch: Partial<DraftOption>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <label className="text-sm font-bold">ตัวเลือก</label>
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-2 rounded-(--radius-card) border border-black/10 p-3">
          <Input
            label="ชื่อกลุ่มตัวเลือก"
            placeholder="เช่น ร้อน / เย็น / ปั่น"
            value={group.name}
            onChange={(e) => onGroupNameChange(group.key, e.target.value)}
          />
          {group.options.map((option) => (
            <div key={option.key} className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <Input
                  label="ตัวเลือก"
                  placeholder="เช่น ร้อน"
                  value={option.name}
                  onChange={(e) => onOptionChange(group.key, option.key, { name: e.target.value })}
                />
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  label="ราคาเพิ่ม/ลด (บาท)"
                  inputMode="decimal"
                  placeholder="0"
                  value={option.priceDeltaThb}
                  onChange={(e) => onOptionChange(group.key, option.key, { priceDeltaThb: e.target.value })}
                />
              </div>
              <Button type="button" variant="quiet" onClick={() => onRemoveOption(group.key, option.key)}>
                ลบ
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button type="button" variant="quiet" onClick={() => onAddOption(group.key)}>
              เพิ่มตัวเลือก
            </Button>
            <Button type="button" variant="quiet" onClick={() => onRemoveGroup(group.key)}>
              ลบกลุ่มตัวเลือกนี้
            </Button>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={onAddGroup}>
        เพิ่มกลุ่มตัวเลือก
      </Button>
    </div>
  );
}
