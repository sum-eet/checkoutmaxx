import { supabase } from '@/lib/supabase';

// ── Module-level TTL cache ─────────────────────────────────────────────────────
type CacheEntry = { data: CartDashboardData; expiresAt: number };
const dashboardCache = new Map<string, CacheEntry>();

export type CartDashboardData = {
  kpis: CartKPIs;
  sessions: CartSession[];
  couponStats: CouponStat[];
};

export function getCachedDashboard(key: string): CartDashboardData | null {
  const entry = dashboardCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.data;
}

export function setCachedDashboard(key: string, data: CartDashboardData): void {
  dashboardCache.set(key, { data, expiresAt: Date.now() + 60_000 });
}

export function invalidateDashboardCache(key: string): void {
  dashboardCache.delete(key);
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
  device: string | null;
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
  hourlyBuckets: number[];
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── KPI Cards ──────────────────────────────────────────────────────────────────

export async function getCartKPIs(shopId: string, since?: Date): Promise<CartKPIs> {
  const since_ = (since ?? startOfToday()).toISOString();

  const [allRes, couponRes, checkoutRes, recoveryRes] = await Promise.all([
    supabase.from('CartEvent')
      .select('sessionId, occurredAt')
      .eq('shopId', shopId)
      .gte('occurredAt', since_),
    supabase.from('CartEvent')
      .select('sessionId')
      .eq('shopId', shopId)
      .gte('occurredAt', since_)
      .in('eventType', ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered']),
    supabase.from('CartEvent')
      .select('sessionId')
      .eq('shopId', shopId)
      .gte('occurredAt', since_)
      .eq('eventType', 'cart_checkout_clicked'),
    supabase.from('CartEvent')
      .select('sessionId, cartValue')
      .eq('shopId', shopId)
      .gte('occurredAt', since_)
      .eq('eventType', 'cart_coupon_recovered'),
  ]);

  // Distinct sessions from all events
  const sessionMap = new Map<string, string>();
  for (const r of (allRes.data ?? [])) {
    if (!sessionMap.has(r.sessionId)) sessionMap.set(r.sessionId, r.occurredAt);
  }

  const couponSessions = new Set((couponRes.data ?? []).map((r: any) => r.sessionId));
  const checkoutSessions = new Set((checkoutRes.data ?? []).map((r: any) => r.sessionId));

  // Recovered revenue — one entry per session (first recovery)
  const recoveredBySession = new Map<string, number>();
  for (const r of (recoveryRes.data ?? [])) {
    if (!recoveredBySession.has(r.sessionId)) {
      recoveredBySession.set(r.sessionId, r.cartValue ?? 0);
    }
  }
  const recoveredRevenue = Array.from(recoveredBySession.values()).reduce((a, b) => a + b, 0);

  const hourlyBuckets = new Array(24).fill(0) as number[];
  for (const [, occurredAt] of Array.from(sessionMap)) {
    hourlyBuckets[new Date(occurredAt).getHours()]++;
  }

  return {
    cartsOpened: sessionMap.size,
    cartsWithCoupon: couponSessions.size,
    cartsCheckedOut: checkoutSessions.size,
    recoveredCarts: recoveredBySession.size,
    recoveredRevenue,
    hourlyBuckets,
  };
}

// ── Session List ───────────────────────────────────────────────────────────────

export async function getCartSessions(shopId: string, since?: Date): Promise<CartSession[]> {
  const since_ = (since ?? startOfToday()).toISOString();

  const { data: events } = await supabase.from('CartEvent')
    .select('*')
    .eq('shopId', shopId)
    .gte('occurredAt', since_)
    .order('occurredAt', { ascending: true });

  if (!events || events.length === 0) return [];

  const bySession = new Map<string, any[]>();
  for (const ev of events) {
    if (!bySession.has(ev.sessionId)) bySession.set(ev.sessionId, []);
    bySession.get(ev.sessionId)!.push(ev);
  }

  const sessionIds = Array.from(bySession.keys());

  const { data: checkoutEvents } = await supabase.from('CheckoutEvent')
    .select('sessionId, eventType, occurredAt, country')
    .eq('shopId', shopId)
    .in('sessionId', sessionIds)
    .order('occurredAt', { ascending: true });

  const checkoutBySession = new Map<string, CheckoutStep[]>();
  const checkoutCountryBySession = new Map<string, string>();
  for (const ce of (checkoutEvents ?? [])) {
    if (!checkoutBySession.has(ce.sessionId)) checkoutBySession.set(ce.sessionId, []);
    checkoutBySession.get(ce.sessionId)!.push({
      eventType: ce.eventType,
      occurredAt: new Date(ce.occurredAt),
    });
    if (ce.country && !checkoutCountryBySession.has(ce.sessionId)) {
      checkoutCountryBySession.set(ce.sessionId, ce.country);
    }
  }

  const MEANINGFUL_TYPES = new Set([
    'cart_item_added', 'cart_item_changed', 'cart_item_removed',
    'cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered',
    'cart_coupon_removed', 'cart_checkout_clicked', 'cart_page_hidden',
  ]);

  const sessions: CartSession[] = [];

  for (const [sessionId, evs] of Array.from(bySession.entries())) {
    const hasMeaningfulEvent = evs.some((e: any) => MEANINGFUL_TYPES.has(e.eventType));
    const hasCheckoutEvents = (checkoutBySession.get(sessionId) ?? []).length > 0;
    const hasCartValue = evs.some((e: any) => e.cartValue != null && e.cartValue > 0);
    if (!hasMeaningfulEvent && !hasCheckoutEvents && !hasCartValue) continue;

    const lastWithValue = [...evs].reverse().find((e) => e.cartValue != null);
    const firstWithValue = evs.find((e: any) => e.cartValue != null && e.cartValue > 0);
    const lastWithItems = [...evs].reverse().find((e) => e.lineItems != null);
    const cartCountry = evs.find((e: any) => e.country != null)?.country ?? null;
    const device = evs.find((e: any) => e.device != null)?.device ?? null;

    const couponMap = new Map<string, CouponAttempt>();
    for (const ev of evs) {
      if (!ev.couponCode) continue;
      const existing = couponMap.get(ev.couponCode);
      couponMap.set(ev.couponCode, {
        code: ev.couponCode,
        success: ev.couponSuccess ?? existing?.success ?? false,
        recovered: ev.couponRecovered ?? existing?.recovered ?? false,
        discountAmount: ev.discountAmount ?? existing?.discountAmount ?? null,
      });
    }

    const checkoutSteps = checkoutBySession.get(sessionId) ?? [];
    const checkedOut = evs.some((e: any) => e.eventType === 'cart_checkout_clicked') || checkoutSteps.length > 0;
    const orderCompleted = checkoutSteps.some((e) => e.eventType === 'checkout_completed');

    sessions.push({
      sessionId,
      cartToken: evs[0].cartToken,
      firstSeen: new Date(evs[0].occurredAt),
      lastSeen: new Date(evs[evs.length - 1].occurredAt),
      cartValue: lastWithValue?.cartValue ?? null,
      startingCartValue: firstWithValue?.cartValue ?? null,
      cartItemCount: lastWithValue?.cartItemCount ?? null,
      lineItems: (lastWithItems?.lineItems as any[]) ?? [],
      couponsAttempted: Array.from(couponMap.values()),
      checkedOut,
      orderCompleted,
      checkoutEvents: checkoutSteps,
      country: cartCountry ?? checkoutCountryBySession.get(sessionId) ?? null,
      device,
    });
  }

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

export async function getSessionTimeline(shopId: string, sessionId: string): Promise<TimelineEvent[]> {
  const [cartRes, checkoutRes] = await Promise.all([
    supabase.from('CartEvent').select('*').eq('shopId', shopId).eq('sessionId', sessionId).order('occurredAt', { ascending: true }),
    supabase.from('CheckoutEvent').select('eventType, occurredAt').eq('shopId', shopId).eq('sessionId', sessionId).order('occurredAt', { ascending: true }),
  ]);

  const timeline: TimelineEvent[] = [];

  for (const ev of (cartRes.data ?? [])) {
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
        detail = ev.discountAmount != null ? `Added items to qualify — saved ${formatCents(ev.discountAmount)}` : 'Added items to qualify';
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

    timeline.push({ source: 'cart', eventType: ev.eventType, occurredAt: new Date(ev.occurredAt), label, detail, isPositive });
  }

  const checkoutLabels: Record<string, string> = {
    checkout_started: 'Reached checkout',
    checkout_contact_info_submitted: 'Filled contact info',
    checkout_address_info_submitted: 'Filled shipping address',
    checkout_shipping_info_submitted: 'Selected shipping method',
    payment_info_submitted: 'Entered payment',
    checkout_completed: 'Order completed',
  };

  for (const ev of (checkoutRes.data ?? [])) {
    timeline.push({
      source: 'checkout',
      eventType: ev.eventType,
      occurredAt: new Date(ev.occurredAt),
      label: checkoutLabels[ev.eventType] ?? ev.eventType,
      detail: null,
      isPositive: ev.eventType === 'checkout_completed' ? true : null,
    });
  }

  return timeline.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
}

// ── Coupon Intelligence ────────────────────────────────────────────────────────

export async function getCouponStats(shopId: string, since?: Date): Promise<CouponStat[]> {
  const since_ = (since ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)).toISOString();

  const { data: events } = await supabase.from('CartEvent')
    .select('couponCode, couponSuccess, couponRecovered, cartValue, occurredAt')
    .eq('shopId', shopId)
    .gte('occurredAt', since_)
    .not('couponCode', 'is', null)
    .in('eventType', ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered']);

  const statsMap = new Map<string, { attempts: number; successes: number; recoveries: number; cartValues: number[]; lastSeen: Date }>();

  for (const ev of (events ?? [])) {
    const code = ev.couponCode!;
    if (!statsMap.has(code)) {
      statsMap.set(code, { attempts: 0, successes: 0, recoveries: 0, cartValues: [], lastSeen: new Date(ev.occurredAt) });
    }
    const s = statsMap.get(code)!;
    s.attempts++;
    if (ev.couponSuccess) s.successes++;
    if (ev.couponRecovered) s.recoveries++;
    if (ev.cartValue != null) s.cartValues.push(ev.cartValue);
    const t = new Date(ev.occurredAt);
    if (t > s.lastSeen) s.lastSeen = t;
  }

  return Array.from(statsMap.entries())
    .map(([code, s]) => ({
      code,
      attempts: s.attempts,
      successes: s.successes,
      recoveries: s.recoveries,
      avgCartValue: s.cartValues.length > 0 ? Math.round(s.cartValues.reduce((a, b) => a + b, 0) / s.cartValues.length) : null,
      lastSeen: s.lastSeen,
    }))
    .sort((a, b) => b.attempts - a.attempts);
}
