// WBS 5.12 — pure selection-state helpers for the quick-sale option sheet.
// Mirrors apps/shop/src/lib/optionSelection.ts's logic (replace-on-tap for
// maxSelect<=1, toggle-with-cap otherwise) rather than importing it — this
// app may never import apps/shop (eslint.config.mjs, RL-3 boundary), and
// the shape is small enough that duplicating it here is cheaper than
// inventing a third shared location for two call sites. Any bug fix to the
// selection logic itself must be applied in both places.
export interface QuickSaleOptionGroup {
  id: string;
  menuItemId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
}

export interface QuickSaleOption {
  id: string;
  optionGroupId: string;
  name: string;
  priceDeltaSatang: number;
  sortOrder: number;
}

export type OptionSelections = Record<string, string[]>;

export function toggleOptionSelection(
  current: OptionSelections,
  group: QuickSaleOptionGroup,
  optionId: string,
): OptionSelections {
  const selected = current[group.id] ?? [];

  if (group.maxSelect <= 1) {
    return { ...current, [group.id]: [optionId] };
  }

  if (selected.includes(optionId)) {
    return { ...current, [group.id]: selected.filter((id) => id !== optionId) };
  }
  if (selected.length >= group.maxSelect) {
    return current;
  }
  return { ...current, [group.id]: [...selected, optionId] };
}

export function isGroupSatisfied(group: QuickSaleOptionGroup, selections: OptionSelections): boolean {
  return (selections[group.id] ?? []).length >= group.minSelect;
}

export function areAllGroupsSatisfied(groups: QuickSaleOptionGroup[], selections: OptionSelections): boolean {
  return groups.every((group) => isGroupSatisfied(group, selections));
}

export function selectedOptionsDeltaSatang(options: QuickSaleOption[], selections: OptionSelections): number {
  const selectedIds = new Set(Object.values(selections).flat());
  return options
    .filter((option) => selectedIds.has(option.id))
    .reduce((sum, option) => sum + option.priceDeltaSatang, 0);
}

export interface CartOptionSelection {
  groupId: string;
  optionId: string;
  name: string;
  deltaSatang: number;
}

export function selectedOptionsForCart(
  options: QuickSaleOption[],
  selections: OptionSelections,
): CartOptionSelection[] {
  const result: CartOptionSelection[] = [];
  for (const [groupId, optionIds] of Object.entries(selections)) {
    for (const optionId of optionIds) {
      const option = options.find((o) => o.id === optionId);
      if (option) {
        result.push({ groupId, optionId, name: option.name, deltaSatang: option.priceDeltaSatang });
      }
    }
  }
  return result;
}

/**
 * WBS 5.12 — the fast tap-to-add path never opens the sheet, so it must
 * synthesize a valid default selection itself: the first option (by
 * sortOrder) in every REQUIRED group (minSelect >= 1). Optional groups
 * (minSelect === 0) are left unselected by default — skipping them doesn't
 * violate anything, and picking one silently on the customer's behalf would
 * be a real choice this function has no basis to make. No "most common
 * option set" is persisted anywhere in the schema for this to read instead
 * (documented judgment call, not a spec gap).
 */
export function defaultSelectionsForGroups(
  groups: QuickSaleOptionGroup[],
  optionsByGroup: Map<string, QuickSaleOption[]>,
): OptionSelections {
  const selections: OptionSelections = {};
  for (const group of groups) {
    if (group.minSelect < 1) continue;
    const groupOptions = [...(optionsByGroup.get(group.id) ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    if (groupOptions.length > 0) {
      selections[group.id] = [groupOptions[0].id];
    }
  }
  return selections;
}
