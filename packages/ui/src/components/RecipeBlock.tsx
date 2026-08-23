import * as React from "react";

export interface RecipeRow {
  ingredientId: string;
  ingredientName: string;
  /** null = not yet entered, never 0. */
  quantity: number | null;
  unit: string;
}

/** The three base units bom_lines quantities are ever expressed in
 * (mirrors packages/costing/src/units.ts's BaseUnit -- declared locally,
 * not imported, so this package never depends on packages/costing: apps/shop
 * imports packages/ui, and packages/costing must never reach apps/shop's
 * bundle, RL-3). */
export type RecipeBaseUnit = "g" | "ml" | "piece";

export interface RecipeIngredientOption {
  id: string;
  name: string;
  baseUnit: RecipeBaseUnit;
}

export interface CreateIngredientInput {
  name: string;
  baseUnit: RecipeBaseUnit;
  packSize: number | null;
}

/**
 * RL-2: a merchant can sell without ever entering a recipe. Deliberately
 * absent from this interface: `required`, `error`, `validationState`,
 * `isValid`, or any prop matching /required|error|valid|missing|incomplete/.
 * Enforced by omission (there is no way to type-check "this will never grow
 * a validation prop") — redline_reviewer's standing checklist should flag
 * any future PR that adds one. See docs/ui/design_system_port_design.md §2.
 *
 * No `cost`/`costPerCup` prop either, on purpose: computing a per-cup cost
 * from `recipe` (sum of quantity × unit cost) is arithmetic on a
 * cost-shaped value, which is exactly what the RL-3 content-pattern rule
 * (eslint-rules/no-cost-formatting-logic.cjs) bans inside packages/ui. The
 * live "ต้นทุนต่อแก้ว" line in state_matrix.md's "Recipe editing" state is
 * rendered by the console page — which does have packages/costing — next to
 * this component, not inside it (WBS 6.7: MenuItemEditorForm renders it
 * immediately below <RecipeBlock>, keyed off the new onOpenChange callback
 * so it only shows while the block is actually open and in edit mode).
 */
export interface RecipeBlockProps {
  itemName: string;
  /** null = no recipe row exists at all (RL-2 baseline). */
  recipe: RecipeRow[] | null;
  /** A standard-recipe suggestion, or null if none exists or it was already
   * dismissed for this item (the caller decides that, not this component —
   * see onDismiss below). */
  suggestion: RecipeRow[] | null;
  /** The store's existing ingredients, for the per-row picker. */
  ingredientOptions: RecipeIngredientOption[];
  onUse: (suggestion: RecipeRow[]) => void;
  onChange: (recipe: RecipeRow[]) => void;
  /** WBS 6.7, RL-2: one dismissal is permanent for this menu item. This
   * component never re-shows a suggestion on its own — the caller stores the
   * dismissal and simply never passes a `suggestion` again. */
  onDismiss: () => void;
  /** Inline ingredient creation (WBS 6.5's pattern, reused here) — resolves
   * to the created option, or null on failure (the row's own create form
   * shows a generic retry message; RecipeBlock has no server access of its
   * own). */
  onCreateIngredient: (input: CreateIngredientInput) => Promise<RecipeIngredientOption | null>;
  /** Observability only, not control: lets the caller know whether the block
   * is currently open, so it can decide whether to render its own cost-
   * preview line beneath this card. Collapse/expand state itself stays
   * internal to this component (RL-2 baseline: collapsed by default). */
  onOpenChange?: (open: boolean) => void;
  /** Test-only escape hatch, default false (collapsed) everywhere in the
   * real product -- no production call site passes this. This repo has no
   * jsdom/@testing-library harness to simulate the header's click (see
   * RecipeBlock.test.tsx's own header comment), so opening the block any
   * other way for a render-only assertion isn't possible. */
  defaultOpen?: boolean;
}

const BASE_UNIT_LABEL: Record<RecipeBaseUnit, string> = { g: "กรัม", ml: "มล.", piece: "ชิ้น" };
const CREATE_ERROR = "สร้างวัตถุดิบไม่สำเร็จ ลองใหม่อีกครั้ง";

// Collapsed by default, zero validation, no badge, no asterisk, no
// confirmation on save. This file's own copy must never contain any of the
// five forbidden nag phrases enumerated in CLAUDE.md's RL-2 section and
// checked by `pnpm scan:forbidden-copy` — not repeated verbatim here so
// that check-script itself doesn't flag this comment as a hit.
export function RecipeBlock({
  itemName,
  recipe,
  suggestion,
  ingredientOptions,
  onUse,
  onChange,
  onDismiss,
  onCreateIngredient,
  onOpenChange,
  defaultOpen = false,
}: RecipeBlockProps) {
  const [open, setOpen] = React.useState(defaultOpen);

  function toggleOpen() {
    setOpen((v) => {
      onOpenChange?.(!v);
      return !v;
    });
  }

  return (
    <div className="card oc-recipe" data-testid="recipe-block">
      <button type="button" className="oc-rechead" aria-expanded={open} onClick={toggleOpen}>
        <span>
          <b>สูตร (ใส่ทีหลังได้)</b>
        </span>
        <span className={`oc-chev${open ? " is-open" : ""}`} aria-hidden="true">
          ›
        </span>
      </button>

      {open ? (
        <div className="oc-recbody">
          {recipe === null ? (
            <RecipeStart
              itemName={itemName}
              suggestion={suggestion}
              onUse={onUse}
              onChange={onChange}
              onDismiss={onDismiss}
            />
          ) : (
            <RecipeTable
              recipe={recipe}
              onChange={onChange}
              ingredientOptions={ingredientOptions}
              onCreateIngredient={onCreateIngredient}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function RecipeStart({
  suggestion,
  onUse,
  onChange,
  onDismiss,
}: Pick<RecipeBlockProps, "itemName" | "suggestion" | "onUse" | "onChange" | "onDismiss">) {
  if (suggestion && suggestion.length > 0) {
    return (
      <>
        <p className="note-plain">มีสูตรมาตรฐานสำหรับรายการนี้อยู่แล้ว ใช้แล้วปรับตัวเลขให้ตรงกับร้านคุณได้เลย</p>
        <div className="oc-rectable">
          {suggestion.map((row, i) => (
            <div className="oc-recrow" key={row.ingredientId || i}>
              <span>{row.ingredientName}</span>
              <span className="num">
                {row.quantity ?? "—"} {row.unit}
              </span>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn btn--primary btn--wet" onClick={() => onUse(suggestion)}>
            ใช้สูตรนี้แล้วแก้ได้
          </button>
          <button type="button" className="btn btn--quiet" onClick={onDismiss}>
            ไม่ใช้สูตรนี้
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="note-plain">เริ่มจากบรรทัดว่างแล้วใส่วัตถุดิบทีละอย่าง</p>
      <button
        type="button"
        className="btn btn--outline"
        onClick={() => onChange([{ ingredientId: "", ingredientName: "", quantity: null, unit: "" }])}
      >
        เริ่มใส่สูตรเอง
      </button>
    </>
  );
}

const NEW_INGREDIENT = "__new__";

interface RowDraft {
  mode: "create";
  name: string;
  baseUnit: RecipeBaseUnit;
  packSizeText: string;
  error: string | null;
  creating: boolean;
}

function RecipeTable({
  recipe,
  onChange,
  ingredientOptions,
  onCreateIngredient,
}: {
  recipe: RecipeRow[];
  onChange: (recipe: RecipeRow[]) => void;
  ingredientOptions: RecipeIngredientOption[];
  onCreateIngredient: (input: CreateIngredientInput) => Promise<RecipeIngredientOption | null>;
}) {
  const [drafts, setDrafts] = React.useState<Record<number, RowDraft>>({});

  function updateRow(index: number, patch: Partial<RecipeRow>) {
    onChange(recipe.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    onChange([...recipe, { ingredientId: "", ingredientName: "", quantity: null, unit: "" }]);
    setDrafts((d) => ({ ...d, [recipe.length]: undefined as unknown as RowDraft }));
  }

  function removeRow(index: number) {
    onChange(recipe.filter((_, i) => i !== index));
    setDrafts((d) => {
      const next = { ...d };
      delete next[index];
      return next;
    });
  }

  function handleIngredientSelect(index: number, value: string) {
    if (value === NEW_INGREDIENT) {
      setDrafts((d) => ({
        ...d,
        [index]: { mode: "create", name: recipe[index].ingredientName, baseUnit: "g", packSizeText: "", error: null, creating: false },
      }));
      return;
    }
    const option = ingredientOptions.find((o) => o.id === value);
    updateRow(index, {
      ingredientId: value,
      ingredientName: option?.name ?? "",
      unit: option ? BASE_UNIT_LABEL[option.baseUnit] : "",
    });
    setDrafts((d) => {
      const next = { ...d };
      delete next[index];
      return next;
    });
  }

  function updateDraft(index: number, patch: Partial<RowDraft>) {
    setDrafts((d) => (d[index] ? { ...d, [index]: { ...d[index], ...patch } } : d));
  }

  function cancelDraft(index: number) {
    setDrafts((d) => {
      const next = { ...d };
      delete next[index];
      return next;
    });
  }

  async function submitDraft(index: number) {
    const draft = drafts[index];
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      updateDraft(index, { error: "กรอกชื่อวัตถุดิบ" });
      return;
    }
    updateDraft(index, { creating: true, error: null });

    const packSize = draft.baseUnit === "piece" && draft.packSizeText.trim() !== "" ? Number(draft.packSizeText) : null;
    const created = await onCreateIngredient({ name, baseUnit: draft.baseUnit, packSize });

    if (!created) {
      updateDraft(index, { creating: false, error: CREATE_ERROR });
      return;
    }

    updateRow(index, { ingredientId: created.id, ingredientName: created.name, unit: BASE_UNIT_LABEL[created.baseUnit] });
    setDrafts((d) => {
      const next = { ...d };
      delete next[index];
      return next;
    });
  }

  return (
    <>
      <div className="oc-rectable is-edit">
        {recipe.map((row, i) => {
          const draft = drafts[i];
          return (
            <div className="flex flex-col gap-2" key={i}>
              <div className="oc-recrow">
                <div className="field" style={{ flex: 1, minWidth: 0 }}>
                  <select
                    className="input"
                    value={draft ? NEW_INGREDIENT : row.ingredientId}
                    onChange={(e) => handleIngredientSelect(i, e.target.value)}
                  >
                    <option value="" disabled>
                      {row.ingredientId === "" && row.ingredientName
                        ? `เลือกวัตถุดิบ (แนะนำ: ${row.ingredientName})`
                        : "เลือกวัตถุดิบ"}
                    </option>
                    <option value={NEW_INGREDIENT}>+ สร้างวัตถุดิบใหม่</option>
                    {ingredientOptions.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  className="input num"
                  value={row.quantity ?? ""}
                  inputMode="decimal"
                  onChange={(e) => {
                    const raw = e.target.value;
                    updateRow(i, { quantity: raw === "" ? null : Number(raw) });
                  }}
                />
                <span className="note-plain">{row.unit}</span>
                <button type="button" className="btn btn--quiet" onClick={() => removeRow(i)}>
                  ลบ
                </button>
              </div>

              {draft ? (
                <div className="flex flex-col gap-2 rounded-(--radius-card) bg-black/5 p-3">
                  <input
                    className="input"
                    placeholder="ชื่อวัตถุดิบใหม่"
                    value={draft.name}
                    onChange={(e) => updateDraft(i, { name: e.target.value })}
                  />
                  <div className="flex gap-2">
                    {(Object.keys(BASE_UNIT_LABEL) as RecipeBaseUnit[]).map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        className={`btn ${draft.baseUnit === unit ? "btn--dark" : "btn--outline"}`}
                        onClick={() => updateDraft(i, { baseUnit: unit })}
                      >
                        {BASE_UNIT_LABEL[unit]}
                      </button>
                    ))}
                  </div>
                  {draft.error ? (
                    <p role="alert" className="err">
                      {draft.error}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <button type="button" className="btn btn--primary" disabled={draft.creating} onClick={() => submitDraft(i)}>
                      สร้างวัตถุดิบ
                    </button>
                    <button type="button" className="btn btn--quiet" onClick={() => cancelDraft(i)}>
                      ยกเลิก
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" className="btn btn--quiet" onClick={addRow}>
        เพิ่มวัตถุดิบ
      </button>
    </>
  );
}
