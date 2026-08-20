// WBS 5.2 — pure selection-state helpers for ItemOptionsSheet.tsx, split out
// of the component so they can be exercised directly without mounting React
// (WBS 8.2 owns this screen's E2E coverage per .claude/agents/WORKFLOW.md's
// Pattern C, but these stay unit-testable in the meantime).
//
// The prototype's own sheet state (`customer-web.js`'s `S.sheet.opts`,
// shape `{[groupId]: optionId}`) only ever modeled single-select groups —
// both of its demo option groups (`ร้อน / เย็น / ปั่น`, `ระดับความหวาน`) have
// `maxSelect === 1`. This file generalizes that to
// `{[groupId]: optionId[]}` so a `maxSelect > 1` group (e.g. a toppings
// group where a customer can pick up to 3) works the same way a
// single-select group does, with no prototype reference to copy from for
// that case — see docs/design/state_matrix.md's "ตัวเลือกรายการ (sheet)"
// section.
import type { PublicOption, PublicOptionGroup } from "./publicApi";

export type OptionSelections = Record<string, string[]>;

export function toggleOptionSelection(
  current: OptionSelections,
  group: PublicOptionGroup,
  optionId: string,
): OptionSelections {
  const selected = current[group.id] ?? [];

  if (group.maxSelect <= 1) {
    // Single-select: matches the prototype's radio behavior — tapping any
    // option (including the already-selected one) replaces the selection.
    return { ...current, [group.id]: [optionId] };
  }

  if (selected.includes(optionId)) {
    return { ...current, [group.id]: selected.filter((id) => id !== optionId) };
  }
  if (selected.length >= group.maxSelect) {
    // Already at the group's cap — ignore the tap rather than silently
    // bumping an earlier choice off, which would surprise the customer.
    return current;
  }
  return { ...current, [group.id]: [...selected, optionId] };
}

export function isGroupSatisfied(group: PublicOptionGroup, selections: OptionSelections): boolean {
  return (selections[group.id] ?? []).length >= group.minSelect;
}

export function areAllGroupsSatisfied(groups: PublicOptionGroup[], selections: OptionSelections): boolean {
  return groups.every((group) => isGroupSatisfied(group, selections));
}

export function selectedOptionsDeltaSatang(options: PublicOption[], selections: OptionSelections): number {
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
  options: PublicOption[],
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
