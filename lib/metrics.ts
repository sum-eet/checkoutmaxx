import prisma from "./prisma";

export type DateRange = { start: Date; end: Date };

export type FunnelStep = {
  step: string;
  label: string;
  sessions: number;
  pct: number;
  dropPct: number;
};

export type KpiMetrics = {
  checkoutsStarted: number;
  completedOrders: number;
  cvr: number;
  cvrDelta: number | null;
  baselineCvr: number | null;
};

export type LiveEvent = {
  id: string;
  eventType: string;
  sessionId: string;
  deviceType: string | null;
  country: string | null;
  discountCode: string | null;
  totalPrice: number | null;
  currency: string | null;
  errorMessage: string | null;
  occurredAt: Date;
};

export type TopError = {
  type: string;
  label: string;
  count: number;
};

export type DroppedProduct = {
  title: string;
  count: number;
  pctOfDrops: number;
};

export type StatusBannerState = "healthy" | "critical" | "learning" | "no_data";

export type StatusResult = {
  state: StatusBannerState;
  activeAlert?: { title: string; id: string };
};

const FUNNEL_STEPS = [
  { step: "checkout_started", label: "Checkout Started" },
  { step: "checkout_contact_info_submitted", label: "Contact Info" },
  { step: "checkout_address_info_submitted", label: "Address" },
  { step: "checkout_shipping_info_submitted", label: "Shipping" },
  { step: "payment_info_submitted", label: "Payment" },
  { step: "checkout_completed", label: "Completed" },
];

export async function getShopByDomain(shopDomain: string) {
  return prisma.shop.findUnique({ where: { shopDomain } });
}

export async function getKpiMetrics(shopId: string, range: DateRange): Promise<KpiMetrics> {
  const where = { shopId, occurredAt: { gte: range.start, lte: range.end } };

  const [started, completed, baseline] = await Promise.all([
    prisma.checkoutEvent.findMany({
      where: { ...where, eventType: "checkout_started" },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
    prisma.checkoutEvent.findMany({
      where: { ...where, eventType: "checkout_completed" },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
    prisma.baseline.findFirst({
      where: { shopId, metricName: "checkout_cvr" },
      orderBy: { computedAt: "desc" },
    }),
  ]);

  const checkoutsStarted = started.length;
  const completedOrders = completed.length;
  const cvr = checkoutsStarted > 0 ? completedOrders / checkoutsStarted : 0;
  const baselineCvr = baseline?.value ?? null;
  const cvrDelta = baselineCvr !== null ? cvr - baselineCvr : null;

  return { checkoutsStarted, completedOrders, cvr, cvrDelta, baselineCvr };
}

export async function getFunnelMetrics(
  shopId: string,
  range: DateRange,
  device?: string,
  country?: string
): Promise<FunnelStep[]> {
  const baseWhere: Record<string, unknown> = {
    shopId,
    occurredAt: { gte: range.start, lte: range.end },
  };
  if (device) baseWhere.deviceType = device;
  if (country) baseWhere.country = country;

  const counts = await Promise.all(
    FUNNEL_STEPS.map((s) =>
      prisma.checkoutEvent
        .findMany({
          where: { ...baseWhere, eventType: s.step },
          select: { sessionId: true },
          distinct: ["sessionId"],
        })
        .then((rows) => rows.length)
    )
  );

  // Cap each step at the previous step's count — a later step can never
  // exceed an earlier one (avoids impossible funnel shapes from partial tracking).
  const capped = counts.map((c, i) => (i === 0 ? c : Math.min(c, counts[i - 1])));
  const baseline = capped[0] || 1;
  return FUNNEL_STEPS.map((s, i) => ({
    step: s.step,
    label: s.label,
    sessions: capped[i],
    pct: Math.round((capped[i] / baseline) * 100),
    dropPct: i > 0 ? Math.round(((capped[i - 1] - capped[i]) / baseline) * 100) : 0,
  }));
}

export async function getLiveEventFeed(shopId: string, limit = 50): Promise<LiveEvent[]> {
  return prisma.checkoutEvent.findMany({
    where: { shopId },
    orderBy: { occurredAt: "desc" },
    take: limit,
    select: {
      id: true,
      eventType: true,
      sessionId: true,
      deviceType: true,
      country: true,
      discountCode: true,
      totalPrice: true,
      currency: true,
      errorMessage: true,
      occurredAt: true,
    },
  });
}

export async function getTopErrors(shopId: string, range: DateRange): Promise<TopError[]> {
  const where = { shopId, occurredAt: { gte: range.start, lte: range.end } };

  const [discountErrors, extensionErrors, paymentAttempted, completedIds] = await Promise.all([
    prisma.checkoutEvent.count({
      where: { ...where, eventType: "alert_displayed" },
    }),
    prisma.checkoutEvent.count({
      where: { ...where, eventType: "ui_extension_errored" },
    }),
    prisma.checkoutEvent.findMany({
      where: { ...where, eventType: "payment_info_submitted" },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
    prisma.checkoutEvent
      .findMany({
        where: { ...where, eventType: "checkout_completed" },
        select: { sessionId: true },
        distinct: ["sessionId"],
      })
      .then((rows) => new Set(rows.map((r) => r.sessionId))),
  ]);

  const paymentDropoffs = paymentAttempted.filter((s) => !completedIds.has(s.sessionId)).length;

  return [
    { type: "discount_error", label: "Discount code error", count: discountErrors },
    { type: "payment_dropoff", label: "Payment drop-off", count: paymentDropoffs },
    { type: "extension_error", label: "Extension error", count: extensionErrors },
  ].filter((e) => e.count > 0);
}

export async function getDroppedProducts(
  shopId: string,
  range: DateRange
): Promise<DroppedProduct[]> {
  const where = { shopId, occurredAt: { gte: range.start, lte: range.end } };

  const [startedEvents, completedSessions] = await Promise.all([
    prisma.checkoutEvent.findMany({
      where: { ...where, eventType: "checkout_started" },
      select: { sessionId: true, rawPayload: true },
      distinct: ["sessionId"],
    }),
    prisma.checkoutEvent.findMany({
      where: { ...where, eventType: "checkout_completed" },
      select: { sessionId: true },
      distinct: ["sessionId"],
    }),
  ]);

  const completedSet = new Set(completedSessions.map((s) => s.sessionId));
  const dropped = startedEvents.filter((s) => !completedSet.has(s.sessionId));

  const productMap = new Map<string, number>();
  for (const event of dropped) {
    const payload = event.rawPayload as Record<string, unknown>;
    const lineItems: unknown[] =
      (payload?.checkout as Record<string, unknown>)?.lineItems as unknown[] ?? [];
    for (const item of lineItems) {
      const i = item as Record<string, unknown>;
      const productTitle = (i?.title as string) || "Unknown Product";
      const variant = i?.variant as Record<string, unknown> | undefined;
      const variantTitle = variant?.title as string | undefined;
      const key =
        variantTitle && variantTitle !== "Default Title"
          ? `${productTitle} (${variantTitle})`
          : productTitle;
      productMap.set(key, (productMap.get(key) || 0) + 1);
    }
  }

  const total = Array.from(productMap.values()).reduce((a, b) => a + b, 0) || 1;
  return Array.from(productMap.entries())
    .map(([title, count]) => ({ title, count, pctOfDrops: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export async function getStatusBannerState(shopId: string): Promise<StatusResult> {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return { state: "no_data" };

  const hoursSinceInstall = (Date.now() - shop.installedAt.getTime()) / (1000 * 60 * 60);
  if (hoursSinceInstall < 48) return { state: "learning" };

  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const recentCount = await prisma.checkoutEvent.count({
    where: { shopId, occurredAt: { gte: thirtyMinAgo } },
  });
  if (recentCount === 0) return { state: "no_data" };

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const activeAlert = await prisma.alertLog.findFirst({
    where: { shopId, resolvedAt: null, firedAt: { gte: twoHoursAgo } },
    orderBy: { firedAt: "desc" },
    select: { id: true, title: true },
  });
  if (activeAlert) return { state: "critical", activeAlert };

  return { state: "healthy" };
}

export type FailedDiscount = {
  code: string;
  count: number;
  lastSeen: Date;
  errorMessage: string | null;
};

export async function getFailedDiscounts(
  shopId: string,
  range: DateRange
): Promise<FailedDiscount[]> {
  const events = await prisma.checkoutEvent.findMany({
    where: {
      shopId,
      eventType: "alert_displayed",
      occurredAt: { gte: range.start, lte: range.end },
    },
    select: { discountCode: true, errorMessage: true, occurredAt: true, rawPayload: true },
    orderBy: { occurredAt: "desc" },
  });

  const map = new Map<string, { count: number; lastSeen: Date; errorMessage: string | null }>();
  for (const e of events) {
    // Use stored discountCode, or extract from rawPayload.alert.value for older events
    const payload = e.rawPayload as Record<string, unknown>;
    const alert = payload?.alert as Record<string, unknown> | undefined;
    const code =
      e.discountCode ||
      (alert?.target === "cart.discountCode" && alert?.value ? String(alert.value) : null);

    if (!code) continue;

    const existing = map.get(code);
    if (existing) {
      existing.count++;
      if (e.occurredAt > existing.lastSeen) existing.lastSeen = e.occurredAt;
    } else {
      map.set(code, { count: 1, lastSeen: e.occurredAt, errorMessage: e.errorMessage });
    }
  }

  return Array.from(map.entries())
    .map(([code, v]) => ({ code, ...v }))
    .sort((a, b) => b.count - a.count);
}

export async function getDistinctCountries(shopId: string, range: DateRange): Promise<string[]> {
  const rows = await prisma.checkoutEvent.findMany({
    where: { shopId, occurredAt: { gte: range.start, lte: range.end }, country: { not: null } },
    select: { country: true },
    distinct: ["country"],
    take: 20,
  });
  return rows.map((r) => r.country!).filter(Boolean);
}
