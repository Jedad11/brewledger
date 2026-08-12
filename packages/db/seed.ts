// Demo store seed — WBS 3.4.
//
// Produces: one merchant, one store, 8 menu items with option groups,
// 6 ingredients, BOM on exactly 4 of the 8 menu items (so the null-cost
// path — RL-2's "menu item with zero recipe rows" — is exercised by every
// dev database by default), a week of pick-up time slots, and 30 historical
// orders spread across 14+ days so month-over-month report queries (Phase 7)
// return non-trivial results.
import { PrismaClient, BaseUnit, Channel, OrderStatus, PaymentStatus, FeeBearer } from "@prisma/client";

const prisma = new PrismaClient();

// No 0/O or 1/I — order-code alphabet per WBS 2.6. Duplicated here (rather
// than imported from @brewledger/shared) so the seed script has no
// cross-package dependency at db-migration time.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function generateOrderCode(seedIndex: number): string {
  let code = "";
  let n = seedIndex + 100000;
  for (let i = 0; i < 6; i++) {
    code = CODE_ALPHABET[n % CODE_ALPHABET.length] + code;
    n = Math.floor(n / CODE_ALPHABET.length) + seedIndex * 7;
  }
  return code;
}

function daysAgo(days: number, hour = 9, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  const merchant = await prisma.merchant.upsert({
    where: { phone: "+66812345678" },
    update: {},
    create: {
      phone: "+66812345678",
      displayName: "Somchai's Coffee Corner",
      tier: "FREE",
      absorbGatewayFee: true,
      gatewayProvider: "2c2p",
      gatewayMerchantId: "2c2p_merchant_demo_001",
      gatewayKycStatus: "VERIFIED",
    },
  });

  const store = await prisma.store.upsert({
    where: { slug: "somchai-coffee" },
    update: {},
    create: {
      merchantId: merchant.id,
      slug: "somchai-coffee",
      name: "Somchai's Coffee Corner",
      pickupAddress: "123 Sukhumvit Soi 5, Khlong Toei, Bangkok",
      timezone: "Asia/Bangkok",
      openTime: "07:00",
      closeTime: "17:00",
      isAcceptingOrders: true,
    },
  });

  // --- Ingredients (6) ---------------------------------------------------
  const ingredientDefs = [
    { name: "Coffee Beans", baseUnit: BaseUnit.G, unitCostSatang: 150, reorderPoint: 500 },
    { name: "Milk", baseUnit: BaseUnit.ML, unitCostSatang: 8, reorderPoint: 3000 },
    { name: "Sugar Syrup", baseUnit: BaseUnit.ML, unitCostSatang: 5, reorderPoint: 1000 },
    { name: "Matcha Powder", baseUnit: BaseUnit.G, unitCostSatang: 200, reorderPoint: 200 },
    { name: "Thai Tea Mix", baseUnit: BaseUnit.G, unitCostSatang: 120, reorderPoint: 300 },
    { name: "Cup (16oz)", baseUnit: BaseUnit.PIECE, unitCostSatang: 300, reorderPoint: 100 },
  ];
  const ingredients: Record<string, Awaited<ReturnType<typeof prisma.ingredient.create>>> = {};
  for (const def of ingredientDefs) {
    const existing = await prisma.ingredient.findFirst({ where: { storeId: store.id, name: def.name } });
    ingredients[def.name] = existing ?? (await prisma.ingredient.create({ data: { storeId: store.id, ...def } }));
  }

  // --- Menu items (8) — BOM on exactly 4, so 4 stay null-cost (RL-2) -----
  const menuDefs = [
    { name: "Espresso", priceSatang: 4500, category: "Coffee", bom: null },
    { name: "Americano", priceSatang: 5000, category: "Coffee", bom: null },
    {
      name: "Latte",
      priceSatang: 6000,
      category: "Coffee",
      bom: [
        { ingredient: "Coffee Beans", qty: 18 },
        { ingredient: "Milk", qty: 200 },
        { ingredient: "Cup (16oz)", qty: 1 },
      ],
    },
    {
      name: "Cappuccino",
      priceSatang: 6000,
      category: "Coffee",
      bom: [
        { ingredient: "Coffee Beans", qty: 18 },
        { ingredient: "Milk", qty: 150 },
        { ingredient: "Cup (16oz)", qty: 1 },
      ],
    },
    { name: "Iced Latte", priceSatang: 6500, category: "Cold", bom: null },
    {
      name: "Matcha Latte",
      priceSatang: 7000,
      category: "Cold",
      bom: [
        { ingredient: "Matcha Powder", qty: 8 },
        { ingredient: "Milk", qty: 200 },
        { ingredient: "Cup (16oz)", qty: 1 },
      ],
    },
    {
      name: "Thai Tea",
      priceSatang: 5500,
      category: "Cold",
      bom: [
        { ingredient: "Thai Tea Mix", qty: 15 },
        { ingredient: "Sugar Syrup", qty: 30 },
        { ingredient: "Cup (16oz)", qty: 1 },
      ],
    },
    { name: "Butter Croissant", priceSatang: 4000, category: "Bakery", bom: null },
  ];

  const menuItems: { id: string; name: string; priceSatang: number; hasBom: boolean }[] = [];
  for (const def of menuDefs) {
    const existing = await prisma.menuItem.findFirst({ where: { storeId: store.id, name: def.name } });
    const item =
      existing ??
      (await prisma.menuItem.create({
        data: {
          storeId: store.id,
          name: def.name,
          priceSatang: def.priceSatang,
          category: def.category,
          isActive: true,
        },
      }));

    if (!existing) {
      const tempGroup = await prisma.optionGroup.create({
        data: {
          menuItemId: item.id,
          name: "Temperature",
          isRequired: true,
          minSelect: 1,
          maxSelect: 1,
          options: { create: [{ name: "Hot", priceDeltaSatang: 0 }, { name: "Iced", priceDeltaSatang: 500 }] },
        },
      });
      await prisma.optionGroup.create({
        data: {
          menuItemId: item.id,
          name: "Sweetness",
          isRequired: false,
          minSelect: 0,
          maxSelect: 1,
          options: {
            create: [
              { name: "0%", priceDeltaSatang: 0 },
              { name: "50%", priceDeltaSatang: 0 },
              { name: "100%", priceDeltaSatang: 0 },
            ],
          },
        },
      });
      void tempGroup;

      if (def.bom) {
        for (const line of def.bom) {
          await prisma.bomLine.create({
            data: {
              menuItemId: item.id,
              ingredientId: ingredients[line.ingredient].id,
              qtyBaseUnit: line.qty,
              isSuggested: true,
            },
          });
        }
      }
    }

    menuItems.push({ id: item.id, name: item.name, priceSatang: item.priceSatang, hasBom: def.bom !== null });
  }

  // --- Time slots: one week ahead, every 30 min, 07:00-17:00, capacity 5 -
  const slotCapacity = 5;
  for (let day = 0; day < 7; day++) {
    const base = new Date();
    base.setDate(base.getDate() + day);
    for (let minutes = 7 * 60; minutes < 17 * 60; minutes += 30) {
      const slotStart = new Date(base);
      slotStart.setHours(0, minutes, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
      await prisma.timeSlot.upsert({
        where: { storeId_slotStart: { storeId: store.id, slotStart } },
        update: {},
        create: { storeId: store.id, slotStart, slotEnd, capacity: slotCapacity, bookedCount: 0 },
      });
    }
  }

  // --- 30 historical orders spread across 14+ days -----------------------
  const existingOrderCount = await prisma.order.count({ where: { storeId: store.id } });
  if (existingOrderCount === 0) {
    const statusPlan: { status: OrderStatus; channel: Channel }[] = [
      ...Array(20).fill({ status: OrderStatus.COLLECTED, channel: Channel.ONLINE }),
      ...Array(4).fill({ status: OrderStatus.COLLECTED, channel: Channel.CASH }),
      { status: OrderStatus.CANCELLED, channel: Channel.ONLINE },
      { status: OrderStatus.CANCELLED, channel: Channel.ONLINE },
      { status: OrderStatus.REFUNDED, channel: Channel.ONLINE },
      { status: OrderStatus.PENDING_PAYMENT, channel: Channel.ONLINE },
      { status: OrderStatus.PENDING_PAYMENT, channel: Channel.ONLINE },
      { status: OrderStatus.PREPARING, channel: Channel.ONLINE },
    ];

    for (let i = 0; i < statusPlan.length; i++) {
      const plan = statusPlan[i];
      const ageDays = Math.floor((i / statusPlan.length) * 20); // spread across ~20 days
      const createdAt = daysAgo(ageDays, 7 + (i % 10), (i * 7) % 60);

      const itemCount = 1 + (i % 3);
      const chosen = Array.from({ length: itemCount }, (_, k) => menuItems[(i + k) % menuItems.length]);

      let subtotalSatang = 0;
      const orderItemsData = chosen.map((mi) => {
        const qty = 1 + (i % 2);
        subtotalSatang += mi.priceSatang * qty;
        return {
          menuItemId: mi.id,
          nameSnapshot: mi.name,
          qty,
          unitPriceSatang: mi.priceSatang,
          optionsJson: { temperature: i % 2 === 0 ? "Hot" : "Iced" },
          unitCostSatang: mi.hasBom ? Math.round(mi.priceSatang * 0.35) : null,
        };
      });

      const isPaid = plan.status !== OrderStatus.PENDING_PAYMENT;
      const gatewayFeeSatang = plan.channel === Channel.ONLINE && isPaid ? Math.round(subtotalSatang * 0.02) : 0;

      const order = await prisma.order.create({
        data: {
          storeId: store.id,
          publicCode: generateOrderCode(i),
          customerPhone: `+66890000${String(100 + i).slice(-3)}`,
          channel: plan.channel,
          status: plan.status,
          subtotalSatang,
          totalSatang: subtotalSatang,
          gatewayFeeSatang,
          feeBorneBy: FeeBearer.PLATFORM,
          createdAt,
          paidAt: isPaid ? createdAt : null,
          items: { create: orderItemsData },
        },
      });

      if (plan.channel === Channel.ONLINE && isPaid) {
        await prisma.payment.create({
          data: {
            orderId: order.id,
            provider: merchant.gatewayProvider ?? "2c2p",
            providerChargeId: `chg_demo_${i}_${order.id.slice(0, 8)}`,
            amountSatang: subtotalSatang,
            feeSatang: gatewayFeeSatang,
            status: plan.status === OrderStatus.REFUNDED ? PaymentStatus.REFUNDED : PaymentStatus.PAID,
            idempotencyKey: `idem_demo_${i}_${order.id.slice(0, 8)}`,
            rawPayload: { demo: true, orderIndex: i },
            settledToMerchantAccount: merchant.gatewayMerchantId ?? "unknown",
          },
        });
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log(`Seed complete: merchant=${merchant.id} store=${store.slug} menuItems=${menuItems.length}`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
