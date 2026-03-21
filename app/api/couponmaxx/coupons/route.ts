export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { buildSessionsFromEvents } from '@/lib/session-utils';
import { getShopFromRequest } from "@/lib/verify-session-token";

function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }
function dateStr(d: Date) { return d.toISOString().slice(0, 10); }

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const shopDomain = getShopFromRequest(req);
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase.from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const shopId = shop.id;

  const end = new Date(p.get('end') ?? new Date().toISOString());
  const start = new Date(p.get('start') ?? subDays(end, 30).toISOString());
  const rangeMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1); // DA-9: no overlap with current period
  const prevStart = subDays(start, Math.round(rangeMs / 86400000));

  const [{ data: couponEvs }, { data: allCartEvs }] = await Promise.all([
    supabase.from('CartEvent')
      .select('sessionId, eventType, couponCode, couponSuccess, couponRecovered, discountAmount, cartValue, occurredAt, device, country, lineItems')
      .eq('shopId', shopId).gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString())
      .not('couponCode', 'is', null).limit(20000),
    supabase.from('CartEvent')
      .select('sessionId, eventType, cartValue, cartItemCount, lineItems, couponCode, couponSuccess, couponRecovered, discountAmount, device, country, occurredAt, utmSource, utmMedium, utmCampaign')
      .eq('shopId', shopId).gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString()).limit(20000),
  ]);

  const truncated = (couponEvs?.length === 20000) || (allCartEvs?.length === 20000);
  const cartEvents = allCartEvs ?? [];
  const sessionIds = Array.from(new Set(cartEvents.map((e) => e.sessionId)));

  // DA-6: batch in groups of 500 — PostgREST .in() cap
  type CheckoutRow = { sessionId: string; eventType: string; totalPrice: number | null; occurredAt: string };
  const checkoutEvs: CheckoutRow[] = [];
  for (let i = 0; i < sessionIds.length; i += 500) {
    const batch = sessionIds.slice(i, i + 500);
    const { data } = await supabase.from('CheckoutEvent')
      .select('sessionId, eventType, totalPrice, occurredAt')
      .eq('shopId', shopId).in('sessionId', batch).limit(5000);
    checkoutEvs.push(...(data ?? []));
  }

  const sessions = buildSessionsFromEvents(
    cartEvents as Parameters<typeof buildSessionsFromEvents>[0],
    checkoutEvs,
  );

  // Per-code stats
  type CodeStats = {
    attempts: Set<string>; successes: Set<string>; recoveries: Set<string>;
    cartValuesSuccess: number[]; cartValuesFail: number[]; discounts: number[];
    lastSeen: string; firstSeen: string;
    dailyAttempts: Map<string, number>; dailySuccesses: Map<string, number>;
    failedSessions: Set<string>; handoffSessions: Set<string>;
  };
  const codeMap = new Map<string, CodeStats>();

  for (const ev of couponEvs ?? []) {
    const code = (ev.couponCode as string).toUpperCase();
    if (!codeMap.has(code)) {
      codeMap.set(code, {
        attempts: new Set(), successes: new Set(), recoveries: new Set(),
        cartValuesSuccess: [], cartValuesFail: [], discounts: [],
        lastSeen: ev.occurredAt, firstSeen: ev.occurredAt,
        dailyAttempts: new Map(), dailySuccesses: new Map(),
        failedSessions: new Set(), handoffSessions: new Set(),
      });
    }
    const s = codeMap.get(code)!;
    s.attempts.add(ev.sessionId);
    if (ev.occurredAt > s.lastSeen) s.lastSeen = ev.occurredAt;
    if (ev.occurredAt < s.firstSeen) s.firstSeen = ev.occurredAt;

    const day = dateStr(new Date(ev.occurredAt));
    s.dailyAttempts.set(day, (s.dailyAttempts.get(day) ?? 0) + 1);

    if (ev.couponSuccess || ev.couponRecovered) {
      s.successes.add(ev.sessionId);
      s.dailySuccesses.set(day, (s.dailySuccesses.get(day) ?? 0) + 1);
      if (ev.cartValue) s.cartValuesSuccess.push(ev.cartValue / 100);
      if (ev.discountAmount) s.discounts.push(ev.discountAmount / 100);
    } else {
      s.failedSessions.add(ev.sessionId);
      if (ev.cartValue) s.cartValuesFail.push(ev.cartValue / 100);
    }
    if (ev.couponRecovered) s.recoveries.add(ev.sessionId);
  }

  // Handoff: failed sessions that converted anyway
  const completedSessionIds = new Set(
    (checkoutEvs).filter((e) => e.eventType === 'checkout_completed').map((e) => e.sessionId)
  );
  for (const [, s] of Array.from(codeMap)) {
    for (const sid of Array.from(s.failedSessions)) {
      if (completedSessionIds.has(sid)) s.handoffSessions.add(sid);
    }
  }

  // Previous period success rates
  const { data: prevEvs } = await supabase.from('CartEvent')
    .select('couponCode, couponSuccess, couponRecovered, sessionId')
    .eq('shopId', shopId).gte('occurredAt', prevStart.toISOString()).lte('occurredAt', prevEnd.toISOString())
    .not('couponCode', 'is', null).limit(10000);

  const prevCodeSuccessRate = new Map<string, number>();
  const prevAttempts = new Map<string, Set<string>>();
  const prevSuccesses = new Map<string, Set<string>>();
  for (const ev of prevEvs ?? []) {
    const code = (ev.couponCode as string).toUpperCase();
    if (!prevAttempts.has(code)) { prevAttempts.set(code, new Set()); prevSuccesses.set(code, new Set()); }
    prevAttempts.get(code)!.add(ev.sessionId);
    if (ev.couponSuccess || ev.couponRecovered) prevSuccesses.get(code)!.add(ev.sessionId);
  }
  for (const [code, pa] of Array.from(prevAttempts)) {
    const ps = prevSuccesses.get(code)!;
    prevCodeSuccessRate.set(code, pa.size > 0 ? Math.round((ps.size / pa.size) * 1000) / 10 : 0);
  }

  // KPI: overall success rate
  let totalAttempts = 0, totalSuccesses = 0;
  for (const s of Array.from(codeMap.values())) {
    totalAttempts += s.attempts.size;
    totalSuccesses += s.successes.size;
  }
  const couponSuccessRate = totalAttempts > 0 ? Math.round((totalSuccesses / totalAttempts) * 1000) / 10 : 0;
  const prevTotalAttempts = Array.from(prevAttempts.values()).reduce((n, s) => n + s.size, 0);
  const prevTotalSuccesses = Array.from(prevSuccesses.values()).reduce((n, s) => n + s.size, 0);
  const prevRate = prevTotalAttempts > 0 ? Math.round((prevTotalSuccesses / prevTotalAttempts) * 1000) / 10 : 0;
  const couponSuccessRateDelta = Math.round((couponSuccessRate - prevRate) * 10) / 10;

  // KPI: AOV with / without coupon
  const withCouponOrders = sessions.filter((s) => s.coupons.length > 0 && s.outcome === 'ordered');
  const withoutCouponOrders = sessions.filter((s) => s.coupons.length === 0 && s.outcome === 'ordered');
  const checkoutCompletedEvs = (checkoutEvs).filter((e) => e.eventType === 'checkout_completed');
  const ccMap = new Map(checkoutCompletedEvs.map((e) => [e.sessionId, e.totalPrice as number ?? 0]));
  const aovWithCoupon = withCouponOrders.length > 0
    ? withCouponOrders.reduce((sum, s) => sum + (ccMap.get(s.sessionId) ?? 0), 0) / withCouponOrders.length : 0;
  const aovWithoutCoupon = withoutCouponOrders.length > 0
    ? withoutCouponOrders.reduce((sum, s) => sum + (ccMap.get(s.sessionId) ?? 0), 0) / withoutCouponOrders.length : 0;

  // KPI: abandoned after coupon failure
  const failAbandoned = sessions.filter((s) => {
    if (!s.coupons.some((c) => c.status === 'failed')) return false;
    return s.outcome === 'abandoned';
  });
  const abandonedCartValue = failAbandoned.reduce((sum, s) => sum + (s.cartValueEnd ?? 0), 0);

  // Build code table rows
  function getStatus(successRate: number, attempts: number): 'healthy' | 'degraded' | 'broken' | 'low_data' {
    if (attempts < 15) return 'low_data';
    if (successRate >= 80) return 'healthy';
    if (successRate >= 50) return 'degraded';
    return 'broken';
  }

  // All dates in range for velocity chart
  const allDates: string[] = [];
  let cur = new Date(start);
  while (cur <= end) { allDates.push(dateStr(cur)); cur = subDays(cur, -1); }

  const codeRows = Array.from(codeMap.entries()).map(([code, s]) => {
    const successRate = s.attempts.size > 0 ? Math.round((s.successes.size / s.attempts.size) * 1000) / 10 : 0;
    const avgCartSuccess = s.cartValuesSuccess.length > 0 ? s.cartValuesSuccess.reduce((a, b) => a + b, 0) / s.cartValuesSuccess.length : 0;
    const avgCartFail = s.cartValuesFail.length > 0 ? s.cartValuesFail.reduce((a, b) => a + b, 0) / s.cartValuesFail.length : 0;
    const handoffRate = s.failedSessions.size > 0 ? Math.round((s.handoffSessions.size / s.failedSessions.size) * 1000) / 10 : 0;
    const revPerSession = s.attempts.size > 0 ? s.discounts.reduce((a, b) => a + b, 0) / s.attempts.size : 0;
    const vsBaseline = revPerSession - (aovWithoutCoupon * (couponSuccessRate / 100));
    return {
      code,
      status: getStatus(successRate, s.attempts.size),
      attempts: s.attempts.size,
      successRate,
      prevSuccessRate: prevCodeSuccessRate.get(code) ?? null,
      avgCart: Math.round(avgCartSuccess * 100) / 100,
      avgCartFail: Math.round(avgCartFail * 100) / 100,
      recoveries: s.recoveries.size,
      handoffRate,
      revPerSession: Math.round(revPerSession * 100) / 100,
      vsBaseline: Math.round(vsBaseline * 100) / 100,
      lastSeen: s.lastSeen,
      lowData: s.attempts.size < 15,
    };
  });

  codeRows.sort((a, b) => b.attempts - a.attempts);

  const topCodes = codeRows.slice(0, 5).map((r) => r.code);
  const velocityDaily = allDates.map((date) => {
    const point: Record<string, string | number> = { date };
    for (const code of topCodes) {
      point[code] = codeMap.get(code)?.dailyAttempts.get(date) ?? 0;
    }
    if (codeRows.length > 5) {
      point['Others'] = codeRows.slice(5).reduce((sum, r) => sum + (codeMap.get(r.code)?.dailyAttempts.get(date) ?? 0), 0);
    }
    return point;
  });

  const successRateChart = codeRows.map((r) => ({
    code: r.code,
    attempts: r.attempts,
    successRate: r.successRate,
    status: r.status,
  }));

  // Zombie codes: 0% success and not low_data (>=15 attempts)
  const zombieCodes = codeRows.filter((r) => r.status !== 'low_data' && r.successRate === 0).map((r) => ({
    code: r.code,
    attempts: r.attempts,
    firstSeen: codeMap.get(r.code)!.firstSeen,
    lastSeen: codeMap.get(r.code)!.lastSeen,
  }));

  const healthy = codeRows.filter((r) => r.status === 'healthy').length;
  const degraded = codeRows.filter((r) => r.status === 'degraded').length;
  const broken = codeRows.filter((r) => r.status === 'broken').length;

  return NextResponse.json({
    truncated,
    boxes: {
      codesTracked: codeRows.length,
      brokenCount: broken,
      degradedCount: degraded,
      healthyCount: healthy,
      couponSuccessRate,
      couponSuccessRateDelta,
      aovWithCoupon: Math.round(aovWithCoupon * 100) / 100,
      aovWithoutCoupon: Math.round(aovWithoutCoupon * 100) / 100,
      abandonedAfterFail: failAbandoned.length,
      abandonedAfterFailPct: failAbandoned.length > 0 && sessions.filter((s) => s.coupons.some((c) => c.status === 'failed')).length > 0
        ? Math.round((failAbandoned.length / sessions.filter((s) => s.coupons.some((c) => c.status === 'failed')).length) * 1000) / 10
        : 0,
      abandonedCartValue: Math.round(abandonedCartValue * 100) / 100,
    },
    velocityChart: {
      codes: topCodes,
      daily: velocityDaily,
    },
    successRateChart,
    codes: codeRows,
    zombieCodes,
  });
}
