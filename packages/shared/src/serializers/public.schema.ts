// RL-3. Mirrors packages/shared/src/serializers/public.ts field for field.
// Authored independently, not derived via z.infer from the DTO interfaces —
// a mismatch between the TS type and this runtime schema is a signal to fix,
// not something to unify away.
import { z } from "zod";

// This package is isomorphic (Node worker, Deno Edge Function, and — via
// the barrel — apps/console) and carries no "dom"/"node" lib, so `console`
// isn't ambient here the way `admin.ts` handles `window` the same way.
declare const console: { error(...args: unknown[]): void };

export const publicStoreSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  pickupAddress: z.string().nullable(),
  timezone: z.string(),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  promptpayId: z.string().nullable(),
}).strict();

export const publicMenuCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  sortOrder: z.number().int(),
}).strict();

export const publicMenuItemSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  priceSatang: z.number().int().nonnegative(),
  availability: z.enum(["available", "out_of_stock", "hidden"]),
  sortOrder: z.number().int(),
}).strict();

export const publicOptionGroupSchema = z.object({
  id: z.string().uuid(),
  menuItemId: z.string().uuid(),
  name: z.string(),
  isRequired: z.boolean(),
  minSelect: z.number().int().nonnegative(),
  maxSelect: z.number().int().nonnegative(),
  sortOrder: z.number().int(),
}).strict();

export const publicOptionSchema = z.object({
  id: z.string().uuid(),
  optionGroupId: z.string().uuid(),
  name: z.string(),
  priceDeltaSatang: z.number().int(),
  sortOrder: z.number().int(),
}).strict();

export const publicSlotSchema = z.object({
  id: z.string().uuid(),
  slotStart: z.string(),
  slotEnd: z.string(),
  remaining: z.number().int().nonnegative(),
}).strict();

export const publicOrderStatusSchema = z.object({
  orderCode: z.string(),
  status: z.string(),
  pickupAt: z.string().nullable(),
  itemName: z.string(),
  quantity: z.number().int().positive(),
}).strict();

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    // Deliberately do not include result.error.issues' values in the thrown
    // message going to the client-facing response — the invalid VALUE could
    // itself be the leaked field this whole schema exists to catch. Server
    // logs (Edge Function console.error) get the full issue detail; the
    // HTTP response gets a flat 500 with no body detail, same posture as the
    // console-* auth guard's failure mode in _shared/console/auth.ts.
    console.error("public DTO shape violation", result.error.issues);
    throw new Error("internal serialization error");
  }
  return result.data;
}
