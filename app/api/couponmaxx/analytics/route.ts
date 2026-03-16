export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }
function dateStr(d: Date) { return d.toISOString().slice(0, 10); }

function buildDailyMap(start: Date, end: Date): Map<string, { applied: number; attempted: number; sessions: Set<string>; couponSessions: Set<string>; checkoutSessions: Set<string>; totalSessions: Set<string> }> {
  const map = new Map();
  let cur = new Date(start);
  while (cur <= end) {
    map.set(dateStr(cur), { applied: 0, attempted: 0, sessions: new Set(), couponSessions: new Set(), checkoutSessions: new Set(), totalSessions: new Set() });
    cur = subDays(cur, -1);
  }
  return map;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const shopDomain = p.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase.from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const shopId = shop.id;

  const end = new Date(p.get('end') ?? new Date().toISOString());
  const start = new Date(p.get('start') ?? subDays(end, 30).toISOString());
  const rangeMs = end.getTime() - start.getTime();
  const prevEnd = start;
  const prevStart = subDays(start, Math.round(rangeMs / 86400000));

  const device = p.get('device') ?? '';
  const utmSource = p.get('utmSource') ?? '';
  const product = p.get('product') ?? '';

  // Attribution window + pre/post
  const attrWindow = parseInt(p.get('attrWindow') ?? '14');
  const priceType = p.get('priceType') ?? 'pre'; // pre | post

  // Fetch all cart events in range
  let cartQ = supabase.from('CartEvent')
    .select('sessionId, eventType, cartValue, cartItemCount, couponCode, couponSuccess, couponRecovered, lineItems, occurredAt, device')
    .eq('shopId', shopId).gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString()).limit(100000).order('occurredAt', { ascending: false });
  if (device) cartQ = cartQ.eq('device', device);

  const { data: cartEvs } = await cartQ;
  const evs = cartEvs ?? [];

  // UTM filter: get sessions matching utmSource via SessionPing
  let allowedSessions: Set<string> | null = null;
  if (utmSource) {
    const pingQ = supabase.from('SessionPing').select('sessionId').eq('shopId', shopId)
      .gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString());
    let filteredPings;
    if (utmSource === 'Direct') {
      const { data } = await pingQ.or('utmSource.is.null,utmSource.eq.');
      filteredPings = data;
    } else if (utmSource === 'Paid search') {
      const { data } = await pingQ.in('utmSource', ['google', 'bing']);
      filteredPings = data;
    } else if (utmSource === 'Social') {
      const { data } = await pingQ.in('utmSource', ['instagram', 'facebook', 'fb', 'tiktok']);
      filteredPings = data;
    } else if (utmSource === 'Email') {
      const { data } = await pingQ.in('utmSource', ['klaviyo', 'mailchimp', 'email']);
      filteredPings = data;
    } else {
      const { data } = await pingQ.eq('utmSource', utmSource);
      filteredPings = data;
    }
    allowedSessions = new Set((filteredPings ?? []).map((r: { sessionId: string }) => r.sessionId));
  }

  // Product filter: sessions containing product in lineItems
  let productSessions: Set<string> | null = null;
  if (product) {
    productSessions = new Set(
      evs.filter((e) => {
        const li = e.lineItems as Array<{ productTitle?: string }> | null;
        return Array.isArray(li) && li.some((item) => item.productTitle === product);
      }).map((e) => e.sessionId)
    );
  }

  function isAllowed(sessionId: string) {
    if (allowedSessions && !allowedSessions.has(sessionId)) return false;
    if (productSessions && !productSessions.has(sessionId)) return false;
    return true;
  }

  // Build daily maps
  const daily = buildDailyMap(start, end);

  for (const e of evs) {
    if (!isAllowed(e.sessionId)) continue;
    const day = dateStr(new Date(e.occurredAt));
    const bucket = daily.get(day);
    if (!bucket) continue;

    bucket.totalSessions.add(e.sessionId);
    if ((e.cartValue ?? 0) > 0 || (e.cartItemCount ?? 0) > 0) bucket.sessions.add(e.sessionId);

    if (['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'].includes(e.eventType)) {
      bucket.couponSessions.add(e.sessionId);
      bucket.attempted++;
    }
    if (e.eventType === 'cart_coupon_applied' || e.couponRecovered) bucket.applied++;
    if (['cart_checkout_clicked'].includes(e.eventType)) bucket.checkoutSessions.add(e.sessionId);
  }

  // Also count checkout events
  const allSessionIds = Array.from(new Set(evs.filter((e) => isAllowed(e.sessionId)).map((e) => e.sessionId)));
  const { data: checkoutEvs } = await supabase.from('CheckoutEvent')
    .select('sessionId, eventType, totalPrice, occurredAt').eq('shopId', shopId)
    .in('sessionId', allSessionIds.slice(0, 500)).limit(5000);

  for (const ce of checkoutEvs ?? []) {
    if (!isAllowed(ce.sessionId)) continue;
    if (ce.eventType === 'checkout_started' || ce.eventType === 'checkout_completed') {
      const day = dateStr(new Date(ce.occurredAt));
      daily.get(day)?.checkoutSessions.add(ce.sessionId);
    }
  }

  // Build response arrays
  const successRateDaily: { date: string; value: number }[] = [];
  const cartsWithCouponDaily: { date: string; value: number }[] = [];
  const cartViewsDaily: { date: string; value: number }[] = [];
  const withProductsDaily: { date: string; value: number }[] = [];
  const checkoutsDaily: { date: string; value: number }[] = [];
  const funnelDaily: { date: string; cartViews: number; cartsWithProducts: number; couponsAttempted: number; couponsApplied: number; couponsFailed: number; reachedCheckout: number }[] = [];

  let totalApplied = 0, totalAttempted = 0;

  for (const [date, b] of Array.from(daily.entries()).sort()) {
    const rate = b.attempted > 0 ? Math.round((b.applied / b.attempted) * 1000) / 10 : 0;
    const couponPct = b.sessions.size > 0 ? Math.round((b.couponSessions.size / b.sessions.size) * 1000) / 10 : 0;
    totalApplied += b.applied;
    totalAttempted += b.attempted;

    successRateDaily.push({ date, value: rate });
    cartsWithCouponDaily.push({ date, value: couponPct });
    cartViewsDaily.push({ date, value: b.totalSessions.size });
    withProductsDaily.push({ date, value: b.sessions.size });
    checkoutsDaily.push({ date, value: b.checkoutSessions.size });
    funnelDaily.push({
      date,
      cartViews: b.totalSessions.size,
      cartsWithProducts: b.sessions.size,
      couponsAttempted: b.couponSessions.size,
      couponsApplied: b.applied,
      couponsFailed: b.attempted - b.applied,
      reachedCheckout: b.checkoutSessions.size,
    });
  }

  const avgSuccessRate = totalAttempted > 0 ? Math.round((totalApplied / totalAttempted) * 1000) / 10 : 0;

  const totalCartViews = new Set(evs.filter((e) => isAllowed(e.sessionId)).map((e) => e.sessionId)).size;
  const totalWithProducts = new Set(evs.filter((e) => isAllowed(e.sessionId) && ((e.cartValue ?? 0) > 0 || (e.cartItemCount ?? 0) > 0)).map((e) => e.sessionId)).size;
  const totalWithCoupon = new Set(evs.filter((e) => isAllowed(e.sessionId) && ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'].includes(e.eventType)).map((e) => e.sessionId)).size;
  const totalCheckouts = new Set([
    ...evs.filter((e) => isAllowed(e.sessionId) && e.eventType === 'cart_checkout_clicked').map((e) => e.sessionId),
    ...(checkoutEvs ?? []).filter((e) => isAllowed(e.sessionId)).map((e) => e.sessionId),
  ]).size;

  const avgCartsWithCoupon = totalWithProducts > 0 ? Math.round((totalWithCoupon / totalWithProducts) * 1000) / 10 : 0;

  // Attributed sales: sessions with coupon + checkout_completed within window
  const couponSessionIds = new Set(evs.filter((e) => isAllowed(e.sessionId) && ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'].includes(e.eventType)).map((e) => e.sessionId));
  const completedEvs = (checkoutEvs ?? []).filter((e) => e.eventType === 'checkout_completed');
  const firstCartTime = new Map<string, number>();
  for (const e of evs) {
    if (!firstCartTime.has(e.sessionId)) firstCartTime.set(e.sessionId, new Date(e.occurredAt).getTime());
  }
  const lastCartValue = new Map<string, number>();
  for (const e of evs) {
    if ((e.cartValue ?? 0) > 0) lastCartValue.set(e.sessionId, e.cartValue!);
  }

  let attrTotal = 0;
  const attrByDay = new Map<string, number>();
  for (const ce of completedEvs) {
    if (!couponSessionIds.has(ce.sessionId)) continue;
    const first = firstCartTime.get(ce.sessionId);
    if (!first) continue;
    const diff = (new Date(ce.occurredAt).getTime() - first) / 86400000;
    if (diff > attrWindow) continue;
    const val = priceType === 'post' ? (ce.totalPrice ?? 0) : (lastCartValue.get(ce.sessionId) ?? 0) / 100;
    attrTotal += val;
    const day = dateStr(new Date(ce.occurredAt));
    attrByDay.set(day, (attrByDay.get(day) ?? 0) + val);
  }

  const attrDaily = Array.from(daily.keys()).sort().map((date) => ({ date, value: Math.round((attrByDay.get(date) ?? 0) * 100) / 100 }));

  // Funnel totals
  const couponApplied = evs.filter((e) => isAllowed(e.sessionId) && (e.eventType === 'cart_coupon_applied' || e.couponRecovered)).length;
  const couponFailed = evs.filter((e) => isAllowed(e.sessionId) && e.eventType === 'cart_coupon_failed' && !e.couponRecovered).length;

  // Previous period for compare
  const prevData: Record<string, { applied: number; attempted: number; couponPct: number; cartViews: number }> = {};
  if (p.get('compareTo')) {
    const { data: prevEvs } = await supabase.from('CartEvent')
      .select('sessionId, eventType, cartValue, cartItemCount, occurredAt')
      .eq('shopId', shopId).gte('occurredAt', prevStart.toISOString()).lte('occurredAt', prevEnd.toISOString()).limit(20000);
    // Simplified — just return daily arrays shifted to current dates
    (prevEvs ?? []).forEach((e) => {
      const offset = new Date(e.occurredAt).getTime() - prevStart.getTime();
      const mappedDate = dateStr(new Date(start.getTime() + offset));
      if (!prevData[mappedDate]) prevData[mappedDate] = { applied: 0, attempted: 0, couponPct: 0, cartViews: 0 };
      prevData[mappedDate].cartViews++;
      if (['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered'].includes(e.eventType)) {
        prevData[mappedDate].attempted++;
        if (e.eventType === 'cart_coupon_applied') prevData[mappedDate].applied++;
      }
    });
  }

  const successRateComparison = p.get('compareTo')
    ? Array.from(daily.keys()).sort().map((date) => {
      const d = prevData[date];
      return { date, value: d && d.attempted > 0 ? Math.round((d.applied / d.attempted) * 1000) / 10 : 0 };
    })
    : undefined;

  return NextResponse.json({
    couponSuccessRate: {
      average: avgSuccessRate,
      daily: successRateDaily,
      comparison: successRateComparison,
    },
    cartsWithCoupon: {
      average: avgCartsWithCoupon,
      daily: cartsWithCouponDaily,
    },
    attributedSales: {
      total: Math.round(attrTotal * 100) / 100,
      daily: attrDaily,
    },
    cartViews: {
      total: { total: totalCartViews, daily: cartViewsDaily },
      withProducts: { total: totalWithProducts, daily: withProductsDaily },
      checkouts: { total: totalCheckouts, daily: checkoutsDaily },
    },
    funnel: {
      cartViews: totalCartViews,
      cartsWithProducts: totalWithProducts,
      couponsAttempted: totalWithCoupon,
      couponsApplied: couponApplied,
      couponsFailed: couponFailed,
      reachedCheckout: totalCheckouts,
      daily: funnelDaily,
    },
  });
}
