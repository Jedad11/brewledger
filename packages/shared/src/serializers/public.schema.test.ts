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
  publicMenuCategorySchema,
  publicMenuItemSchema,
  publicOptionGroupSchema,
  publicOptionSchema,
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
