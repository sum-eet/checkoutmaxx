export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { buildOutcome } from '@/lib/v2/session-summary';

function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode).toUpperCase();

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
  const start = new Date(
    req.nextUrl.searchParams.get('start') ?? subDays(end, 30).toISOString()
  );
  const duration = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime());
  const prevStart = new Date(start.getTime() - duration);

  const [codeEventsRes, prevCodeEventsRes, allCartRes] = await Promise.all([
    supabase
      .from('CartEvent')
      .select('sessionId, eventType, couponCode, couponSuccess, couponRecovered, discountAmount, cartValue, cartItemCount, occurredAt')
      .eq('shopId', shop.id)
      .ilike('couponCode', code)
      .gte('occurredAt', start.toISOString())
      .lte('occurredAt', end.toISOString())
      .order('occurredAt', { ascending: true })
      .limit(5000),
    supabase
      .from('CartEvent')
      .select('sessionId, couponSuccess, occurredAt')
      .eq('shopId', shop.id)
      .ilike('couponCode', code)
      .gte('occurredAt', prevStart.toISOString())
      .lte('occurredAt', prevEnd.toISOString())
      .limit(5000),
    supabase
      .from('CartEvent')
      .select('sessionId, eventType, cartValue, cartItemCount, lineItems, couponCode, occurredAt')
      .eq('shopId', shop.id)
      .gte('occurredAt', start.toISOString())
      .lte('occurredAt', end.toISOString())
      .limit(10000),
  ]);

  const codeEvents = codeEventsRes.data ?? [];
  if (codeEvents.length === 0) {
    return NextResponse.json({ error: 'Code not found' }, { status: 404 });
  }

  // Session IDs for this code
  const sessionIds = Array.from(new Set(codeEvents.map((e) => e.sessionId)));

  // Checkout events for these sessions
  const [checkoutRes, allCheckoutRes] = await Promise.all([
    supabase
      .from('CheckoutEvent')
      .select('sessionId, eventType, totalPrice, occurredAt')
      .eq('shopId', shop.id)
      .in('sessionId', sessionIds.slice(0, 500))
      .order('occurredAt', { ascending: true })
      .limit(5000),
    supabase
      .from('CheckoutEvent')
      .select('sessionId, eventType, totalPrice')
      .eq('shopId', shop.id)
      .gte('occurredAt', start.toISOString())
      .lte('occurredAt', end.toISOString())
      .limit(5000),
  ]);

  const checkoutEvents = checkoutRes.data ?? [];
  const allCheckout = allCheckoutRes.data ?? [];

  const completedSessions = new Set<string>();
  for (const e of checkoutEvents) {
    if (e.eventType === 'checkout_completed') completedSessions.add(e.sessionId);
  }

  // Store avg cart
  const allCartEvents = allCartRes.data ?? [];
  const storeCartValues: number[] = [];
  const seenStore = new Set<string>();
  for (const e of allCartEvents) {
    if (!seenStore.has(e.sessionId) && (e.cartValue ?? 0) > 0) {
      storeCartValues.push((e.cartValue as number) / 100);
      seenStore.add(e.sessionId);
    }
  }
  const storeAvgCart =
    storeCartValues.length > 0
      ? storeCartValues.reduce((a, b) => a + b, 0) / storeCartValues.length
      : 0;

  // Baseline rev/session (no coupon)
  const allCartSessionIds = Array.from(new Set(allCartEvents.map((e) => e.sessionId)));
  const couponSessionIds = new Set(
    allCartEvents.filter((e) => e.couponCode).map((e) => e.sessionId)
  );
  const noCouponIds = allCartSessionIds.filter((id) => !couponSessionIds.has(id));
  const noCouponCompleted = noCouponIds.filter((id) =>
    allCheckout.some((e) => e.sessionId === id && e.eventType === 'checkout_completed')
  ).length;
  const noCouponConvRate = noCouponIds.length > 0 ? noCouponCompleted / noCouponIds.length : 0;
  const baselineRevPerSession = storeAvgCart * noCouponConvRate;

  // Current period stats
  const attemptSessions = new Set(codeEvents.map((e) => e.sessionId));
  const successSessions = new Set(
    codeEvents.filter((e) => e.couponSuccess === true).map((e) => e.sessionId)
  );
  const recoverySessions = new Set(
    codeEvents.filter((e) => e.couponRecovered === true).map((e) => e.sessionId)
  );
  const completedInCode = Array.from(attemptSessions).filter((s) =>
    completedSessions.has(s)
  ).length;

  const successRate =
    attemptSessions.size > 0
      ? Math.round((successSessions.size / attemptSessions.size) * 1000) / 10
      : 0;

  const cartVals = codeEvents
    .filter((e) => (e.cartValue ?? 0) > 0)
    .map((e) => (e.cartValue as number) / 100);
  const avgCart =
    cartVals.length > 0
      ? Math.round((cartVals.reduce((a, b) => a + b, 0) / cartVals.length) * 100) / 100
      : 0;

  const discounts = codeEvents
    .filter((e) => e.couponSuccess === true && (e.discountAmount ?? 0) > 0)
    .map((e) => (e.discountAmount as number) / 100);
  const totalDiscountGiven = discounts.reduce((a, b) => a + b, 0);
  const avgDiscount =
    discounts.length > 0 ? totalDiscountGiven / discounts.length : 0;

  const convRate =
    attemptSessions.size > 0 ? completedInCode / attemptSessions.size : 0;
  const revPerSession = (avgCart - avgDiscount) * convRate;

  // Previous period success rate
  const prevEvents = prevCodeEventsRes.data ?? [];
  const prevAttempts = new Set(prevEvents.map((e) => e.sessionId));
  const prevSuccess = new Set(
    prevEvents.filter((e) => e.couponSuccess === true).map((e) => e.sessionId)
  );
  const successRatePrev =
    prevAttempts.size > 0
      ? Math.round((prevSuccess.size / prevAttempts.size) * 1000) / 10
      : 0;

  // Status
  let status: 'healthy' | 'degraded' | 'broken';
  if (successRate >= 50) status = 'healthy';
  else if (successRate >= 20) status = 'degraded';
  else status = 'broken';

  // Daily trend
  const dailyMap = new Map<string, { attempts: number; successes: number }>();
  for (const e of codeEvents) {
    const day = new Date(e.occurredAt);
    day.setHours(0, 0, 0, 0);
    const key = day.toISOString();
    if (!dailyMap.has(key)) dailyMap.set(key, { attempts: 0, successes: 0 });
    const b = dailyMap.get(key)!;
    b.attempts++;
    if (e.couponSuccess === true) b.successes++;
  }
  const trend = Array.from(dailyMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => ({ date: formatDate(k), ...v }));

  // Recovery detail
  let recovery = null;
  if (recoverySessions.size > 0) {
    const failedBySess = new Map<string, number>();
    const recoveredBySess = new Map<string, number>();
    const failedItemCount = new Map<string, number>();
    const recoveredItemCount = new Map<string, number>();

    for (const e of codeEvents) {
      if (e.couponSuccess === false && !e.couponRecovered && (e.cartValue ?? 0) > 0) {
        if (!failedBySess.has(e.sessionId)) {
          failedBySess.set(e.sessionId, (e.cartValue as number) / 100);
          failedItemCount.set(e.sessionId, e.cartItemCount ?? 0);
        }
      }
      if (e.couponRecovered === true && (e.cartValue ?? 0) > 0) {
        recoveredBySess.set(e.sessionId, (e.cartValue as number) / 100);
        recoveredItemCount.set(e.sessionId, e.cartItemCount ?? 0);
      }
    }

    const failedVals = Array.from(failedBySess.values());
    const recoveredVals = Array.from(recoveredBySess.values());
    const avgBefore = failedVals.length > 0
      ? failedVals.reduce((a, b) => a + b, 0) / failedVals.length
      : 0;
    const avgAfter = recoveredVals.length > 0
      ? recoveredVals.reduce((a, b) => a + b, 0) / recoveredVals.length
      : 0;

    const failedItems = Array.from(failedItemCount.values());
    const recoveredItems = Array.from(recoveredItemCount.values());
    const avgItemsBefore = failedItems.length > 0
      ? failedItems.reduce((a, b) => a + b, 0) / failedItems.length
      : 0;
    const avgItemsAfter = recoveredItems.length > 0
      ? recoveredItems.reduce((a, b) => a + b, 0) / recoveredItems.length
      : 0;

    recovery = {
      count: recoverySessions.size,
      avgCartBeforeDollars: Math.round(avgBefore * 100) / 100,
      avgCartAfterDollars: Math.round(avgAfter * 100) / 100,
      avgCartIncreaseDollars: Math.round((avgAfter - avgBefore) * 100) / 100,
      avgItemsAdded: Math.round((avgItemsAfter - avgItemsBefore) * 10) / 10,
    };
  }

  // Recent sessions (last 10)
  const recentSessionIds = sessionIds.slice(-10).reverse();
  const recentSessions = recentSessionIds.map((sid) => {
    const sevents = codeEvents.filter((e) => e.sessionId === sid);
    const checkEvs = checkoutEvents.filter((e) => e.sessionId === sid);
    const hasCompleted = checkEvs.some((e) => e.eventType === 'checkout_completed');
    const hasCheckout =
      sevents.some((e) => e.eventType === 'cart_checkout_clicked') ||
      checkEvs.some((e) => e.eventType === 'checkout_started');
    const hasProducts = sevents.some((e) => (e.cartValue ?? 0) > 0);

    const lastCartVal =
      sevents
        .filter((e) => (e.cartValue ?? 0) > 0)
        .reverse()[0]?.cartValue ?? null;

    const hasRecovered = sevents.some((e) => e.couponRecovered === true);
    const hasApplied = sevents.some((e) => e.couponSuccess === true);
    const couponStatus: 'applied' | 'failed' | 'recovered' = hasRecovered
      ? 'recovered'
      : hasApplied
      ? 'applied'
      : 'failed';

    return {
      sessionId: sid,
      occurredAt: sevents[0]?.occurredAt ?? '',
      cartValueDollars: lastCartVal !== null ? lastCartVal / 100 : null,
      outcome: buildOutcome(hasCompleted, hasCheckout, hasProducts),
      couponStatus,
    };
  });

  return NextResponse.json({
    code,
    status,
    attempts: attemptSessions.size,
    trend,
    summary: {
      successRate,
      successRatePrev,
      avgCartDollars: avgCart,
      storeAvgCartDollars: Math.round(storeAvgCart * 100) / 100,
      revPerSession: Math.round(revPerSession * 100) / 100,
      baselineRevPerSession: Math.round(baselineRevPerSession * 100) / 100,
      totalDiscountGiven: Math.round(totalDiscountGiven * 100) / 100,
      totalDiscountOrders: discounts.length,
    },
    recovery,
    recentSessions,
  });
}
