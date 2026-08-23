// WBS 5.12 qa_engineer leg — pure local-cart helper unit tests. No Supabase
// import in cart.ts (purely local until the รับเงินสด tap), so no mocking
// boundary is needed here — plain function-in, value-out tests, same
// "no DB/network dependency" posture as optionSelection.test.ts.
import { describe, expect, it } from "vitest";
import { addToCart, cartCups, cartTotalSatang, quantityInCartForItem, type QuickCartLine } from "./cart";
import type { CartOptionSelection } from "./optionSelection";

const LATTE_ID = "11111111-1111-4111-8111-111111111111";
const COOKIE_ID = "22222222-2222-4222-8222-222222222222";

const oatMilk: CartOptionSelection = { groupId: "milk-group", optionId: "oat-milk", name: "Oat Milk", deltaSatang: 1000 };
const soyMilk: CartOptionSelection = { groupId: "milk-group", optionId: "soy-milk", name: "Soy Milk", deltaSatang: 500 };

describe("addToCart", () => {
  it("adding a brand-new item (empty cart) creates a new line with quantity 1", () => {
    const cart = addToCart([], { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [] });
    expect(cart).toEqual<QuickCartLine[]>([
      { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [], quantity: 1 },
    ]);
  });

  it("tapping the SAME item with the SAME options again merges into the existing line, incrementing quantity, rather than adding a second line", () => {
    let cart = addToCart([], { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [oatMilk] });
    cart = addToCart(cart, { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [oatMilk] });
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
  });

  it("the SAME item with a DIFFERENT option combo creates a SEPARATE line, not merged", () => {
    let cart = addToCart([], { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [oatMilk] });
    cart = addToCart(cart, { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [soyMilk] });
    expect(cart).toHaveLength(2);
    expect(cart[0].quantity).toBe(1);
    expect(cart[1].quantity).toBe(1);
  });

  it("merges by option-combo regardless of the ORDER options were selected in (a multi-select group tapped in a different tap order still merges)", () => {
    const groupOptionA: CartOptionSelection = { groupId: "toppings", optionId: "pearls", name: "Pearls", deltaSatang: 500 };
    const groupOptionB: CartOptionSelection = { groupId: "toppings", optionId: "jelly", name: "Jelly", deltaSatang: 500 };

    let cart = addToCart([], { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [groupOptionA, groupOptionB] });
    cart = addToCart(cart, { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [groupOptionB, groupOptionA] });
    expect(cart).toHaveLength(1); // same combo, different tap order -> still one line
    expect(cart[0].quantity).toBe(2);
  });

  it("a different menuItemId with the SAME options never merges into an existing line", () => {
    let cart = addToCart([], { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [] });
    cart = addToCart(cart, { menuItemId: COOKIE_ID, nameSnapshot: "Cookie", unitPriceSatang: 3000, options: [] });
    expect(cart).toHaveLength(2);
  });

  it("does not mutate the input array (returns a new array each time)", () => {
    const original: QuickCartLine[] = [];
    const result = addToCart(original, { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [] });
    expect(original).toHaveLength(0); // untouched
    expect(result).not.toBe(original);
  });
});

describe("cartTotalSatang", () => {
  it("sums (unitPrice + option deltas) * quantity across every line", () => {
    const cart: QuickCartLine[] = [
      { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [oatMilk], quantity: 2 }, // (6000+1000)*2 = 14000
      { menuItemId: COOKIE_ID, nameSnapshot: "Cookie", unitPriceSatang: 3000, options: [], quantity: 1 }, // 3000
    ];
    expect(cartTotalSatang(cart)).toBe(17000);
  });

  it("an empty cart totals 0 (a legitimate empty running total, not an unknown-cost null)", () => {
    expect(cartTotalSatang([])).toBe(0);
  });
});

describe("cartCups", () => {
  it("sums quantity across every line regardless of option combo", () => {
    const cart: QuickCartLine[] = [
      { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [oatMilk], quantity: 2 },
      { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [soyMilk], quantity: 1 },
    ];
    expect(cartCups(cart)).toBe(3);
  });
});

describe("quantityInCartForItem", () => {
  it("sums quantity across ALL lines for a given menuItemId, regardless of which option combo each line carries — the tile badge count", () => {
    const cart: QuickCartLine[] = [
      { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [oatMilk], quantity: 2 },
      { menuItemId: LATTE_ID, nameSnapshot: "Latte", unitPriceSatang: 6000, options: [soyMilk], quantity: 3 },
      { menuItemId: COOKIE_ID, nameSnapshot: "Cookie", unitPriceSatang: 3000, options: [], quantity: 5 },
    ];
    expect(quantityInCartForItem(cart, LATTE_ID)).toBe(5);
    expect(quantityInCartForItem(cart, COOKIE_ID)).toBe(5);
  });

  it("returns 0 for an item not in the cart at all", () => {
    expect(quantityInCartForItem([], LATTE_ID)).toBe(0);
  });
});
