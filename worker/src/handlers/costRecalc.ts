// WBS 6.9 -- Cost per Cup and Profit Recalculation: the real 'cost_recalc'
// handler, replacing the stub previously inlined in worker/src/handlers/
// index.ts. All arithmetic is delegated to the pure, DB-free functions in
// packages/costing/src/costPerCup.ts -- this file's only job is to fetch
// the rows those functions need, batch the recompute across every affected
// menu item, and upsert the result into menu_item_cost_cache. See
// costPerCup.ts's own header comment for why the WBS prompt's literal
// `costPerCup(menuItemId): Promise<number|null>` DB-querying signature was
// not used verbatim.
//
// TWO TRIGGER SOURCES, ONE PAYLOAD SHAPE with two optional arrays:
//   - purchase confirmation (WBS 6.6, packages/db/migrations/0044/0045's
//     console_confirm_purchase_invoice) enqueues { ingredientIds: uuid[] }
//   - the bom_lines trigger (this WBS entry's own migration,
//     0046_menu_item_cost_cache.sql, standing in for a not-yet-built WBS 6.7
//     BOM editor) enqueues { menuItemIds: uuid[] }
// Both are accepted and unioned: an ingredient id is resolved to every menu
// item whose bom_lines references it (a purchase can move the cost of an
// ingredient used by many drinks); a menu item id is used directly (a BOM
// edit is already scoped to one item, and a delete-down-to-zero-rows still
// needs recomputing to null even though no bom_lines row survives to join
// through).
import { pool } from "../db";
import { log } from "../log";
import { computeCostPerCupSatang, marginSatang, type BomCostRow } from "@brewledger/costing/dist/costPerCup";
import type { Job, JobHandler } from "./types";

interface BomJoinRow {
  menu_item_id: string;
  qty_base_unit: string;
  current_unit_cost_satang: number | null;
}

interface MenuItemRow {
  id: string;
  store_id: string;
  price_satang: number;
}

async function resolveTargetMenuItemIds(
  ingredientIds: string[],
  menuItemIds: string[],
): Promise<string[]> {
  const ids = new Set(menuItemIds);
  if (ingredientIds.length > 0) {
    const { rows } = await pool.query<{ menu_item_id: string }>(
      `select distinct menu_item_id from bom_lines where ingredient_id = any($1::uuid[])`,
      [ingredientIds],
    );
    for (const row of rows) ids.add(row.menu_item_id);
  }
  return Array.from(ids);
}

// Batched, per the WBS 6.9 performance target (a 50-item menu recalculates
// within 60 seconds of confirmation): two round trips total for the whole
// batch of affected menu items -- one for their bom_lines/ingredients join,
// one for their menu_items row -- never one query per item.
async function recomputeMenuItems(menuItemIds: string[]): Promise<void> {
  if (menuItemIds.length === 0) {
    return;
  }

  const [bomResult, menuItemResult] = await Promise.all([
    pool.query<BomJoinRow>(
      `select bl.menu_item_id, bl.qty_base_unit, i.current_unit_cost_satang
         from bom_lines bl
         join ingredients i on i.id = bl.ingredient_id
        where bl.menu_item_id = any($1::uuid[])`,
      [menuItemIds],
    ),
    pool.query<MenuItemRow>(
      `select id, store_id, price_satang from menu_items where id = any($1::uuid[])`,
      [menuItemIds],
    ),
  ]);

  const rowsByMenuItem = new Map<string, BomCostRow[]>();
  for (const r of bomResult.rows) {
    const list = rowsByMenuItem.get(r.menu_item_id) ?? [];
    list.push({ qtyBaseUnit: Number(r.qty_base_unit), ingredientUnitCostSatang: r.current_unit_cost_satang });
    rowsByMenuItem.set(r.menu_item_id, list);
  }

  let succeeded = 0;
  for (const item of menuItemResult.rows) {
    try {
      // No BOM rows at all (never inserted, or the last one just got
      // deleted) -> the empty-array branch of computeCostPerCupSatang,
      // which is `null` -- exactly the RL-2 no-recipe case, never a
      // fabricated 0.
      const rows = rowsByMenuItem.get(item.id) ?? [];
      const costSatang = computeCostPerCupSatang(rows);
      const marginValue = marginSatang(item.price_satang, costSatang);

      await pool.query(
        `insert into menu_item_cost_cache (menu_item_id, store_id, cost_satang, margin_satang, is_stale, computed_at)
         values ($1, $2, $3, $4, false, now())
         on conflict (menu_item_id) do update set
           store_id      = excluded.store_id,
           cost_satang   = excluded.cost_satang,
           margin_satang = excluded.margin_satang,
           is_stale      = false,
           computed_at   = now()`,
        [item.id, item.store_id, costSatang, marginValue],
      );
      succeeded++;
    } catch (err) {
      log.error("cost_recalc: failed for menu item", {
        menu_item_id: item.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // One bad item must not abort the recalc for the rest of the batch.
    }
  }

  log.info("cost_recalc: batch complete", {
    menu_item_count: menuItemResult.rows.length,
    succeeded,
  });
}

function toIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === "string");
}

export const costRecalc: JobHandler = async (job: Job) => {
  const ingredientIds = toIdArray(job.payload.ingredientIds);
  const menuItemIdsFromPayload = toIdArray(job.payload.menuItemIds);

  if (ingredientIds.length === 0 && menuItemIdsFromPayload.length === 0) {
    log.info("cost_recalc: no ingredientIds/menuItemIds in payload, nothing to do", { job_id: job.id });
    return;
  }

  const menuItemIds = await resolveTargetMenuItemIds(ingredientIds, menuItemIdsFromPayload);
  if (menuItemIds.length === 0) {
    log.info("cost_recalc: no menu items reference the given ingredients", { job_id: job.id });
    return;
  }

  await recomputeMenuItems(menuItemIds);
};
