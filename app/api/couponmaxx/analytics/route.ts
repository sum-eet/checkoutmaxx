export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getShopFromRequest } from "@/lib/verify-session-token";

function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }
function dateStr(d: Date | string) { return new Date(d).toISOString().slice(0, 10); }

// Build a zero-filled daily map covering every UTC calendar day start→end.
function buildDailyMap(start: Date, end: Date) {
  const map = new Map<string, { applied: number; attempted: number; failedSessions: number; totalSessions: number; sessionsWithProducts: number; sessionsWithCoupon: number; checkoutClicked: number; checkoutSessions: number }>();
  let cur = new Date(dateStr(start) + 'T00:00:00.000Z');
  const endCur = new Date(dateStr(end) + 'T00:00:00.000Z');
  while (cur <= endCur) {
    map.set(dateStr(cur), { applied: 0, attempted: 0, failedSessions: 0, totalSessions: 0, sessionsWithProducts: 0, sessionsWithCoupon: 0, checkoutClicked: 0, checkoutSessions: 0 });
    cur = new Date(cur.getTime() + 86400000);
  }
  return map;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const shopDomain = getShopFromRequest(req);
  console.log('[analytics] GET shop=%s start=%s end=%s', shopDomain, p.get('start'), p.get('end'));
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop, error: shopErr } = await supabase.from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  console.log('[analytics] shop lookup:', JSON.stringify(shop), 'err:', shopErr?.message);
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const shopId = shop.id;

  const rawEnd = new Date(p.get('end') ?? new Date().toISOString());
  const rawStart = new Date(p.get('start') ?? subDays(rawEnd, 7).toISOString());

  // Normalise to full UTC calendar days so no events are lost due to timezone offset.
  const start = new Date(dateStr(rawStart) + 'T00:00:00.000Z');
  const end   = new Date(dateStr(rawEnd)   + 'T23:59:59.999Z');

  const rangeMs  = end.getTime() - start.getTime();

  const device    = p.get('device')    ?? '';
  const utmSource = p.get('utmSource') ?? '';
  const product   = p.get('product')   ?? '';
  const attrWindow = parseInt(p.get('attrWindow') ?? '14');
  const priceType  = p.get('priceType') ?? 'pre';

  // UTM filter: get allowed session IDs via SessionPing (uses shopDomain, not shopId)
  let sessionFilter: string[] | null = null;
  if (utmSource) {
    const { data: utmRows } = await supabase.rpc('couponmaxx_utm_sessions', {
      p_shop_domain: shopDomain,
      p_start:       start.toISOString(),
      p_end:         end.toISOString(),
      p_utm_source:  utmSource,
    });
    sessionFilter = (utmRows ?? []).map((r: { session_id: string }) => r.session_id);
  }

  // Product filter: scan lineItems via the session summaries (only if needed)
  // For now product filter is handled client-side from session data; skip for analytics aggregate.
  // TODO: add product filter SQL function if needed.

  const rpcArgs = {
    p_shop_id:     shopId,
    p_start:       start.toISOString(),
    p_end:         end.toISOString(),
    p_device:      device || null,
    p_session_ids: sessionFilter,
  };

  // Fire all aggregation RPCs in parallel — each returns ~8 rows max
  const [cartMetricsRes, checkoutRes, attrSalesRes, funnelRes] = await Promise.all([
    supabase.rpc('couponmaxx_daily_cart_metrics',      rpcArgs),
    supabase.rpc('couponmaxx_daily_checkout_sessions', { p_shop_id: shopId, p_start: start.toISOString(), p_end: end.toISOString() }),
    supabase.rpc('couponmaxx_attributed_sales_daily',  { p_shop_id: shopId, p_start: start.toISOString(), p_end: end.toISOString(), p_attr_window_days: attrWindow, p_price_type: priceType, p_session_ids: sessionFilter }),
    supabase.rpc('couponmaxx_funnel_totals',           rpcArgs),
  ]);

  type DailyCartRow = { day: string; total_sessions: number; sessions_with_products: number; sessions_with_coupon: number; sessions_coupon_applied: number; sessions_coupon_attempted: number; sessions_coupon_failed: number; checkout_clicked_sessions: number };
  type CheckoutRow  = { day: string; checkout_sessions: number };
  type AttrRow      = { day: string; attributed_value: number; attributed_total: number };
  type FunnelRow    = { total_sessions: number; sessions_with_products: number; sessions_with_coupon: number; coupon_applied: number; coupon_failed: number; reached_checkout: number };

  const cartRows: DailyCartRow[]  = cartMetricsRes.data  ?? [];
  const ckRows:   CheckoutRow[]   = checkoutRes.data      ?? [];
  const attrRows: AttrRow[]       = attrSalesRes.data     ?? [];
  const funnel:   FunnelRow       = (funnelRes.data?.[0]) ?? { total_sessions: 0, sessions_with_products: 0, sessions_with_coupon: 0, coupon_applied: 0, coupon_failed: 0, reached_checkout: 0 };
  console.log('[analytics] shopId=%s cartRows=%d ckRows=%d attrRows=%d funnelTotal=%d', shopId, cartRows.length, ckRows.length, attrRows.length, funnel.total_sessions);
  console.log('[analytics] RPC errors: cartMetrics=%s checkout=%s attrSales=%s funnel=%s', cartMetricsRes.error?.message, checkoutRes.error?.message, attrSalesRes.error?.message, funnelRes.error?.message);

  // Index checkout + attributed sales by day for O(1) lookup
  const ckByDay   = new Map(ckRows.map((r) => [r.day, r.checkout_sessions]));
  const attrByDay = new Map(attrRows.map((r) => [r.day, r.attributed_value]));
  const attrTotal = attrRows.reduce((s, r) => s + (r.attributed_value ?? 0), 0);

  // Build zero-filled daily map — fills gaps for days with no events
  const daily = buildDailyMap(start, end);
  for (const r of cartRows) {
    const key = dateStr(r.day);
    const b = daily.get(key);
    if (!b) continue;
    b.totalSessions       = r.total_sessions;
    b.sessionsWithProducts = r.sessions_with_products;
    b.sessionsWithCoupon  = r.sessions_with_coupon;
    b.applied             = r.sessions_coupon_applied;
    b.attempted           = r.sessions_coupon_attempted;
    b.failedSessions      = r.sessions_coupon_failed;
    b.checkoutClicked     = r.checkout_clicked_sessions;
  }
  for (const [key, b] of Array.from(daily)) {
    b.checkoutSessions = Math.max(b.checkoutClicked, ckByDay.get(key) ?? 0);
  }

  // Build response arrays
  const successRateDaily:     { date: string; value: number }[] = [];
  const cartsWithCouponDaily: { date: string; value: number }[] = [];
  const cartViewsDaily:       { date: string; value: number }[] = [];
  const withProductsDaily:    { date: string; value: number }[] = [];
  const checkoutsDaily:       { date: string; value: number }[] = [];
  const attrSalesDaily:       { date: string; value: number }[] = [];
  const funnelDaily: { date: string; cartViews: number; cartsWithProducts: number; couponsAttempted: number; couponsApplied: number; couponsFailed: number; reachedCheckout: number }[] = [];

  let totalApplied = 0, totalAttempted = 0;

  for (const [date, b] of Array.from(daily.entries()).sort()) {
    const rate       = b.attempted > 0 ? Math.round((b.applied / b.attempted) * 1000) / 10 : 0;
    const couponPct  = b.sessionsWithProducts > 0 ? Math.round((b.sessionsWithCoupon / b.sessionsWithProducts) * 1000) / 10 : 0;
    totalApplied    += b.applied;
    totalAttempted  += b.attempted;

    successRateDaily.push({     date, value: rate });
    cartsWithCouponDaily.push({ date, value: couponPct });
    cartViewsDaily.push({       date, value: b.totalSessions });
    withProductsDaily.push({    date, value: b.sessionsWithProducts });
    checkoutsDaily.push({       date, value: b.checkoutSessions });
    attrSalesDaily.push({       date, value: Math.round((attrByDay.get(date) ?? 0) * 100) / 100 });
    funnelDaily.push({
      date,
      cartViews:        b.totalSessions,
      cartsWithProducts: b.sessionsWithProducts,
      couponsAttempted: b.sessionsWithCoupon,
      couponsApplied:   b.applied,
      couponsFailed:    b.failedSessions,
      reachedCheckout:  b.checkoutSessions,
    });
  }

  const totalCartViews    = cartRows.reduce((s, r) => s + r.total_sessions, 0);
  const totalWithProducts = cartRows.reduce((s, r) => s + r.sessions_with_products, 0);
  const totalWithCoupon   = cartRows.reduce((s, r) => s + r.sessions_with_coupon, 0);
  const totalCheckouts    = Array.from(daily.values()).reduce((s, b) => s + b.checkoutSessions, 0);

  const avgSuccessRate     = totalAttempted > 0 ? Math.round((totalApplied / totalAttempted) * 1000) / 10 : 0;
  const avgCartsWithCoupon = totalWithProducts > 0 ? Math.round((totalWithCoupon / totalWithProducts) * 1000) / 10 : 0;

  // ---- Compare-to period ----
  const compareMode = p.get('compareTo') ?? '';
  let successRateComparison: { date: string; value: number }[] | undefined;
  let cartsWithCouponComparison: { date: string; value: number }[] | undefined;
  let attrSalesComparison: { date: string; value: number }[] | undefined;
  let cartViewsTotalComparison: { date: string; value: number }[] | undefined;
  let cartViewsWithProductsComparison: { date: string; value: number }[] | undefined;
  let cartViewsCheckoutsComparison: { date: string; value: number }[] | undefined;

  if (compareMode) {
    let cmpStart: Date;
    let cmpEnd: Date;
    if (compareMode === 'previous_year') {
      cmpStart = new Date(start);
      cmpStart.setFullYear(cmpStart.getFullYear() - 1);
      cmpEnd = new Date(end);
      cmpEnd.setFullYear(cmpEnd.getFullYear() - 1);
    } else {
      // previous_period (default)
      cmpEnd = new Date(start.getTime() - 1);
      cmpStart = new Date(cmpEnd.getTime() - rangeMs);
    }

    const [prevCartRes, prevCheckoutRes, prevAttrRes] = await Promise.all([
      supabase.rpc('couponmaxx_daily_cart_metrics', {
        p_shop_id: shopId,
        p_start: cmpStart.toISOString(),
        p_end: cmpEnd.toISOString(),
        p_device: device || null,
        p_session_ids: null,
      }),
      supabase.rpc('couponmaxx_daily_checkout_sessions', {
        p_shop_id: shopId,
        p_start: cmpStart.toISOString(),
        p_end: cmpEnd.toISOString(),
      }),
      supabase.rpc('couponmaxx_attributed_sales_daily', {
        p_shop_id: shopId,
        p_start: cmpStart.toISOString(),
        p_end: cmpEnd.toISOString(),
        p_attr_window_days: attrWindow,
        p_price_type: priceType,
        p_session_ids: null,
      }),
    ]);

    const prevCartRows = (prevCartRes.data ?? []) as DailyCartRow[];
    const prevCkRows = (prevCheckoutRes.data ?? []) as CheckoutRow[];
    const prevAttrRows = (prevAttrRes.data ?? []) as AttrRow[];

    const prevCartByOffset = new Map<number, DailyCartRow>();
    for (const r of prevCartRows) {
      const offset = Math.round((new Date(r.day).getTime() - cmpStart.getTime()) / 86400000);
      prevCartByOffset.set(offset, r);
    }
    const prevCkByOffset = new Map<number, number>();
    for (const r of prevCkRows) {
      const offset = Math.round((new Date(r.day).getTime() - cmpStart.getTime()) / 86400000);
      prevCkByOffset.set(offset, r.checkout_sessions);
    }
    const prevAttrByOffset = new Map<number, number>();
    for (const r of prevAttrRows) {
      const offset = Math.round((new Date(r.day).getTime() - cmpStart.getTime()) / 86400000);
      prevAttrByOffset.set(offset, r.attributed_value);
    }

    const sortedDates = Array.from(daily.keys()).sort();
    successRateComparison = sortedDates.map((date, i) => {
      const prev = prevCartByOffset.get(i);
      const rate = prev && prev.sessions_coupon_attempted > 0
        ? Math.round((prev.sessions_coupon_applied / prev.sessions_coupon_attempted) * 1000) / 10
        : 0;
      return { date, value: rate };
    });
    cartsWithCouponComparison = sortedDates.map((date, i) => {
      const prev = prevCartByOffset.get(i);
      const pct = prev && prev.sessions_with_products > 0
        ? Math.round((prev.sessions_with_coupon / prev.sessions_with_products) * 1000) / 10
        : 0;
      return { date, value: pct };
    });
    attrSalesComparison = sortedDates.map((date, i) => {
      return { date, value: Math.round((prevAttrByOffset.get(i) ?? 0) * 100) / 100 };
    });
    cartViewsTotalComparison = sortedDates.map((date, i) => {
      return { date, value: prevCartByOffset.get(i)?.total_sessions ?? 0 };
    });
    cartViewsWithProductsComparison = sortedDates.map((date, i) => {
      return { date, value: prevCartByOffset.get(i)?.sessions_with_products ?? 0 };
    });
    cartViewsCheckoutsComparison = sortedDates.map((date, i) => {
      const cartClicked = prevCartByOffset.get(i)?.checkout_clicked_sessions ?? 0;
      const ckSessions = prevCkByOffset.get(i) ?? 0;
      return { date, value: Math.max(cartClicked, ckSessions) };
    });
  }

  // Revenue at risk: cart value of sessions where coupon failed + outcome = abandoned
  const { data: riskSessions } = await supabase
    .from('CartEvent')
    .select('sessionId, cartValue')
    .eq('shopId', shopId)
    .eq('eventType', 'cart_coupon_failed')
    .gte('occurredAt', start.toISOString())
    .lte('occurredAt', end.toISOString());

  // Deduplicate by sessionId, take max cartValue per session
  const riskBySession = new Map<string, number>();
  for (const row of (riskSessions ?? [])) {
    const current = riskBySession.get(row.sessionId) ?? 0;
    riskBySession.set(row.sessionId, Math.max(current, row.cartValue ?? 0));
  }

  // Filter to only sessions that were abandoned (no checkout event)
  const { data: checkoutSessions } = await supabase
    .from('CartEvent')
    .select('sessionId')
    .eq('shopId', shopId)
    .eq('eventType', 'cart_checkout_clicked')
    .gte('occurredAt', start.toISOString())
    .lte('occurredAt', end.toISOString());

  const checkoutSet = new Set((checkoutSessions ?? []).map((r: { sessionId: string }) => r.sessionId));

  let revenueAtRiskTotal = 0;
  let riskSessionCount = 0;
  for (const [sid, value] of Array.from(riskBySession)) {
    if (!checkoutSet.has(sid)) {
      revenueAtRiskTotal += value;
      riskSessionCount++;
    }
  }
  revenueAtRiskTotal = Math.round(revenueAtRiskTotal) / 100; // cents to dollars

  const revenueAtRisk = {
    total: revenueAtRiskTotal,
    sessions: riskSessionCount,
    avgCart: riskSessionCount > 0 ? Math.round(revenueAtRiskTotal / riskSessionCount * 100) / 100 : 0,
  };

  return NextResponse.json({
    couponSuccessRate: {
      average: avgSuccessRate,
      daily: successRateDaily,
      comparison: successRateComparison,
    },
    cartsWithCoupon: {
      average: avgCartsWithCoupon,
      daily: cartsWithCouponDaily,
      comparison: cartsWithCouponComparison,
    },
    attributedSales: {
      total:  Math.round(attrTotal * 100) / 100,
      daily:  attrSalesDaily,
      comparison: attrSalesComparison,
    },
    cartViews: {
      total:        { total: totalCartViews,    daily: cartViewsDaily },
      withProducts: { total: totalWithProducts, daily: withProductsDaily },
      checkouts:    { total: totalCheckouts,    daily: checkoutsDaily },
      comparison: compareMode ? {
        total:        { daily: cartViewsTotalComparison ?? [] },
        withProducts: { daily: cartViewsWithProductsComparison ?? [] },
        checkouts:    { daily: cartViewsCheckoutsComparison ?? [] },
      } : undefined,
    },
    funnel: {
      cartViews:          funnel.total_sessions,
      cartsWithProducts:  funnel.sessions_with_products,
      couponsAttempted:   funnel.sessions_with_coupon,
      couponsApplied:     funnel.coupon_applied,
      couponsFailed:      funnel.coupon_failed,
      reachedCheckout:    funnel.reached_checkout,
      daily:              funnelDaily,
    },
    revenueAtRisk,
  });
}
