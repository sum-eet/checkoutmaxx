import prisma from '@/lib/prisma';

// ── Module-level TTL cache ─────────────────────────────────────────────────────
// Avoids hammering the DB on every page load. 60-second TTL per shopId.
// Cleared on demand when the user hits the refresh button (/api/cart/all?refresh=1).

type CacheEntry = { data: CartDashboardData; expiresAt: number };
const dashboardCache = new Map<string, CacheEntry>();

export type CartDashboardData = {
  kpis: CartKPIs;
  sessions: CartSession[];
  couponStats: CouponStat[];
};

export function getCachedDashboard(shopId: string): CartDashboardData | null {
  const entry = dashboardCache.get(shopId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

export function setCachedDashboard(shopId: string, data: CartDashboardData): void {
  dashboardCache.set(shopId, { data, expiresAt: Date.now() + 60_000 });
}

export function invalidateDashboardCache(shopId: string): void {
  dashboardCache.delete(shopId);
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type CartSession = {
  sessionId: string;
  cartToken: string;
  firstSeen: Date;
  lastSeen: Date;
  cartValue: number | null;
  startingCartValue: number | null;
  cartItemCount: number | null;
  lineItems: any[];
  couponsAttempted: CouponAttempt[];
  checkedOut: boolean;
  orderCompleted: boolean;
  checkoutEvents: CheckoutStep[];
  country: string | null;
};

export type CouponAttempt = {
  code: string;
  success: boolean;
  recovered: boolean;
  discountAmount: number | null;
};

export type CheckoutStep = {
  eventType: string;
  occurredAt: Date;
};

export type CouponStat = {
  code: string;
  attempts: number;
  successes: number;
  recoveries: number;
  avgCartValue: number | null;
  lastSeen: Date;
};

export type CartKPIs = {
  cartsOpened: number;
  cartsWithCoupon: number;
  cartsCheckedOut: number;
  recoveredCarts: number;
  recoveredRevenue: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── KPI Cards ──────────────────────────────────────────────────────────────────

export async function getCartKPIs(shopId: string): Promise<CartKPIs> {
  const since = startOfToday();

  const [sessions, couponSessions, checkoutSessions, recoveries] = await Promise.all([
    prisma.cartEvent.findMany({
      where: { shopId, occurredAt: { gte: since } },
      select: { sessionId: true },
      distinct: ['sessionId'],
    }),
    prisma.cartEvent.findMany({
      where: {
        shopId,
        occurredAt: { gte: since },
        eventType: { in: ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'] },
      },
      select: { sessionId: true },
      distinct: ['sessionId'],
    }),
    prisma.cartEvent.findMany({
      where: { shopId, occurredAt: { gte: since }, eventType: 'cart_checkout_clicked' },
      select: { sessionId: true },
      distinct: ['sessionId'],
    }),
    prisma.cartEvent.findMany({
      where: { shopId, occurredAt: { gte: since }, eventType: 'cart_coupon_recovered' },
      select: { sessionId: true, cartValue: true },
      distinct: ['sessionId'],
    }),
  ]);

  const recoveredRevenue = recoveries.reduce((sum, r) => sum + (r.cartValue ?? 0), 0);

  return {
    cartsOpened: sessions.length,
    cartsWithCoupon: couponSessions.length,
    cartsCheckedOut: checkoutSessions.length,
    recoveredCarts: recoveries.length,
    recoveredRevenue,
  };
}

// ── Session List ───────────────────────────────────────────────────────────────

export async function getCartSessions(shopId: string): Promise<CartSession[]> {
  const since = startOfToday();

  const events = await prisma.cartEvent.findMany({
    where: { shopId, occurredAt: { gte: since } },
    orderBy: { occurredAt: 'asc' },
  });

  if (events.length === 0) return [];

  const bySession = new Map<string, typeof events>();
  events.forEach((ev) => {
    if (!bySession.has(ev.sessionId)) bySession.set(ev.sessionId, []);
    bySession.get(ev.sessionId)!.push(ev);
  });

  const sessionIds = Array.from(bySession.keys());

  const checkoutEvents = await prisma.checkoutEvent.findMany({
    where: { shopId, sessionId: { in: sessionIds } },
    select: { sessionId: true, eventType: true, occurredAt: true, country: true },
    orderBy: { occurredAt: 'asc' },
  });

  const checkoutBySession = new Map<string, CheckoutStep[]>();
  const countryBySession = new Map<string, string>();
  checkoutEvents.forEach((ce) => {
    if (!checkoutBySession.has(ce.sessionId)) checkoutBySession.set(ce.sessionId, []);
    checkoutBySession.get(ce.sessionId)!.push({
      eventType: ce.eventType,
      occurredAt: ce.occurredAt,
    });
    if (ce.country && !countryBySession.has(ce.sessionId)) {
      countryBySession.set(ce.sessionId, ce.country);
    }
  });

  const sessions: CartSession[] = [];

  Array.from(bySession.entries()).forEach(([sessionId, evs]) => {
    const lastWithValue = [...evs].reverse().find((e) => e.cartValue != null);
    const firstWithValue = evs.find((e) => e.cartValue != null);
    const lastWithItems = [...evs].reverse().find((e) => e.lineItems != null);

    const couponMap = new Map<string, CouponAttempt>();
    evs.forEach((ev) => {
      if (!ev.couponCode) return;
      const existing = couponMap.get(ev.couponCode);
      couponMap.set(ev.couponCode, {
        code: ev.couponCode,
        success: ev.couponSuccess ?? existing?.success ?? false,
        recovered: ev.couponRecovered ?? existing?.recovered ?? false,
        discountAmount: ev.discountAmount ?? existing?.discountAmount ?? null,
      });
    });

    const checkoutSteps = checkoutBySession.get(sessionId) ?? [];
    const checkedOut =
      evs.some((e) => e.eventType === 'cart_checkout_clicked') || checkoutSteps.length > 0;
    const orderCompleted = checkoutSteps.some((e) => e.eventType === 'checkout_completed');

    sessions.push({
      sessionId,
      cartToken: evs[0].cartToken,
      firstSeen: evs[0].occurredAt,
      lastSeen: evs[evs.length - 1].occurredAt,
      cartValue: lastWithValue?.cartValue ?? null,
      startingCartValue: firstWithValue?.cartValue ?? null,
      cartItemCount: lastWithValue?.cartItemCount ?? null,
      lineItems: (lastWithItems?.lineItems as any[]) ?? [],
      couponsAttempted: Array.from(couponMap.values()),
      checkedOut,
      orderCompleted,
      checkoutEvents: checkoutSteps,
      country: countryBySession.get(sessionId) ?? null,
    });
  });

  return sessions.sort((a, b) => b.firstSeen.getTime() - a.firstSeen.getTime());
}

// ── Session Timeline ───────────────────────────────────────────────────────────

export type TimelineEvent = {
  source: 'cart' | 'checkout';
  eventType: string;
  occurredAt: Date;
  label: string;
  detail: string | null;
  isPositive: boolean | null;
};

function formatCents(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}

export async function getSessionTimeline(
  shopId: string,
  sessionId: string
): Promise<TimelineEvent[]> {
  const [cartEvents, checkoutEvents] = await Promise.all([
    prisma.cartEvent.findMany({
      where: { shopId, sessionId },
      orderBy: { occurredAt: 'asc' },
    }),
    prisma.checkoutEvent.findMany({
      where: { shopId, sessionId },
      select: { eventType: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    }),
  ]);

  const timeline: TimelineEvent[] = [];

  for (const ev of cartEvents) {
    let label = '';
    let detail: string | null = null;
    let isPositive: boolean | null = null;

    switch (ev.eventType) {
      case 'cart_item_added':
        label = 'Added item to cart';
        detail = ev.cartValue != null ? `Cart: ${formatCents(ev.cartValue)}` : null;
        break;
      case 'cart_item_changed':
        label = `Changed quantity to ${ev.newQuantity}`;
        detail = ev.cartValue != null ? `Cart: ${formatCents(ev.cartValue)}` : null;
        break;
      case 'cart_item_removed':
        label = 'Removed item';
        detail = ev.cartValue != null ? `Cart: ${formatCents(ev.cartValue)}` : null;
        break;
      case 'cart_coupon_applied':
        label = `Applied coupon ${ev.couponCode}`;
        detail = ev.discountAmount != null ? `Saved ${formatCents(ev.discountAmount)}` : null;
        isPositive = true;
        break;
      case 'cart_coupon_failed':
        label = `Tried coupon ${ev.couponCode}`;
        detail = 'Not applicable';
        isPositive = false;
        break;
      case 'cart_coupon_recovered':
        label = `Coupon ${ev.couponCode} unlocked`;
        detail = ev.discountAmount != null
          ? `Added items to qualify — saved ${formatCents(ev.discountAmount)}`
          : 'Added items to qualify';
        isPositive = true;
        break;
      case 'cart_coupon_removed':
        label = `Removed coupon ${ev.couponCode}`;
        break;
      case 'cart_checkout_clicked':
        label = 'Clicked checkout';
        break;
      case 'cart_page_hidden':
        label = 'Left the page';
        break;
      default:
        label = ev.eventType;
    }

    timeline.push({
      source: 'cart',
      eventType: ev.eventType,
      occurredAt: ev.occurredAt,
      label,
      detail,
      isPositive,
    });
  }

  const checkoutLabels: Record<string, string> = {
    checkout_started: 'Reached checkout',
    checkout_contact_info_submitted: 'Filled contact info',
    checkout_address_info_submitted: 'Filled shipping address',
    checkout_shipping_info_submitted: 'Selected shipping method',
    payment_info_submitted: 'Entered payment',
    checkout_completed: 'Order completed',
  };

  for (const ev of checkoutEvents) {
    timeline.push({
      source: 'checkout',
      eventType: ev.eventType,
      occurredAt: ev.occurredAt,
      label: checkoutLabels[ev.eventType] ?? ev.eventType,
      detail: null,
      isPositive: ev.eventType === 'checkout_completed' ? true : null,
    });
  }

  return timeline.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

// ── Coupon Intelligence ────────────────────────────────────────────────────────

export async function getCouponStats(shopId: string): Promise<CouponStat[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const events = await prisma.cartEvent.findMany({
    where: {
      shopId,
      occurredAt: { gte: since },
      couponCode: { not: null },
      eventType: { in: ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'] },
    },
    select: {
      couponCode: true,
      couponSuccess: true,
      couponRecovered: true,
      cartValue: true,
      occurredAt: true,
    },
  });

  const statsMap = new Map<
    string,
    { attempts: number; successes: number; recoveries: number; cartValues: number[]; lastSeen: Date }
  >();

  events.forEach((ev) => {
    const code = ev.couponCode!;
    if (!statsMap.has(code)) {
      statsMap.set(code, {
        attempts: 0,
        successes: 0,
        recoveries: 0,
        cartValues: [],
        lastSeen: ev.occurredAt,
      });
    }
    const s = statsMap.get(code)!;
    s.attempts++;
    if (ev.couponSuccess) s.successes++;
    if (ev.couponRecovered) s.recoveries++;
    if (ev.cartValue != null) s.cartValues.push(ev.cartValue);
    if (ev.occurredAt > s.lastSeen) s.lastSeen = ev.occurredAt;
  });

  return Array.from(statsMap.entries())
    .map(([code, s]) => ({
      code,
      attempts: s.attempts,
      successes: s.successes,
      recoveries: s.recoveries,
      avgCartValue:
        s.cartValues.length > 0
          ? Math.round(s.cartValues.reduce((a, b) => a + b, 0) / s.cartValues.length)
          : null,
      lastSeen: s.lastSeen,
    }))
    .sort((a, b) => b.attempts - a.attempts);
}
