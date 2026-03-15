export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { buildSessionsFromEvents } from '@/lib/v3/session-builder';

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86400000);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } }
) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const code = decodeURIComponent(params.code).toUpperCase();

  const { data: shop } = await supabase
    .from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const end = new Date(req.nextUrl.searchParams.get('end') ?? new Date().toISOString());
  const start = new Date(req.nextUrl.searchParams.get('start') ?? subDays(end, 30).toISOString());

  // Previous period for delta
  const rangeMs = end.getTime() - start.getTime();
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - rangeMs);

  // Coupon events for this code (current period)
  const { data: couponEvents } = await supabase.from('CartEvent')
    .select('sessionId, eventType, couponCode, couponSuccess, couponRecovered, discountAmount, cartValue, occurredAt, lineItems')
    .eq('shopId', shop.id)
    .gte('occurredAt', start.toISOString())
    .lte('occurredAt', end.toISOString())
    .ilike('couponCode', code)
    .in('eventType', ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'])
    .order('occurredAt', { ascending: true })
    .limit(2000);

  // Previous period stats
  const { data: prevCouponEvents } = await supabase.from('CartEvent')
    .select('sessionId, couponSuccess')
    .eq('shopId', shop.id)
    .gte('occurredAt', prevStart.toISOString())
    .lte('occurredAt', prevEnd.toISOString())
    .ilike('couponCode', code)
    .in('eventType', ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'])
    .limit(1000);

  const prevAttempts = new Set((prevCouponEvents ?? []).map((e) => e.sessionId)).size;
  const prevSuccesses = new Set((prevCouponEvents ?? []).filter((e) => e.couponSuccess).map((e) => e.sessionId)).size;
  const prevSuccessRate = prevAttempts > 0 ? Math.round((prevSuccesses / prevAttempts) * 100) : null;

  // All cart events for sessions that used this code (for session building)
  const codeSessionIds = Array.from(new Set((couponEvents ?? []).map((e) => e.sessionId)));

  const { data: sessionCartEvents } = await supabase.from('CartEvent')
    .select('sessionId, eventType, cartValue, cartItemCount, lineItems, couponCode, couponSuccess, couponRecovered, discountAmount, device, country, occurredAt, utmSource, utmMedium, utmCampaign')
    .eq('shopId', shop.id)
    .in('sessionId', codeSessionIds.slice(0, 200))
    .limit(5000);

  const { data: checkoutEvents } = await supabase.from('CheckoutEvent')
    .select('sessionId, eventType, totalPrice, occurredAt')
    .eq('shopId', shop.id)
    .in('sessionId', codeSessionIds.slice(0, 200))
    .limit(2000);

  const codeSessions = buildSessionsFromEvents(
    sessionCartEvents as Parameters<typeof buildSessionsFromEvents>[0] ?? [],
    checkoutEvents ?? [],
  );

  // Summary stats
  const attempts = new Set((couponEvents ?? []).map((e) => e.sessionId)).size;
  const successes = new Set((couponEvents ?? []).filter((e) => e.couponSuccess).map((e) => e.sessionId)).size;
  const successRate = attempts > 0 ? Math.round((successes / attempts) * 100) : 0;
  const status = successRate >= 50 ? 'healthy' : successRate >= 20 ? 'degraded' : 'broken';

  const cartValues = (couponEvents ?? []).filter((e) => e.cartValue != null && e.cartValue > 0)
    .map((e) => (e.cartValue!) / 100);
  const avgCart = cartValues.length > 0 ? cartValues.reduce((a, b) => a + b, 0) / cartValues.length : 0;

  const discounts = (couponEvents ?? []).filter((e) => e.discountAmount != null && e.discountAmount > 0)
    .map((e) => (e.discountAmount!) / 100);
  const totalDiscount = discounts.reduce((a, b) => a + b, 0);

  const completed = codeSessions.filter((s) => s.outcome === 'ordered');
  const reachedCheckout = codeSessions.filter((s) => s.outcome !== 'abandoned');
  const convRate = reachedCheckout.length > 0
    ? Math.round((completed.length / codeSessions.length) * 1000) / 10 : 0;

  // ── Trend chart: daily attempts + successes ───────────────────────────────
  const trendMap = new Map<string, { attempts: Set<string>; successes: Set<string> }>();
  for (const ev of couponEvents ?? []) {
    const day = ev.occurredAt.slice(0, 10);
    if (!trendMap.has(day)) trendMap.set(day, { attempts: new Set(), successes: new Set() });
    const d = trendMap.get(day)!;
    d.attempts.add(ev.sessionId);
    if (ev.couponSuccess) d.successes.add(ev.sessionId);
  }
  const trend = Array.from(trendMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { attempts: a, successes: s }]) => ({
      date, attempts: a.size, successes: s.size,
    }));

  // ── Product breakdown ─────────────────────────────────────────────────────
  type ProductGroup = { products: string; attempts: number; successes: number };
  const productGroupMap = new Map<string, ProductGroup>();
  for (const ev of couponEvents ?? []) {
    const lineItems = ev.lineItems;
    if (!lineItems || !Array.isArray(lineItems) || lineItems.length === 0) continue;
    const titles = (lineItems as Array<{ productTitle?: string }>)
      .map((i) => i.productTitle ?? 'Unknown').sort().join(', ');
    if (!productGroupMap.has(titles)) {
      productGroupMap.set(titles, { products: titles, attempts: 0, successes: 0 });
    }
    const pg = productGroupMap.get(titles)!;
    pg.attempts++;
    if (ev.couponSuccess) pg.successes++;
  }
  const productBreakdown = Array.from(productGroupMap.values())
    .map((pg) => ({
      products: pg.products,
      attempts: pg.attempts,
      successRate: pg.attempts > 0 ? Math.round((pg.successes / pg.attempts) * 100) : 0,
    }))
    .sort((a, b) => b.attempts - a.attempts);

  // Check for significant variation (>20pp) between groups
  const maxSuccessRate = productBreakdown.length > 0 ? Math.max(...productBreakdown.map((p) => p.successRate)) : 0;
  const minSuccessRate = productBreakdown.length > 0 ? Math.min(...productBreakdown.map((p) => p.successRate)) : 0;
  const hasProductRestriction = (maxSuccessRate - minSuccessRate) > 20 && productBreakdown.length > 1;

  // ── Recovery detail ───────────────────────────────────────────────────────
  const recoveredSessions = codeSessions.filter((s) => s.coupons.some((c) => c.code === code && c.status === 'recovered'));
  const recoveredEvs = (couponEvents ?? []).filter((e) => e.couponRecovered);

  let recoveryDetail = null;
  if (recoveredSessions.length > 0) {
    // Cart values: find first failed attempt (before) and last cart value (after)
    const beforeCarts: number[] = [];
    const afterCarts: number[] = [];
    for (const s of recoveredSessions) {
      const beforeCart = s.cartValueStart ?? s.cartValueEnd ?? 0;
      const afterCart = s.cartValueEnd ?? s.cartValueStart ?? 0;
      if (beforeCart > 0) beforeCarts.push(beforeCart);
      if (afterCart > 0) afterCarts.push(afterCart);
    }
    const avgBefore = beforeCarts.length > 0 ? beforeCarts.reduce((a, b) => a + b, 0) / beforeCarts.length : 0;
    const avgAfter = afterCarts.length > 0 ? afterCarts.reduce((a, b) => a + b, 0) / afterCarts.length : 0;
    const recoveryCompleted = recoveredSessions.filter((s) => s.outcome === 'ordered').length;
    const recoveryConvRate = recoveredSessions.length > 0
      ? Math.round((recoveryCompleted / recoveredSessions.length) * 1000) / 10 : 0;

    recoveryDetail = {
      count: recoveredSessions.length,
      avgCartBefore: Math.round(avgBefore * 100) / 100,
      avgCartAfter: Math.round(avgAfter * 100) / 100,
      avgIncrease: Math.round((avgAfter - avgBefore) * 100) / 100,
      convRateAfterRecovery: recoveryConvRate,
    };
  }

  // ── Recent sessions (last 10) ─────────────────────────────────────────────
  const recentSessions = codeSessions
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 10)
    .map((s) => {
      const coupon = s.coupons.find((c) => c.code === code);
      return {
        sessionId: s.sessionId,
        startTime: s.startTime,
        cartValue: s.cartValueEnd ?? s.cartValueStart ?? null,
        outcome: s.outcome,
        couponStatus: coupon?.status ?? 'failed',
      };
    });

  return NextResponse.json({
    code,
    status,
    attempts,
    successRate,
    prevSuccessRate,
    avgCart: Math.round(avgCart * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    convRate,
    trend,
    productBreakdown: productBreakdown.length > 1 ? productBreakdown : [],
    hasProductRestriction,
    recoveryDetail,
    recentSessions,
  });
}
