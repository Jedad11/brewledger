// WBS 3.7 §7 test contract — "Zod strict-mode extra-key test, one per
// schema in public.schema.ts". Each schema in public.schema.ts is built with
// .strict() specifically so that a field the serializer accidentally starts
// emitting (e.g. a future `costSatang` added to toPublicMenuItem by someone
// who forgot this file exists) fails validation instead of silently passing
// through. This suite proves that guarantee is real, not just that
// `.strict()` appears in the source: for each schema, construct a valid DTO
// (parses clean) and then the SAME object plus one extra key, and assert
// the extra-key version is rejected. Constructing the valid object first,
// and asserting it independently parses, also rules out a schema being
// "vacuously strict" by rejecting even valid input for an unrelated reason.
import { describe, expect, it } from "vitest";
import {
  checkoutDiffSchema,
  publicMenuCategorySchema,
  publicMenuItemSchema,
  publicOptionGroupSchema,
  publicOptionSchema,
  publicOrderCreatedSchema,
  publicOrderStatusSchema,
  publicSlotSchema,
  publicStoreSchema,
} from "./public.schema";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("publicStoreSchema", () => {
  const valid = {
    id: UUID_A,
    slug: "demo-cafe",
    name: "Demo Cafe",
    pickupAddress: "123 Sukhumvit Rd",
    timezone: "Asia/Bangkok",
    opensAt: "07:00:00",
    closesAt: "18:00:00",
    promptpayId: "0811111111",
  };

  it("accepts the valid DTO shape", () => {
    expect(publicStoreSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when an extra key like costSatang is present", () => {
    const result = publicStoreSchema.safeParse({ ...valid, costSatang: 100 });
    expect(result.success).toBe(false);
  });
});

describe("publicMenuCategorySchema", () => {
  const valid = { id: UUID_A, name: "Coffee", sortOrder: 0 };

  it("accepts the valid DTO shape", () => {
    expect(publicMenuCategorySchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when an extra key like merchantId is present", () => {
    const result = publicMenuCategorySchema.safeParse({ ...valid, merchantId: UUID_B });
    expect(result.success).toBe(false);
  });
});

describe("publicMenuItemSchema", () => {
  const valid = {
    id: UUID_A,
    categoryId: UUID_B,
    name: "Latte",
    description: "Espresso with steamed milk",
    imageUrl: null,
    priceSatang: 6500,
    availability: "available" as const,
    sortOrder: 0,
  };

  it("accepts the valid DTO shape", () => {
    expect(publicMenuItemSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when an extra key like costSatang is present", () => {
    const result = publicMenuItemSchema.safeParse({ ...valid, costSatang: 1800 });
    expect(result.success).toBe(false);
  });

  it("rejects when an extra key like marginSatang is present", () => {
    const result = publicMenuItemSchema.safeParse({ ...valid, marginSatang: 4700 });
    expect(result.success).toBe(false);
  });
});

describe("publicOptionGroupSchema", () => {
  const valid = {
    id: UUID_A,
    menuItemId: UUID_B,
    name: "Milk type",
    isRequired: true,
    minSelect: 1,
    maxSelect: 1,
    sortOrder: 0,
  };

  it("accepts the valid DTO shape", () => {
    expect(publicOptionGroupSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when an extra key like storeId is present", () => {
    const result = publicOptionGroupSchema.safeParse({ ...valid, storeId: UUID_A });
    expect(result.success).toBe(false);
  });
});

describe("publicOptionSchema", () => {
  const valid = {
    id: UUID_A,
    optionGroupId: UUID_B,
    name: "Oat milk",
    priceDeltaSatang: 1000,
    sortOrder: 0,
  };

  it("accepts the valid DTO shape", () => {
    expect(publicOptionSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when an extra key like costSatang is present", () => {
    const result = publicOptionSchema.safeParse({ ...valid, costSatang: 300 });
    expect(result.success).toBe(false);
  });
});

describe("publicSlotSchema", () => {
  const valid = {
    id: UUID_A,
    slotStart: "2026-08-19T00:00:00Z",
    slotEnd: "2026-08-19T00:15:00Z",
    remaining: 3,
  };

  it("accepts the valid DTO shape", () => {
    expect(publicSlotSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when an extra key like capacity is present", () => {
    const result = publicSlotSchema.safeParse({ ...valid, capacity: 5 });
    expect(result.success).toBe(false);
  });

  it("rejects when an extra key like bookedCount is present", () => {
    const result = publicSlotSchema.safeParse({ ...valid, bookedCount: 2 });
    expect(result.success).toBe(false);
  });
});

describe("publicOrderStatusSchema", () => {
  const valid = {
    orderCode: "QASNAP01",
    status: "PENDING_PAYMENT",
    pickupAt: null,
    itemName: "Latte",
    quantity: 2,
  };

  it("accepts the valid DTO shape", () => {
    expect(publicOrderStatusSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when an extra key like paymentConfirmedBy is present", () => {
    const result = publicOrderStatusSchema.safeParse({ ...valid, paymentConfirmedBy: "session-abc" });
    expect(result.success).toBe(false);
  });

  it("rejects when an extra key like totalCostSnapshotSatang is present", () => {
    const result = publicOrderStatusSchema.safeParse({
      ...valid,
      totalCostSnapshotSatang: 3600,
    });
    expect(result.success).toBe(false);
  });
});

// WBS 5.4 — checkout_create_order's response DTOs. Same discipline: a valid
// object parses clean, and the identical object plus one cost-shaped extra
// key is rejected -- proving .strict() actually guards this brand-new
// schema and not just the pre-existing ones above.
describe("publicOrderCreatedSchema", () => {
  const valid = {
    orderCode: "3B4CDE",
    totalSatang: 19500,
    pickupAt: "2026-08-21T04:00:00Z",
    expiresAt: "2026-08-20T17:00:00Z",
    items: [
      {
        name: "Latte",
        quantity: 3,
        unitPriceSatang: 6500,
        options: [{ name: "Oat milk", priceDeltaSatang: 1000 }],
      },
    ],
  };

  it("accepts the valid DTO shape", () => {
    expect(publicOrderCreatedSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects when an extra top-level key like totalCostSnapshotSatang is present", () => {
    const result = publicOrderCreatedSchema.safeParse({ ...valid, totalCostSnapshotSatang: 8200 });
    expect(result.success).toBe(false);
  });

  it("rejects when an extra key like unitCostSnapshotSatang is present on a LINE ITEM (nested .strict())", () => {
    const result = publicOrderCreatedSchema.safeParse({
      ...valid,
      items: [{ ...valid.items[0], unitCostSnapshotSatang: 1800 }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects when an extra key like marginSatang is present on a LINE ITEM OPTION (nested .strict(), two levels deep)", () => {
    const result = publicOrderCreatedSchema.safeParse({
      ...valid,
      items: [{ ...valid.items[0], options: [{ ...valid.items[0].options[0], marginSatang: 200 }] }],
    });
    expect(result.success).toBe(false);
  });
});

describe("checkoutDiffSchema", () => {
  const priceChanged = {
    lineIndex: 0,
    kind: "price_changed" as const,
    menuItemId: UUID_A,
    nameSnapshot: "Latte",
    oldSatang: 6000,
    newSatang: 6500,
  };

  it("accepts a valid price_changed diff", () => {
    expect(checkoutDiffSchema.safeParse(priceChanged).success).toBe(true);
  });

  it("accepts a valid item_removed diff", () => {
    const result = checkoutDiffSchema.safeParse({
      lineIndex: 1,
      kind: "item_removed",
      menuItemId: UUID_A,
      nameSnapshot: "Discontinued Cookie",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid option_price_changed diff", () => {
    const result = checkoutDiffSchema.safeParse({
      lineIndex: 0,
      kind: "option_price_changed",
      menuItemId: UUID_A,
      groupId: UUID_B,
      optionId: UUID_A,
      name: "Oat milk",
      oldSatang: 1000,
      newSatang: 1500,
    });
    expect(result.success).toBe(true);
  });

  it("rejects when an extra key like costSatang is present on a diff", () => {
    const result = checkoutDiffSchema.safeParse({ ...priceChanged, costSatang: 1800 });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown kind (not one of the five defined variants)", () => {
    const result = checkoutDiffSchema.safeParse({ ...priceChanged, kind: "something_else" });
    expect(result.success).toBe(false);
  });
});
