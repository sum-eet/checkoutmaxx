import prisma from "./prisma";

export async function computeBaselines() {
  const shops = await prisma.shop.findMany({ where: { isActive: true } });

  for (const shop of shops) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Only compute baseline after 48h of data (silent learning period — Guardrail #7)
    const firstEvent = await prisma.checkoutEvent.findFirst({
      where: { shopId: shop.id },
      orderBy: { occurredAt: "asc" },
    });
    if (!firstEvent || firstEvent.occurredAt > fortyEightHoursAgo) continue;

    const [started, completed] = await Promise.all([
      prisma.checkoutEvent.count({
        where: {
          shopId: shop.id,
          eventType: "checkout_started",
          occurredAt: { gte: sevenDaysAgo },
        },
      }),
      prisma.checkoutEvent.count({
        where: {
          shopId: shop.id,
          eventType: "checkout_completed",
          occurredAt: { gte: sevenDaysAgo },
        },
      }),
    ]);

    if (started < 20) continue; // Not enough data for reliable baseline

    const cvr = completed / started;

    await prisma.baseline.create({
      data: {
        shopId: shop.id,
        metricName: "checkout_cvr",
        value: cvr,
        windowStart: sevenDaysAgo,
        windowEnd: new Date(),
      },
    });
  }
}
