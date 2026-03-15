export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function subMs(date: Date, ms: number): Date {
  return new Date(date.getTime() - ms);
}

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const shopId = shop.id;

  const end = new Date(req.nextUrl.searchParams.get('end') ?? new Date().toISOString());
  const start = new Date(req.nextUrl.searchParams.get('start') ?? subMs(end, 24 * 3600 * 1000).toISOString());
  const rangeMs = end.getTime() - start.getTime();
  const prevEnd = start;
  const prevStart = subMs(start, rangeMs);

  // Helper: fetch distinct session counts for a period
  async function getKpiCounts(s: Date, e: Date) {
    const [allRes, couponRes, checkoutCartRes, productRes] = await Promise.all([
      supabase.from('CartEvent').select('sessionId').eq('shopId', shopId)
        .gte('occurredAt', s.toISOString()).lte('occurredAt', e.toISOString()).limit(20000),
      supabase.from('CartEvent').select('sessionId').eq('shopId', shopId)
        .gte('occurredAt', s.toISOString()).lte('occurredAt', e.toISOString())
        .in('eventType', ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered']).limit(5000),
      supabase.from('CartEvent').select('sessionId').eq('shopId', shopId)
        .gte('occurredAt', s.toISOString()).lte('occurredAt', e.toISOString())
        .eq('eventType', 'cart_checkout_clicked').limit(5000),
      supabase.from('CartEvent').select('sessionId').eq('shopId', shopId)
        .gte('occurredAt', s.toISOString()).lte('occurredAt', e.toISOString())
        .gt('cartValue', 0).limit(10000),
    ]);

    const allSessions = new Set((allRes.data ?? []).map((r) => r.sessionId));
    const couponSessions = new Set((couponRes.data ?? []).map((r) => r.sessionId));
    const checkoutSessions = new Set((checkoutCartRes.data ?? []).map((r) => r.sessionId));
    const productSessions = new Set((productRes.data ?? []).map((r) => r.sessionId));

    // Also count checkout completions via CheckoutEvent
    const sessionIds = Array.from(allSessions);
    const { data: checkoutEvs } = await supabase.from('CheckoutEvent')
      .select('sessionId, eventType').eq('shopId', shopId)
      .in('sessionId', sessionIds.slice(0, 500))
      .in('eventType', ['checkout_started', 'checkout_completed']);

    for (const ce of checkoutEvs ?? []) {
      if (ce.eventType === 'checkout_started' || ce.eventType === 'checkout_completed') {
        checkoutSessions.add(ce.sessionId);
      }
    }

    return {
      cartsOpened: allSessions.size,
      withProducts: productSessions.size,
      withCoupon: couponSessions.size,
      reachedCheckout: checkoutSessions.size,
    };
  }

  const [curr, prev, alertsRes] = await Promise.all([
    getKpiCounts(start, end),
    getKpiCounts(prevStart, prevEnd),
    supabase.from('AlertLog').select('id, title, body, severity, firedAt, isRead')
      .eq('shopId', shopId).order('firedAt', { ascending: false }).limit(3),
  ]);

  function pctDelta(curr: number, prev: number): number | null {
    if (prev === 0) return null;
    return Math.round(((curr - prev) / prev) * 100);
  }
  function ppDelta(curr: number, total: number, prevCurr: number, prevTotal: number): number | null {
    if (total === 0 || prevTotal === 0) return null;
    const currPct = (curr / total) * 100;
    const prevPct = (prevCurr / prevTotal) * 100;
    return Math.round((currPct - prevPct) * 10) / 10;
  }

  const withProductsPct = curr.cartsOpened > 0 ? Math.round((curr.withProducts / curr.cartsOpened) * 100) : 0;
  const prevWithProductsPct = prev.cartsOpened > 0 ? Math.round((prev.withProducts / prev.cartsOpened) * 100) : 0;
  const couponPct = curr.withProducts > 0 ? Math.round((curr.withCoupon / curr.withProducts) * 100) : 0;
  const prevCouponPct = prev.withProducts > 0 ? Math.round((prev.withCoupon / prev.withProducts) * 100) : 0;
  const checkoutPct = curr.withProducts > 0 ? Math.round((curr.reachedCheckout / curr.withProducts) * 100) : 0;
  const prevCheckoutPct = prev.withProducts > 0 ? Math.round((prev.reachedCheckout / prev.withProducts) * 100) : 0;

  return NextResponse.json({
    kpis: {
      cartsOpened: {
        value: curr.cartsOpened,
        withProducts: curr.withProducts,
        emptyOpens: curr.cartsOpened - curr.withProducts,
        delta: pctDelta(curr.cartsOpened, prev.cartsOpened),
      },
      withProducts: {
        value: curr.withProducts,
        pct: withProductsPct,
        prevPct: prevWithProductsPct,
        delta: ppDelta(curr.withProducts, curr.cartsOpened, prev.withProducts, prev.cartsOpened),
      },
      withCoupon: {
        value: curr.withCoupon,
        pct: couponPct,
        prevPct: prevCouponPct,
        delta: ppDelta(curr.withCoupon, curr.withProducts, prev.withCoupon, prev.withProducts),
      },
      reachedCheckout: {
        value: curr.reachedCheckout,
        pct: checkoutPct,
        prevPct: prevCheckoutPct,
        delta: ppDelta(curr.reachedCheckout, curr.withProducts, prev.reachedCheckout, prev.withProducts),
      },
    },
    recentAlerts: (alertsRes.data ?? []).map((a) => ({
      id: a.id,
      title: a.title,
      body: (a as Record<string, unknown>).body ?? null,
      severity: (a as Record<string, unknown>).severity ?? 'info',
      firedAt: a.firedAt,
      isRead: (a as Record<string, unknown>).isRead ?? false,
    })),
  });
}
