# Data Dictionary

Every column in `packages/db/prisma/schema.prisma` is classified below as
either `PUBLIC_SAFE` (may appear in a Customer Web / `/api/public/*`
response) or `MERCHANT_ONLY` (must never leave `/api/console/*` — RL-3).

This is the acceptance artefact for WBS 3.3 ("every column is classified,
and the classification file has no `UNCLASSIFIED` entries") and the input
`/docs/route_map.md`'s per-route permitted-field table (2.2) is checked
against.

## Merchant

| Column | Classification |
|---|---|
| id | MERCHANT_ONLY |
| phone | MERCHANT_ONLY |
| displayName | PUBLIC_SAFE *(store display name is public; merchant record itself is never fetched by the public API)* |
| tier | MERCHANT_ONLY |
| absorbGatewayFee | MERCHANT_ONLY |
| gatewayProvider | MERCHANT_ONLY |
| gatewayMerchantId | MERCHANT_ONLY |
| gatewayKycStatus | MERCHANT_ONLY |
| createdAt | MERCHANT_ONLY |

## StaffUser

All columns MERCHANT_ONLY — no public route ever resolves a staff record.

## Store

| Column | Classification |
|---|---|
| id | MERCHANT_ONLY *(internal id; public routes resolve by `slug`)* |
| merchantId | MERCHANT_ONLY |
| slug | PUBLIC_SAFE |
| name | PUBLIC_SAFE |
| pickupAddress | PUBLIC_SAFE |
| timezone | PUBLIC_SAFE |
| openTime / closeTime | PUBLIC_SAFE |
| isAcceptingOrders | PUBLIC_SAFE |

## MenuItem

| Column | Classification |
|---|---|
| id | PUBLIC_SAFE |
| storeId | MERCHANT_ONLY *(never serialized directly; resolved via store slug)* |
| name | PUBLIC_SAFE |
| priceSatang | PUBLIC_SAFE |
| category | PUBLIC_SAFE |
| imageUrl | PUBLIC_SAFE |
| isActive | MERCHANT_ONLY *(inactive items are filtered out, not shown as a flag)* |
| bomLines (relation) | MERCHANT_ONLY |

## OptionGroup / Option

All columns PUBLIC_SAFE (needed to render the ordering UI) except internal
foreign keys, which are MERCHANT_ONLY in the sense that they are never
serialized as bare ids outside their nested parent.

## TimeSlot

| Column | Classification |
|---|---|
| id | PUBLIC_SAFE |
| storeId | MERCHANT_ONLY |
| slotStart / slotEnd | PUBLIC_SAFE |
| capacity | MERCHANT_ONLY |
| bookedCount | MERCHANT_ONLY *(public view only ever needs a derived `isFull` boolean, never the raw count or capacity — WBS 5.x)* |

## Order

| Column | Classification |
|---|---|
| id | MERCHANT_ONLY |
| storeId | MERCHANT_ONLY |
| publicCode | PUBLIC_SAFE |
| customerPhone | MERCHANT_ONLY *(PII; public status lookup requires it as input, never returns it)* |
| timeSlotId | MERCHANT_ONLY |
| channel | MERCHANT_ONLY |
| status | PUBLIC_SAFE |
| subtotalSatang | MERCHANT_ONLY |
| totalSatang | PUBLIC_SAFE *("total paid" only, on the customer's own order* |
| gatewayFeeSatang | MERCHANT_ONLY |
| feeBorneBy | MERCHANT_ONLY |
| createdAt / paidAt | MERCHANT_ONLY |

## OrderItem

| Column | Classification |
|---|---|
| nameSnapshot, qty, unitPriceSatang, optionsJson | PUBLIC_SAFE *(on the customer's own order only)* |
| unitCostSatang | **MERCHANT_ONLY** — never leaves `/api/console/*` under any circumstance |

## Payment

All columns MERCHANT_ONLY. Customer Web never reads the `Payment` table
directly; order status alone (`Order.status`) is sufficient to render the
tracking page.

## Ingredient, BomLine, StockLedger, CostHistory, Expense, ExpenseLine

Every column on every one of these six tables is **MERCHANT_ONLY**. They
exist purely for Owner Console costing/inventory features (Phase 6) and have
no public read path by construction.
