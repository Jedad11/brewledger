// WBS 5.12 qa_engineer leg — pure selection-state helper unit tests, with
// primary focus on defaultSelectionsForGroups: the fast tap-to-add path
// (long-press never invoked) relies on this function to synthesize a valid
// default selection so the one-tap-per-drink target holds. No DB/network
// dependency, same posture as cart.test.ts.
import { describe, expect, it } from "vitest";
import {
  areAllGroupsSatisfied,
  defaultSelectionsForGroups,
  isGroupSatisfied,
  selectedOptionsDeltaSatang,
  selectedOptionsForCart,
  toggleOptionSelection,
  type QuickSaleOption,
  type QuickSaleOptionGroup,
} from "./optionSelection";

const requiredSizeGroup: QuickSaleOptionGroup = {
  id: "size-group",
  menuItemId: "item-1",
  name: "Size",
  minSelect: 1,
  maxSelect: 1,
  sortOrder: 0,
};
const requiredMultiGroup: QuickSaleOptionGroup = {
  id: "topping-group",
  menuItemId: "item-1",
  name: "Toppings",
  minSelect: 1,
  maxSelect: 2,
  sortOrder: 1,
};
const optionalGroup: QuickSaleOptionGroup = {
  id: "sweetness-group",
  menuItemId: "item-1",
  name: "Sweetness",
  minSelect: 0,
  maxSelect: 1,
  sortOrder: 2,
};

const sizeSmall: QuickSaleOption = { id: "size-s", optionGroupId: "size-group", name: "Small", priceDeltaSatang: 0, sortOrder: 0 };
const sizeLarge: QuickSaleOption = { id: "size-l", optionGroupId: "size-group", name: "Large", priceDeltaSatang: 1000, sortOrder: 1 };
const toppingPearl: QuickSaleOption = { id: "top-pearl", optionGroupId: "topping-group", name: "Pearl", priceDeltaSatang: 500, sortOrder: 0 };
const toppingJelly: QuickSaleOption = { id: "top-jelly", optionGroupId: "topping-group", name: "Jelly", priceDeltaSatang: 500, sortOrder: 1 };
const sweetFull: QuickSaleOption = { id: "sweet-100", optionGroupId: "sweetness-group", name: "100%", priceDeltaSatang: 0, sortOrder: 0 };

describe("defaultSelectionsForGroups", () => {
  it("selects the first option (by sortOrder) in every REQUIRED group (minSelect >= 1)", () => {
    const optionsByGroup = new Map<string, QuickSaleOption[]>([
      ["size-group", [sizeLarge, sizeSmall]], // deliberately out of sortOrder to prove sorting happens
      ["topping-group", [toppingJelly, toppingPearl]],
    ]);
    const selections = defaultSelectionsForGroups([requiredSizeGroup, requiredMultiGroup], optionsByGroup);
    expect(selections).toEqual({
      "size-group": ["size-s"], // sortOrder 0, not sortOrder-in-array-position
      "topping-group": ["top-pearl"], // same: lowest sortOrder wins regardless of array order
    });
  });

  it("leaves an OPTIONAL group (minSelect === 0) unselected by default — never silently picks on the customer's behalf", () => {
    const optionsByGroup = new Map<string, QuickSaleOption[]>([["sweetness-group", [sweetFull]]]);
    const selections = defaultSelectionsForGroups([optionalGroup], optionsByGroup);
    expect(selections).toEqual({});
  });

  it("a required group with no options configured at all is skipped, not populated with an empty/invalid entry", () => {
    const optionsByGroup = new Map<string, QuickSaleOption[]>(); // no entry for size-group
    const selections = defaultSelectionsForGroups([requiredSizeGroup], optionsByGroup);
    expect(selections).toEqual({});
  });

  it("mixed required + optional groups on the same item: only required groups get a default, in one call", () => {
    const optionsByGroup = new Map<string, QuickSaleOption[]>([
      ["size-group", [sizeSmall, sizeLarge]],
      ["sweetness-group", [sweetFull]],
    ]);
    const selections = defaultSelectionsForGroups([requiredSizeGroup, optionalGroup], optionsByGroup);
    expect(selections).toEqual({ "size-group": ["size-s"] });
  });

  it("the resulting default selection satisfies areAllGroupsSatisfied for every required group — the one-tap-per-drink path never opens the sheet for a validation failure", () => {
    const optionsByGroup = new Map<string, QuickSaleOption[]>([
      ["size-group", [sizeSmall, sizeLarge]],
      ["topping-group", [toppingPearl, toppingJelly]],
    ]);
    const selections = defaultSelectionsForGroups([requiredSizeGroup, requiredMultiGroup], optionsByGroup);
    expect(areAllGroupsSatisfied([requiredSizeGroup, requiredMultiGroup], selections)).toBe(true);
  });
});

describe("toggleOptionSelection", () => {
  it("a single-select group (maxSelect<=1) REPLACES the current selection on tap, never accumulates", () => {
    let selections = toggleOptionSelection({}, requiredSizeGroup, "size-s");
    selections = toggleOptionSelection(selections, requiredSizeGroup, "size-l");
    expect(selections["size-group"]).toEqual(["size-l"]); // replaced, not ["size-s","size-l"]
  });

  it("a multi-select group toggles: tapping a selected option removes it", () => {
    let selections = toggleOptionSelection({}, requiredMultiGroup, "top-pearl");
    selections = toggleOptionSelection(selections, requiredMultiGroup, "top-pearl");
    expect(selections["topping-group"]).toEqual([]);
  });

  it("a multi-select group at its maxSelect cap ignores a tap on a new option (no-op, returns the same reference)", () => {
    let selections = toggleOptionSelection({}, requiredMultiGroup, "top-pearl");
    selections = toggleOptionSelection(selections, requiredMultiGroup, "top-jelly");
    expect(selections["topping-group"]).toEqual(["top-pearl", "top-jelly"]); // at cap of 2
    const atCap = toggleOptionSelection(selections, requiredMultiGroup, "top-extra");
    expect(atCap).toBe(selections); // same reference — no mutation, no silent overflow
  });
});

describe("isGroupSatisfied / areAllGroupsSatisfied", () => {
  it("a required group with zero selections is not satisfied", () => {
    expect(isGroupSatisfied(requiredSizeGroup, {})).toBe(false);
  });

  it("an optional group with zero selections IS satisfied (minSelect 0)", () => {
    expect(isGroupSatisfied(optionalGroup, {})).toBe(true);
  });

  it("areAllGroupsSatisfied is false if even one required group is missing its selection", () => {
    const selections = { "size-group": ["size-s"] }; // topping-group (required) missing
    expect(areAllGroupsSatisfied([requiredSizeGroup, requiredMultiGroup], selections)).toBe(false);
  });
});

describe("selectedOptionsDeltaSatang / selectedOptionsForCart", () => {
  it("sums priceDeltaSatang for every selected option id across groups", () => {
    const selections = { "size-group": ["size-l"], "topping-group": ["top-pearl", "top-jelly"] };
    const total = selectedOptionsDeltaSatang([sizeSmall, sizeLarge, toppingPearl, toppingJelly], selections);
    expect(total).toBe(1000 + 500 + 500);
  });

  it("selectedOptionsForCart resolves each selected id to its full cart-line shape (groupId/optionId/name/deltaSatang)", () => {
    const selections = { "size-group": ["size-l"] };
    const result = selectedOptionsForCart([sizeSmall, sizeLarge], selections);
    expect(result).toEqual([{ groupId: "size-group", optionId: "size-l", name: "Large", deltaSatang: 1000 }]);
  });

  it("an unresolvable optionId (not present in the options list) is silently skipped rather than producing a broken cart line", () => {
    const selections = { "size-group": ["nonexistent-id"] };
    const result = selectedOptionsForCart([sizeSmall, sizeLarge], selections);
    expect(result).toEqual([]);
  });
});
