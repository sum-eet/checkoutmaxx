export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { buildSessionsFromEvents } from '@/lib/v3/session-builder';

function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }
function dateStr(d: Date) { return d.toISOString().slice(0, 10); }

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const p = req.nextUrl.searchParams;
  const shopDomain = p.get('shop');
  const code = params.code.toUpperCase();
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase.from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const shopId = shop.id;

  const end = new Date(p.get('end') ?? new Date().toISOString());
  const start = new Date(p.get('start') ?? subDays(end, 30).toISOString());
  const rangeMs = end.getTime() - start.getTime();
  const prevEnd = start;
  const prevStart = subDays(start, Math.round(rangeMs / 86400000));

  const [{ data: codeEvs }, { data: allCartEvs }, { data: prevEvs }] = await Promise.all([
    supabase.from('CartEvent')
      .select('sessionId, eventType, couponCode, couponSuccess, couponRecovered, discountAmount, cartValue, occurredAt, lineItems')
      .eq('shopId', shopId).ilike('couponCode', code)
      .gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString()).limit(5000),
    supabase.from('CartEvent')
      .select('sessionId, eventType, cartValue, cartItemCount, lineItems, couponCode, couponSuccess, couponRecovered, discountAmount, device, country, occurredAt, utmSource, utmMedium, utmCampaign')
      .eq('shopId', shopId).gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString()).limit(20000),
    supabase.from('CartEvent')
      .select('couponCode, couponSuccess, couponRecovered, sessionId')
      .eq('shopId', shopId).ilike('couponCode', code)
      .gte('occurredAt', prevStart.toISOString()).lte('occurredAt', prevEnd.toISOString()).limit(2000),
  ]);

  const cartEvents = allCartEvs ?? [];
  const sessionIds = Array.from(new Set(cartEvents.map((e) => e.sessionId)));
  const { data: checkoutEvs } = await supabase.from('CheckoutEvent')
    .select('sessionId, eventType, totalPrice, occurredAt').eq('shopId', shopId)
    .in('sessionId', sessionIds.slice(0, 500)).limit(5000);

  const sessions = buildSessionsFromEvents(
    cartEvents as Parameters<typeof buildSessionsFromEvents>[0],
    checkoutEvs ?? [],
  );

  const attempts = new Set((codeEvs ?? []).map((e) => e.sessionId));
  const successes = new Set((codeEvs ?? []).filter((e) => e.couponSuccess || e.couponRecovered).map((e) => e.sessionId));
  const recoveries = new Set((codeEvs ?? []).filter((e) => e.couponRecovered).map((e) => e.sessionId));
  const successRate = attempts.size > 0 ? Math.round((successes.size / attempts.size) * 1000) / 10 : 0;

  const prevAttempts = new Set((prevEvs ?? []).map((e) => e.sessionId));
  const prevSuccesses = new Set((prevEvs ?? []).filter((e) => e.couponSuccess || e.couponRecovered).map((e) => e.sessionId));
  const prevSuccessRate = prevAttempts.size > 0 ? Math.round((prevSuccesses.size / prevAttempts.size) * 1000) / 10 : null;

  const successCartVals = (codeEvs ?? []).filter((e) => (e.couponSuccess || e.couponRecovered) && e.cartValue).map((e) => e.cartValue! / 100);
  const failCartVals = (codeEvs ?? []).filter((e) => !e.couponSuccess && !e.couponRecovered && e.cartValue).map((e) => e.cartValue! / 100);
  const avgCart = successCartVals.length > 0 ? successCartVals.reduce((a, b) => a + b, 0) / successCartVals.length : 0;
  const avgCartFail = failCartVals.length > 0 ? failCartVals.reduce((a, b) => a + b, 0) / failCartVals.length : 0;
  const totalDiscount = (codeEvs ?? []).filter((e) => e.discountAmount).reduce((sum, e) => sum + (e.discountAmount! / 100), 0);

  // Handoff rate
  const failedSessions = new Set((codeEvs ?? []).filter((e) => !e.couponSuccess && !e.couponRecovered).map((e) => e.sessionId));
  const completedSessIds = new Set((checkoutEvs ?? []).filter((e) => e.eventType === 'checkout_completed').map((e) => e.sessionId));
  const handoffSessions = Array.from(failedSessions).filter((id) => completedSessIds.has(id));
  const handoffRate = failedSessions.size > 0 ? Math.round((handoffSessions.length / failedSessions.size) * 1000) / 10 : 0;

  // Velocity trend (daily)
  const allDates: string[] = [];
  let cur = new Date(start);
  while (cur <= end) { allDates.push(dateStr(cur)); cur = subDays(cur, -1); }

  const dailyAttempts = new Map<string, number>();
  const dailySuccesses = new Map<string, number>();
  for (const e of codeEvs ?? []) {
    const day = dateStr(new Date(e.occurredAt));
    dailyAttempts.set(day, (dailyAttempts.get(day) ?? 0) + 1);
    if (e.couponSuccess || e.couponRecovered) dailySuccesses.set(day, (dailySuccesses.get(day) ?? 0) + 1);
  }
  const trend = allDates.map((date) => ({
    date,
    attempts: dailyAttempts.get(date) ?? 0,
    successes: dailySuccesses.get(date) ?? 0,
  }));

  // Status
  const status = attempts.size < 5 ? 'low_data' : successRate >= 50 ? 'healthy' : successRate >= 20 ? 'degraded' : 'broken';

  // Product breakdown
  const productMap = new Map<string, { attempts: number; successes: number }>();
  for (const e of codeEvs ?? []) {
    const li = e.lineItems as Array<{ productTitle?: string }> | null;
    if (!Array.isArray(li)) continue;
    for (const item of li) {
      const title = item.productTitle ?? 'Unknown';
      if (!productMap.has(title)) productMap.set(title, { attempts: 0, successes: 0 });
      const s = productMap.get(title)!;
      s.attempts++;
      if (e.couponSuccess || e.couponRecovered) s.successes++;
    }
  }
  const productBreakdown = Array.from(productMap.entries()).map(([products, s]) => ({
    products,
    attempts: s.attempts,
    successRate: s.attempts > 0 ? Math.round((s.successes / s.attempts) * 1000) / 10 : 0,
    note: s.attempts >= 3 && s.successes === 0 ? 'Product restriction likely' : '',
  })).sort((a, b) => b.attempts - a.attempts);
  const hasProductRestriction = productBreakdown.some((p) => p.note !== '');

  // Recovery detail
  let recoveryDetail = null;
  if (recoveries.size > 0) {
    const recoveryEvs = (codeEvs ?? []).filter((e) => e.couponRecovered);
    const recoverySessions = sessions.filter((s) => recoveries.has(s.sessionId));
    const avgBefore = recoverySessions.length > 0
      ? recoverySessions.reduce((sum, s) => sum + (s.cartValueStart ?? 0), 0) / recoverySessions.length : 0;
    const avgAfter = recoverySessions.length > 0
      ? recoverySessions.reduce((sum, s) => sum + (s.cartValueEnd ?? 0), 0) / recoverySessions.length : 0;
    const recoveredConverted = recoverySessions.filter((s) => s.outcome === 'ordered').length;
    recoveryDetail = {
      count: recoveries.size,
      avgCartBefore: Math.round(avgBefore * 100) / 100,
      avgCartAfter: Math.round(avgAfter * 100) / 100,
      avgIncrease: Math.round((avgAfter - avgBefore) * 100) / 100,
      convRateAfterRecovery: recoverySessions.length > 0 ? Math.round((recoveredConverted / recoverySessions.length) * 1000) / 10 : 0,
    };
  }

  // Cannibalization
  const codeFailedInSession = sessions.filter((s) => s.coupons.some((c) => c.code === code && (c.status === 'failed')));
  const codeSucceededInSession = sessions.filter((s) => s.coupons.some((c) => c.code === code && (c.status === 'applied' || c.status === 'recovered')));
  const savedSessions = codeSucceededInSession.filter((s) => s.coupons.some((c) => c.code !== code && c.status === 'failed')).length;
  const continuedAfterFail = codeFailedInSession.filter((s) => s.coupons.some((c) => c.code !== code && (c.status === 'applied' || c.status === 'recovered')));
  const continuedCodes = new Map<string, number>();
  for (const s of continuedAfterFail) {
    const successCode = s.coupons.find((c) => c.code !== code && (c.status === 'applied' || c.status === 'recovered'));
    if (successCode) continuedCodes.set(successCode.code, (continuedCodes.get(successCode.code) ?? 0) + 1);
  }

  // Recent sessions
  const codeSessionIds = new Set(Array.from(attempts));
  const recentSessions = sessions
    .filter((s) => codeSessionIds.has(s.sessionId))
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
    .slice(0, 10)
    .map((s) => ({
      sessionId: s.sessionId,
      startTime: s.startTime,
      cartValue: s.cartValueEnd,
      outcome: s.outcome,
      couponStatus: s.coupons.find((c) => c.code === code)?.status ?? 'unknown',
    }));

  return NextResponse.json({
    code, status, attempts: attempts.size, successRate, prevSuccessRate,
    avgCart: Math.round(avgCart * 100) / 100,
    avgCartFail: Math.round(avgCartFail * 100) / 100,
    totalDiscount: Math.round(totalDiscount * 100) / 100,
    handoffRate, revPerSession: 0,
    trend,
    productBreakdown, hasProductRestriction,
    recoveryDetail,
    cannibalization: {
      savedSessions,
      continuedAfterFail: continuedAfterFail.length,
      continuedCodes: Array.from(continuedCodes.entries()).map(([c, n]) => ({ code: c, count: n })),
    },
    recentSessions,
  });
}
