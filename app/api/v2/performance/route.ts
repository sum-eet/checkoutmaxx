export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

const CART_VALUE_BANDS = [
  { label: '$0–50', minCents: 0, maxCents: 5000 },
  { label: '$50–100', minCents: 5000, maxCents: 10000 },
  { label: '$100–125', minCents: 10000, maxCents: 12500 },
  { label: '$125–150', minCents: 12500, maxCents: 15000 },
  { label: '$150–175', minCents: 15000, maxCents: 17500 },
  { label: '$175–200', minCents: 17500, maxCents: 20000 },
  { label: '$200+', minCents: 20000, maxCents: Infinity },
];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop')
    .select('id')
    .eq('shopDomain', shopDomain)
    .eq('isActive', true)
    .single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const end = new Date(req.nextUrl.searchParams.get('end') ?? new Date().toISOString());
  const start = new Date(req.nextUrl.searchParams.get('start') ?? subDays(end, 7).toISOString());

  const [cartRes, checkoutRes] = await Promise.all([
    supabase
      .from('CartEvent')
      .select('sessionId, eventType, cartValue, cartItemCount, lineItems, couponCode, couponSuccess, couponRecovered, discountAmount, occurredAt')
      .eq('shopId', shop.id)
      .gte('occurredAt', start.toISOString())
      .lte('occurredAt', end.toISOString())
      .limit(10000),
    supabase
      .from('CheckoutEvent')
      .select('sessionId, eventType, totalPrice, occurredAt')
      .eq('shopId', shop.id)
      .gte('occurredAt', start.toISOString())
      .lte('occurredAt', end.toISOString())
      .limit(5000),
  ]);

  const cartEvents = cartRes.data ?? [];
  const checkoutEvents = checkoutRes.data ?? [];

  // Group cart events by session
  const bySession = new Map<string, typeof cartEvents>();
  for (const e of cartEvents) {
    if (!bySession.has(e.sessionId)) bySession.set(e.sessionId, []);
    bySession.get(e.sessionId)!.push(e);
  }

  // Determine completed sessions from checkout
  const completedSessions = new Set<string>();
  const startedSessions = new Set<string>();
  for (const e of checkoutEvents) {
    if (e.eventType === 'checkout_completed') completedSessions.add(e.sessionId);
    if (e.eventType === 'checkout_started') startedSessions.add(e.sessionId);
  }

  // AOV for insight line
  const completedPrices: number[] = [];
  for (const e of checkoutEvents) {
    if (e.eventType === 'checkout_completed' && e.totalPrice != null) {
      completedPrices.push(e.totalPrice * 100); // convert to cents for band comparison
    }
  }
  const aovCents = completedPrices.length > 0
    ? completedPrices.reduce((a, b) => a + b, 0) / completedPrices.length
    : 0;

  // Build per-session data
  type SessionData = {
    sessionId: string;
    isConverted: boolean;
    lastCartValueCents: number | null;
    cartValueAtCheckoutCents: number | null;
    lastItemCount: number | null;
    hasCoupon: boolean;
    firstAt: number;
    lastAt: number;
    lineItems: { productTitle?: string }[];
    itemCountAtEnd: number;
  };

  const sessionData: SessionData[] = [];

  for (const [sessionId, events] of Array.from(bySession)) {
    events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

    const isConverted = completedSessions.has(sessionId);
    const hasProducts = events.some((e) => (e.cartValue ?? 0) > 0 || (e.cartItemCount ?? 0) > 0);
    if (!hasProducts) continue; // skip empty cart sessions

    // Last cart value
    let lastCartValueCents: number | null = null;
    let lastItemCount: number | null = null;
    let cartValueAtCheckoutCents: number | null = null;
    let lastLineItems: { productTitle?: string }[] = [];

    for (const e of events) {
      if ((e.cartValue ?? 0) > 0) lastCartValueCents = e.cartValue ?? null;
      if ((e.cartItemCount ?? 0) > 0) lastItemCount = e.cartItemCount ?? null;
      if (e.lineItems && Array.isArray(e.lineItems) && (e.lineItems as any[]).length > 0) {
        lastLineItems = e.lineItems as { productTitle?: string }[];
      }
      if (e.eventType === 'cart_checkout_clicked' && (e.cartValue ?? 0) > 0) {
        cartValueAtCheckoutCents = e.cartValue ?? null;
      }
    }

    const hasCoupon = events.some((e) => e.couponCode);

    const firstAt = new Date(events[0].occurredAt).getTime();
    const lastAt = new Date(events[events.length - 1].occurredAt).getTime();

    sessionData.push({
      sessionId,
      isConverted,
      lastCartValueCents,
      cartValueAtCheckoutCents,
      lastItemCount,
      hasCoupon,
      firstAt,
      lastAt,
      lineItems: lastLineItems,
      itemCountAtEnd: lastItemCount ?? 0,
    });
  }

  const convertedSessions = sessionData.filter((s) => s.isConverted);
  const abandonedSessions = sessionData.filter((s) => !s.isConverted);

  function buildComparison(sessions: SessionData[]) {
    if (sessions.length === 0) return null;

    const cartValues = sessions
      .map((s) => s.cartValueAtCheckoutCents ?? s.lastCartValueCents)
      .filter((v): v is number => v !== null)
      .map((v) => v / 100);

    const itemCounts = sessions
      .map((s) => s.lastItemCount)
      .filter((v): v is number => v !== null);

    const withCoupon = sessions.filter((s) => s.hasCoupon).length;

    const durations = sessions.map((s) => s.lastAt - s.firstAt);

    const single = sessions.filter((s) => s.itemCountAtEnd === 1).length;
    const multi = sessions.filter((s) => s.itemCountAtEnd > 1).length;
    const total = sessions.length;

    // Most common product
    const productCounts = new Map<string, number>();
    for (const s of sessions) {
      for (const item of s.lineItems) {
        if (item.productTitle) {
          productCounts.set(item.productTitle, (productCounts.get(item.productTitle) ?? 0) + 1);
        }
      }
    }
    let mostCommonProduct: string | null = null;
    let maxCount = 0;
    for (const [title, count] of Array.from(productCounts)) {
      if (count > maxCount) { maxCount = count; mostCommonProduct = title; }
    }

    // Most common combination (pairs)
    const pairCounts = new Map<string, number>();
    for (const s of sessions) {
      const titles = s.lineItems.map((i) => i.productTitle).filter(Boolean) as string[];
      if (titles.length >= 2) {
        const sorted = [...titles].sort();
        for (let i = 0; i < sorted.length; i++) {
          for (let j = i + 1; j < sorted.length; j++) {
            const pair = `${sorted[i]} + ${sorted[j]}`;
            pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
          }
        }
      }
    }
    const multiSessions = sessions.filter((s) => s.itemCountAtEnd > 1).length;
    let mostCommonCombination: string | null = null;
    if (multiSessions >= 10) {
      let maxPairs = 0;
      for (const [pair, count] of Array.from(pairCounts)) {
        if (count > maxPairs) { maxPairs = count; mostCommonCombination = pair; }
      }
    }

    return {
      avgCartValue: avg(cartValues),
      avgItemCount: avg(itemCounts),
      couponUsagePct: total > 0 ? (withCoupon / total) * 100 : null,
      medianDurationMs: median(durations),
      singleProductPct: total > 0 ? (single / total) * 100 : null,
      multiProductPct: total > 0 ? (multi / total) * 100 : null,
      mostCommonProduct,
      mostCommonCombination,
    };
  }

  // Conversion by cart value bands
  // Sessions that attempted checkout (cart_checkout_clicked or checkout_started)
  const checkoutAttemptedSessions = new Set<string>();
  for (const e of cartEvents) {
    if (e.eventType === 'cart_checkout_clicked') checkoutAttemptedSessions.add(e.sessionId);
  }
  for (const e of checkoutEvents) {
    if (e.eventType === 'checkout_started') checkoutAttemptedSessions.add(e.sessionId);
  }

  const conversionBands = CART_VALUE_BANDS.map((band) => {
    const inBand = sessionData.filter((s) => {
      const val = s.lastCartValueCents ?? 0;
      return (
        val >= band.minCents &&
        (band.maxCents === Infinity ? true : val < band.maxCents) &&
        (s.isConverted || checkoutAttemptedSessions.has(s.sessionId))
      );
    });
    const converted = inBand.filter((s) => s.isConverted).length;
    const totalInBand = inBand.length;
    return {
      label: band.label,
      minCents: band.minCents,
      maxCents: band.maxCents === Infinity ? 999999 : band.maxCents,
      sessions: totalInBand,
      conversions: converted,
      conversionRate: totalInBand > 0 ? Math.round((converted / totalInBand) * 1000) / 10 : 0,
      isAovBand: aovCents >= band.minCents && (band.maxCents === Infinity || aovCents < band.maxCents),
    };
  });

  // Revenue per coupon
  // Build "no coupon" baseline first
  const noCouponSessions = sessionData.filter((s) => !s.hasCoupon);
  const noCouponConvRate =
    noCouponSessions.length > 0
      ? noCouponSessions.filter((s) => s.isConverted).length / noCouponSessions.length
      : 0;
  const noCouponAvgCart =
    avg(
      noCouponSessions
        .map((s) => s.cartValueAtCheckoutCents ?? s.lastCartValueCents)
        .filter((v): v is number => v !== null)
        .map((v) => v / 100)
    ) ?? 0;
  const baselineRevPerSession = noCouponAvgCart * noCouponConvRate;

  // Group coupon events by code
  const couponEvents = cartEvents.filter((e) => e.couponCode);
  const couponSessions = new Map<string, Set<string>>();
  const couponSuccessSessions = new Map<string, Set<string>>();
  const couponCartValues = new Map<string, number[]>();
  const couponDiscounts = new Map<string, number[]>();

  for (const e of couponEvents) {
    const code = (e.couponCode as string).toUpperCase();
    if (!couponSessions.has(code)) couponSessions.set(code, new Set());
    couponSessions.get(code)!.add(e.sessionId);

    if ((e.cartValue ?? 0) > 0) {
      if (!couponCartValues.has(code)) couponCartValues.set(code, []);
      couponCartValues.get(code)!.push((e.cartValue as number) / 100);
    }

    if (e.couponSuccess === true) {
      if (!couponSuccessSessions.has(code)) couponSuccessSessions.set(code, new Set());
      couponSuccessSessions.get(code)!.add(e.sessionId);
      if ((e.discountAmount ?? 0) > 0) {
        if (!couponDiscounts.has(code)) couponDiscounts.set(code, []);
        couponDiscounts.get(code)!.push((e.discountAmount as number) / 100);
      }
    }
  }

  const revenuePerCoupon: { code: string | null; sessions: number; convRate: number; avgCartDollars: number; avgDiscountDollars: number; revPerSession: number; vsBaseline: number; isLowData: boolean }[] = [
    {
      code: null,
      sessions: noCouponSessions.length,
      convRate: Math.round(noCouponConvRate * 1000) / 10,
      avgCartDollars: Math.round(noCouponAvgCart * 100) / 100,
      avgDiscountDollars: 0,
      revPerSession: Math.round(baselineRevPerSession * 100) / 100,
      vsBaseline: 0,
      isLowData: noCouponSessions.length < 10,
    },
  ];

  for (const [code, sessions] of Array.from(couponSessions)) {
    const sessionCount = sessions.size;
    const successCount = couponSuccessSessions.get(code)?.size ?? 0;
    const convRate = sessionCount > 0 ? successCount / sessionCount : 0;
    const completedInCode = Array.from(sessions).filter((s) => completedSessions.has(s)).length;
    const actualConvRate = sessionCount > 0 ? completedInCode / sessionCount : 0;
    const avgCart = avg(couponCartValues.get(code) ?? []) ?? 0;
    const avgDiscount = avg(couponDiscounts.get(code) ?? []) ?? 0;
    const revPerSession = (avgCart - avgDiscount) * actualConvRate;

    revenuePerCoupon.push({
      code,
      sessions: sessionCount,
      convRate: Math.round(actualConvRate * 1000) / 10,
      avgCartDollars: Math.round(avgCart * 100) / 100,
      avgDiscountDollars: Math.round(avgDiscount * 100) / 100,
      revPerSession: Math.round(revPerSession * 100) / 100,
      vsBaseline: Math.round((revPerSession - baselineRevPerSession) * 100) / 100,
      isLowData: sessionCount < 10,
    });
  }

  // Sort: baseline first, then by revPerSession DESC (low data last)
  revenuePerCoupon.sort((a, b) => {
    if (a.code === null) return -1;
    if (b.code === null) return 1;
    if (a.isLowData && !b.isLowData) return 1;
    if (!a.isLowData && b.isLowData) return -1;
    return b.revPerSession - a.revPerSession;
  });

  const convertedMetrics = buildComparison(convertedSessions);
  const abandonedMetrics = buildComparison(abandonedSessions);

  return NextResponse.json({
    basedOnSessions: sessionData.length,
    comparison: {
      converted: convertedMetrics,
      abandoned: abandonedMetrics,
      convertedCount: convertedSessions.length,
      abandonedCount: abandonedSessions.length,
    },
    conversionBands,
    revenuePerCoupon,
    aovCents: Math.round(aovCents),
  });
}
