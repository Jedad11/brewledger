import * as React from "react";

export interface RecipeRow {
  ingredientId: string;
  ingredientName: string;
  /** null = not yet entered, never 0. */
  quantity: number | null;
  unit: string;
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
 * this component, not inside it.
 */
export interface RecipeBlockProps {
  itemName: string;
  /** null = no recipe row exists at all (RL-2 baseline). */
  recipe: RecipeRow[] | null;
  /** A standard-recipe suggestion, or null if none exists. */
  suggestion: RecipeRow[] | null;
  onUse: (suggestion: RecipeRow[]) => void;
  onChange: (recipe: RecipeRow[]) => void;
}

// Collapsed by default, zero validation, no badge, no asterisk, no
// confirmation on save. This file's own copy must never contain any of the
// five forbidden nag phrases enumerated in CLAUDE.md's RL-2 section and
// checked by `pnpm scan:forbidden-copy` — not repeated verbatim here so
// that check-script itself doesn't flag this comment as a hit.
export function RecipeBlock({ itemName, recipe, suggestion, onUse, onChange }: RecipeBlockProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="card oc-recipe" data-testid="recipe-block">
      <button
        type="button"
        className="oc-rechead"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
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
            <RecipeStart itemName={itemName} suggestion={suggestion} onUse={onUse} onChange={onChange} />
          ) : (
            <RecipeTable recipe={recipe} onChange={onChange} />
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
}: Pick<RecipeBlockProps, "itemName" | "suggestion" | "onUse" | "onChange">) {
  if (suggestion && suggestion.length > 0) {
    return (
      <>
        <p className="note-plain">มีสูตรมาตรฐานสำหรับรายการนี้อยู่แล้ว ใช้แล้วปรับตัวเลขให้ตรงกับร้านคุณได้เลย</p>
        <div className="oc-rectable">
          {suggestion.map((row) => (
            <div className="oc-recrow" key={row.ingredientId}>
              <span>{row.ingredientName}</span>
              <span className="num">
                {row.quantity ?? "—"} {row.unit}
              </span>
            </div>
          ))}
        </div>
        <button type="button" className="btn btn--primary btn--wet" onClick={() => onUse(suggestion)}>
          ใช้สูตรนี้แล้วแก้ได้
        </button>
      </>
    );
  }

  return (
    <>
      <p className="note-plain">เริ่มจากบรรทัดว่างแล้วใส่วัตถุดิบทีละอย่าง</p>
      <button
        type="button"
        className="btn btn--outline"
        onClick={() =>
          onChange([{ ingredientId: "", ingredientName: "", quantity: null, unit: "" }])
        }
      >
        เริ่มใส่สูตรเอง
      </button>
    </>
  );
}

function RecipeTable({
  recipe,
  onChange,
}: {
  recipe: RecipeRow[];
  onChange: (recipe: RecipeRow[]) => void;
}) {
  function updateRow(index: number, patch: Partial<RecipeRow>) {
    const next = recipe.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  }

  function addRow() {
    onChange([...recipe, { ingredientId: "", ingredientName: "", quantity: null, unit: "" }]);
  }

  return (
    <>
      <div className="oc-rectable is-edit">
        {recipe.map((row, i) => (
          <div className="oc-recrow" key={row.ingredientId || i}>
            <input
              className="input"
              value={row.ingredientName}
              onChange={(e) => updateRow(i, { ingredientName: e.target.value })}
            />
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
          </div>
        ))}
      </div>
      <button type="button" className="btn btn--quiet" onClick={addRow}>
        เพิ่มวัตถุดิบ
      </button>
    </>
  );
}
