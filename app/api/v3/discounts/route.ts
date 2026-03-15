export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { buildSessionsFromEvents, deriveSourceV3 } from '@/lib/v3/session-builder';

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86400000);
}

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const end = new Date(req.nextUrl.searchParams.get('end') ?? new Date().toISOString());
  const start = new Date(req.nextUrl.searchParams.get('start') ?? subDays(end, 30).toISOString());

  const device = req.nextUrl.searchParams.get('device') ?? '';
  const country = req.nextUrl.searchParams.get('country') ?? '';
  const source = req.nextUrl.searchParams.get('source') ?? '';

  // Fetch coupon events
  let couponQuery = supabase.from('CartEvent')
    .select('sessionId, eventType, couponCode, couponSuccess, couponRecovered, discountAmount, cartValue, occurredAt, device, country, lineItems, cartItemCount, utmSource, utmMedium, utmCampaign')
    .eq('shopId', shop.id)
    .gte('occurredAt', start.toISOString())
    .lte('occurredAt', end.toISOString())
    .not('couponCode', 'is', null)
    .in('eventType', ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'])
    .limit(10000);

  if (device) couponQuery = couponQuery.eq('device', device);
  if (country) couponQuery = couponQuery.ilike('country', country);

  const { data: couponEvents } = await couponQuery;

  // Fetch all events for cart value stats
  let allQuery = supabase.from('CartEvent')
    .select('sessionId, eventType, cartValue, cartItemCount, lineItems, couponCode, couponSuccess, couponRecovered, discountAmount, device, country, occurredAt, utmSource, utmMedium, utmCampaign')
    .eq('shopId', shop.id)
    .gte('occurredAt', start.toISOString())
    .lte('occurredAt', end.toISOString())
    .limit(15000);

  if (device) allQuery = allQuery.eq('device', device);

  const { data: allCartEvents } = await allQuery;
  const cartEvents = allCartEvents ?? [];

  const sessionIds = Array.from(new Set(cartEvents.map((e) => e.sessionId)));
  const { data: checkoutEvents } = await supabase.from('CheckoutEvent')
    .select('sessionId, eventType, totalPrice, occurredAt')
    .eq('shopId', shop.id)
    .in('sessionId', sessionIds.slice(0, 500))
    .limit(5000);

  const allSessions = buildSessionsFromEvents(
    cartEvents as Parameters<typeof buildSessionsFromEvents>[0],
    checkoutEvents ?? [],
  );
  const sessions = source
    ? allSessions.filter((s) => deriveSourceV3(s.utmSource, s.utmMedium).toLowerCase() === source.toLowerCase())
    : allSessions;

  // ── KPI 1: Active codes ───────────────────────────────────────────────────
  const activeCodes = new Set((couponEvents ?? []).map((e) => (e.couponCode as string).toUpperCase()));

  // ── KPI 2: Avg cart with/without coupon ───────────────────────────────────
  const withCouponSessions = sessions.filter((s) => s.coupons.length > 0 && (s.cartValueEnd ?? 0) > 0);
  const withoutCouponSessions = sessions.filter((s) => s.coupons.length === 0 && (s.cartValueEnd ?? 0) > 0);
  const avgCartWithCoupon = withCouponSessions.length > 0
    ? withCouponSessions.reduce((sum, s) => sum + (s.cartValueEnd ?? 0), 0) / withCouponSessions.length : 0;
  const avgCartWithoutCoupon = withoutCouponSessions.length > 0
    ? withoutCouponSessions.reduce((sum, s) => sum + (s.cartValueEnd ?? 0), 0) / withoutCouponSessions.length : 0;

  // ── KPI 3: Recovered carts ────────────────────────────────────────────────
  const recoveredSessions = new Set(
    (couponEvents ?? []).filter((e) => e.couponRecovered).map((e) => e.sessionId)
  );

  // ── Build per-code stats ───────────────────────────────────────────────────
  type CodeStats = {
    attempts: Set<string>; // sessionIds
    successes: Set<string>;
    recoveries: Set<string>;
    cartValues: number[];
    discounts: number[];
    lastSeen: string;
    events: NonNullable<typeof couponEvents>;
  };
  const codeStatsMap = new Map<string, CodeStats>();

  for (const ev of couponEvents ?? []) {
    const code = (ev.couponCode as string).toUpperCase();
    if (!codeStatsMap.has(code)) {
      codeStatsMap.set(code, {
        attempts: new Set(), successes: new Set(), recoveries: new Set(),
        cartValues: [], discounts: [], lastSeen: ev.occurredAt, events: [],
      });
    }
    const s = codeStatsMap.get(code)!;
    s.attempts.add(ev.sessionId);
    if (ev.couponSuccess) s.successes.add(ev.sessionId);
    if (ev.couponRecovered) s.recoveries.add(ev.sessionId);
    if (ev.cartValue != null && ev.cartValue > 0) s.cartValues.push(ev.cartValue / 100);
    if (ev.discountAmount != null && ev.discountAmount > 0) s.discounts.push(ev.discountAmount / 100);
    if (ev.occurredAt > s.lastSeen) s.lastSeen = ev.occurredAt;
    s.events.push(ev);
  }

  // Revenue per session baseline
  const noCouponCheckoutSessions = sessions.filter((s) => s.coupons.length === 0 && s.outcome !== 'abandoned');
  const noCouponCompleted = sessions.filter((s) => s.coupons.length === 0 && s.outcome === 'ordered');
  const noCouponConvRate = noCouponCheckoutSessions.length > 0
    ? noCouponCompleted.length / sessions.filter((s) => s.coupons.length === 0).length : 0;
  const noCouponAvgCart = withoutCouponSessions.length > 0 ? avgCartWithoutCoupon : 0;
  const baselineRevPerSession = noCouponAvgCart * noCouponConvRate;

  const codeDefs = Array.from(codeStatsMap.entries()).map(([code, stats]) => {
    const attempts = stats.attempts.size;
    const successes = stats.successes.size;
    const successRate = attempts > 0 ? Math.round((successes / attempts) * 100) : 0;
    const status = successRate >= 50 ? 'healthy' : successRate >= 20 ? 'degraded' : 'broken';
    const avgCart = stats.cartValues.length > 0
      ? stats.cartValues.reduce((a, b) => a + b, 0) / stats.cartValues.length : 0;
    const avgDiscount = stats.discounts.length > 0
      ? stats.discounts.reduce((a, b) => a + b, 0) / stats.discounts.length : 0;

    // Rev per session
    const codeSessions = sessions.filter((s) => s.coupons.some((c) => c.code === code));
    const codeCompleted = codeSessions.filter((s) => s.outcome === 'ordered').length;
    const codeCheckout = codeSessions.filter((s) => s.outcome !== 'abandoned').length;
    const codeConvRate = codeCheckout > 0 ? codeCompleted / codeSessions.length : 0;
    const revPerSession = (avgCart - avgDiscount) * codeConvRate;

    return {
      code,
      status,
      attempts,
      successRate,
      avgCart: Math.round(avgCart * 100) / 100,
      avgDiscount: Math.round(avgDiscount * 100) / 100,
      recoveries: stats.recoveries.size,
      revPerSession: Math.round(revPerSession * 100) / 100,
      vsBaseline: Math.round((revPerSession - baselineRevPerSession) * 100) / 100,
      lowData: attempts < 10,
      lastSeen: stats.lastSeen,
    };
  }).sort((a, b) => b.attempts - a.attempts);

  // ── KPI 4: Codes needing attention ───────────────────────────────────────
  const brokenCodes = codeDefs.filter((c) => c.status === 'broken').map((c) => c.code);
  const degradedCodes = codeDefs.filter((c) => c.status === 'degraded').map((c) => c.code);
  const attentionCount = brokenCodes.length + degradedCodes.length;

  // ── Chart: Grouped bar (avg cart + conv rate per code) ────────────────────
  const chartData = codeDefs.map((c) => {
    const codeSessions = sessions.filter((s) => s.coupons.some((cu) => cu.code === c.code));
    const codeCheckout = codeSessions.filter((s) => s.outcome !== 'abandoned').length;
    const codeCompleted = codeSessions.filter((s) => s.outcome === 'ordered').length;
    const convRate = codeCheckout > 0 ? Math.round((codeCompleted / codeCheckout) * 1000) / 10 : 0;
    return { code: c.code, avgCart: c.avgCart, convRate };
  });

  return NextResponse.json({
    kpis: {
      activeCodes: activeCodes.size,
      avgCartWithCoupon: Math.round(avgCartWithCoupon * 100) / 100,
      avgCartWithoutCoupon: Math.round(avgCartWithoutCoupon * 100) / 100,
      cartLift: Math.round((avgCartWithCoupon - avgCartWithoutCoupon) * 100) / 100,
      recoveredCarts: recoveredSessions.size,
      attentionCount,
      brokenCodes: brokenCodes.slice(0, 3),
    },
    codes: codeDefs,
    chartData,
  });
}
