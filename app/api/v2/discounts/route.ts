export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
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
  const start = new Date(
    req.nextUrl.searchParams.get('start') ?? subDays(end, 30).toISOString()
  );

  const { data: couponEvents } = await supabase
    .from('CartEvent')
    .select('sessionId, eventType, couponCode, couponSuccess, couponRecovered, discountAmount, cartValue, occurredAt')
    .eq('shopId', shop.id)
    .gte('occurredAt', start.toISOString())
    .lte('occurredAt', end.toISOString())
    .not('couponCode', 'is', null)
    .limit(10000);

  // Build checkout outcome map
  const allSessionIds = Array.from(new Set((couponEvents ?? []).map((e) => e.sessionId)));
  const completedSessions = new Set<string>();
  if (allSessionIds.length > 0) {
    const { data: checkoutEvs } = await supabase
      .from('CheckoutEvent')
      .select('sessionId, eventType')
      .eq('shopId', shop.id)
      .in('sessionId', allSessionIds.slice(0, 500))
      .eq('eventType', 'checkout_completed');
    for (const e of checkoutEvs ?? []) completedSessions.add(e.sessionId);
  }

  if (!couponEvents || couponEvents.length === 0) {
    return NextResponse.json({
      summary: { active: 0, healthy: 0, needsAttention: 0 },
      codes: [],
    });
  }

  // Group by code
  const byCode = new Map<string, typeof couponEvents>();
  for (const e of couponEvents) {
    const code = (e.couponCode as string).toUpperCase();
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(e);
  }

  // Baseline for rev/session (no coupon)
  // We don't fetch no-coupon data here — set to null (will be derived client-side if needed)
  const codes = Array.from(byCode.entries()).map(([code, events]) => {
    const sessionIds = new Set(events.map((e) => e.sessionId));
    const attemptSessions = sessionIds.size;

    const successSessions = new Set(
      events.filter((e) => e.couponSuccess === true).map((e) => e.sessionId)
    );
    const successRate = attemptSessions > 0
      ? Math.round((successSessions.size / attemptSessions) * 1000) / 10
      : 0;

    const recoverySessions = new Set(
      events.filter((e) => e.couponRecovered === true).map((e) => e.sessionId)
    );

    const cartValues = events
      .filter((e) => (e.cartValue ?? 0) > 0)
      .map((e) => (e.cartValue as number) / 100);
    const avgCart =
      cartValues.length > 0
        ? Math.round((cartValues.reduce((a, b) => a + b, 0) / cartValues.length) * 100) / 100
        : null;

    // Rev/session
    const completedInCode = Array.from(sessionIds).filter((s) => completedSessions.has(s)).length;
    const actualConvRate = attemptSessions > 0 ? completedInCode / attemptSessions : 0;
    const discounts = events
      .filter((e) => e.couponSuccess === true && (e.discountAmount ?? 0) > 0)
      .map((e) => (e.discountAmount as number) / 100);
    const avgDiscount =
      discounts.length > 0
        ? discounts.reduce((a, b) => a + b, 0) / discounts.length
        : 0;
    const revPerSession =
      avgCart !== null
        ? Math.round(((avgCart - avgDiscount) * actualConvRate) * 100) / 100
        : null;

    const lastSeen = events
      .map((e) => e.occurredAt)
      .sort()
      .reverse()[0];

    let status: 'healthy' | 'degraded' | 'broken';
    if (successRate >= 50) status = 'healthy';
    else if (successRate >= 20) status = 'degraded';
    else status = 'broken';

    return {
      code,
      status,
      attempts: attemptSessions,
      successRate,
      avgCartDollars: avgCart,
      recoveries: recoverySessions.size,
      revPerSession,
      lastSeen,
      isLowData: attemptSessions < 10,
    };
  });

  // Sort by attempts DESC
  codes.sort((a, b) => b.attempts - a.attempts);

  const healthy = codes.filter((c) => c.status === 'healthy').length;
  const needsAttention = codes.filter(
    (c) => c.status === 'degraded' || c.status === 'broken'
  ).length;

  return NextResponse.json({
    summary: { active: codes.length, healthy, needsAttention },
    codes,
  });
}
