export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { buildSessionsFromEvents, deriveSourceV3 } from '@/lib/v3/session-builder';

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86400000);
}

const VALUE_BANDS = [
  { label: '$0–50',    min: 0,   max: 50   },
  { label: '$50–100',  min: 50,  max: 100  },
  { label: '$100–125', min: 100, max: 125  },
  { label: '$125–150', min: 125, max: 150  },
  { label: '$150–175', min: 150, max: 175  },
  { label: '$175–200', min: 175, max: 200  },
  { label: '$200+',    min: 200, max: Infinity },
];

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

  // Fetch events
  let cartQuery = supabase.from('CartEvent')
    .select('sessionId, eventType, cartValue, cartItemCount, lineItems, couponCode, couponSuccess, couponRecovered, discountAmount, device, country, occurredAt, utmSource, utmMedium, utmCampaign, cartToken')
    .eq('shopId', shop.id)
    .gte('occurredAt', start.toISOString())
    .lte('occurredAt', end.toISOString())
    .limit(20000);

  if (device) cartQuery = cartQuery.eq('device', device);
  if (country) cartQuery = cartQuery.ilike('country', country);

  const { data: cartEvents } = await cartQuery;
  if (!cartEvents || cartEvents.length === 0) {
    return NextResponse.json({ conversionBands: [], revenuePerCoupon: [], timeIntelligence: null, cartComposition: null });
  }

  const sessionIds = Array.from(new Set(cartEvents.map((e) => e.sessionId)));

  const { data: checkoutEvents } = await supabase.from('CheckoutEvent')
    .select('sessionId, eventType, totalPrice, occurredAt')
    .eq('shopId', shop.id)
    .in('sessionId', sessionIds.slice(0, 500))
    .order('occurredAt', { ascending: true })
    .limit(5000);

  const allSessions = buildSessionsFromEvents(
    cartEvents as Parameters<typeof buildSessionsFromEvents>[0],
    checkoutEvents ?? [],
  );

  // Apply source filter
  const sessions = source
    ? allSessions.filter((s) => deriveSourceV3(s.utmSource, s.utmMedium).toLowerCase() === source.toLowerCase())
    : allSessions;

  const completedCount = sessions.filter((s) => s.outcome === 'ordered').length;

  // ── Conversion by cart value bands ─────────────────────────────────────────
  const conversionBands = VALUE_BANDS.map((band) => {
    const inBand = sessions.filter((s) => {
      const v = s.cartValueEnd ?? s.cartValueStart ?? 0;
      return v >= band.min && v < band.max && v > 0;
    });
    const reachedCheckout = inBand.filter((s) => s.outcome === 'checkout' || s.outcome === 'ordered');
    const completed = inBand.filter((s) => s.outcome === 'ordered');
    const convRate = reachedCheckout.length > 0
      ? Math.round((completed.length / reachedCheckout.length) * 1000) / 10
      : 0;
    return {
      label: band.label,
      min: band.min,
      max: band.max === Infinity ? null : band.max,
      sessions: inBand.length,
      reachedCheckout: reachedCheckout.length,
      completed: completed.length,
      convRate,
      lowData: inBand.length < 10,
    };
  });

  // Overall avg conversion rate for reference line
  const totalReachedCheckout = sessions.filter((s) => s.outcome !== 'abandoned').length;
  const overallConvRate = totalReachedCheckout > 0
    ? Math.round((completedCount / totalReachedCheckout) * 1000) / 10
    : 0;

  // AOV from completed sessions
  const completedSessions = sessions.filter((s) => s.outcome === 'ordered');
  const aovValues = completedSessions.map((s) => s.cartValueEnd ?? s.cartValueStart ?? 0).filter((v) => v > 0);
  const aov = aovValues.length > 0 ? aovValues.reduce((a, b) => a + b, 0) / aovValues.length : 0;

  // ── Revenue per session by coupon code ─────────────────────────────────────
  // Baseline: sessions with no coupon
  const noCouponSessions = sessions.filter((s) => s.coupons.length === 0 && (s.cartValueEnd ?? 0) > 0);
  const noCouponCheckout = noCouponSessions.filter((s) => s.outcome !== 'abandoned').length;
  const noCouponCompleted = noCouponSessions.filter((s) => s.outcome === 'ordered').length;
  const noCouponConvRate = noCouponCheckout > 0 ? noCouponCompleted / noCouponCheckout : 0;
  const noCouponAvgCart = noCouponSessions.length > 0
    ? noCouponSessions.reduce((sum, s) => sum + (s.cartValueEnd ?? s.cartValueStart ?? 0), 0) / noCouponSessions.length
    : 0;
  const baselineRevPerSession = noCouponAvgCart * noCouponConvRate;

  // Per code
  const codeMap = new Map<string, { sessions: typeof sessions; discounts: number[] }>();
  for (const s of sessions) {
    for (const c of s.coupons) {
      if (!codeMap.has(c.code)) codeMap.set(c.code, { sessions: [], discounts: [] });
      codeMap.get(c.code)!.sessions.push(s);
      if (c.status === 'applied' && c.discountAmount != null) {
        codeMap.get(c.code)!.discounts.push(c.discountAmount / 100);
      }
    }
  }

  const revenuePerCoupon = [
    {
      code: 'No coupon (baseline)',
      sessions: noCouponSessions.length,
      convRate: Math.round(noCouponConvRate * 1000) / 10,
      avgCart: Math.round(noCouponAvgCart * 100) / 100,
      avgDiscount: 0,
      revPerSession: Math.round(baselineRevPerSession * 100) / 100,
      vsBaseline: 0,
      lowData: noCouponSessions.length < 10,
      isBaseline: true,
    },
    ...Array.from(codeMap.entries()).map(([code, { sessions: codeSessions, discounts }]) => {
      const codeCheckout = codeSessions.filter((s) => s.outcome !== 'abandoned').length;
      const codeCompleted = codeSessions.filter((s) => s.outcome === 'ordered').length;
      const codeConvRate = codeCheckout > 0 ? codeCompleted / codeCheckout : 0;
      const codeAvgCart = codeSessions.length > 0
        ? codeSessions.reduce((sum, s) => sum + (s.cartValueEnd ?? s.cartValueStart ?? 0), 0) / codeSessions.length
        : 0;
      const avgDiscount = discounts.length > 0 ? discounts.reduce((a, b) => a + b, 0) / discounts.length : 0;
      const revPerSession = (codeAvgCart - avgDiscount) * codeConvRate;
      return {
        code,
        sessions: codeSessions.length,
        convRate: Math.round(codeConvRate * 1000) / 10,
        avgCart: Math.round(codeAvgCart * 100) / 100,
        avgDiscount: Math.round(avgDiscount * 100) / 100,
        revPerSession: Math.round(revPerSession * 100) / 100,
        vsBaseline: Math.round((revPerSession - baselineRevPerSession) * 100) / 100,
        lowData: codeSessions.length < 10,
        isBaseline: false,
      };
    }).sort((a, b) => b.revPerSession - a.revPerSession),
  ];

  // ── Time Intelligence ───────────────────────────────────────────────────────
  // Card 1: Median consideration window (first item added → checkout click)
  const considerationTimes: number[] = [];
  for (const s of sessions) {
    if (s.outcome === 'abandoned') continue;
    const evs = cartEvents.filter((e) => e.sessionId === s.sessionId)
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    const firstItem = evs.find((e) => e.eventType === 'cart_item_added');
    const checkoutClick = evs.find((e) => e.eventType === 'cart_checkout_clicked');
    if (firstItem && checkoutClick) {
      const diff = new Date(checkoutClick.occurredAt).getTime() - new Date(firstItem.occurredAt).getTime();
      if (diff >= 0) considerationTimes.push(diff);
    }
  }

  // Card 2: Checkout load time (checkout_click → checkout_started)
  const loadTimes: number[] = [];
  const checkoutBySession = new Map<string, typeof checkoutEvents>();
  for (const e of checkoutEvents ?? []) {
    if (!checkoutBySession.has(e.sessionId)) checkoutBySession.set(e.sessionId, []);
    checkoutBySession.get(e.sessionId)!.push(e);
  }
  for (const s of sessions) {
    if (s.outcome === 'abandoned') continue;
    const evs = cartEvents.filter((e) => e.sessionId === s.sessionId);
    const checkoutClick = evs.find((e) => e.eventType === 'cart_checkout_clicked');
    const checkoutStarted = (checkoutBySession.get(s.sessionId) ?? []).find((e) => e.eventType === 'checkout_started');
    if (checkoutClick && checkoutStarted) {
      const diff = new Date(checkoutStarted.occurredAt).getTime() - new Date(checkoutClick.occurredAt).getTime();
      if (diff >= 0 && diff < 30000) loadTimes.push(diff); // cap at 30s to exclude page refreshes
    }
  }

  // Card 3: Return buyer rate (sessions sharing cartToken with an earlier session)
  const cartTokenMap = new Map<string, string[]>();
  for (const e of cartEvents) {
    if (!e.cartToken) continue;
    if (!cartTokenMap.has(e.cartToken)) cartTokenMap.set(e.cartToken, []);
    const sessionList = cartTokenMap.get(e.cartToken)!;
    if (!sessionList.includes(e.sessionId)) sessionList.push(e.sessionId);
  }
  const multiSessionTokens = Array.from(cartTokenMap.values()).filter((ids) => ids.length > 1);
  const returnBuyerSessions = new Set(multiSessionTokens.flat());
  const completedSessionIds = new Set(completedSessions.map((s) => s.sessionId));
  const returnBuyers = Array.from(returnBuyerSessions).filter((id) => completedSessionIds.has(id)).length;
  const returnBuyerRate = completedSessions.length > 0
    ? Math.round((returnBuyers / completedSessions.length) * 1000) / 10
    : 0;

  const considerationMedian = median(considerationTimes);
  const loadTimeMedian = median(loadTimes);

  // ── Cart Composition ────────────────────────────────────────────────────────
  const multiProductOrders = completedSessions.filter((s) => (s.cartItemCount ?? s.products.length) > 1).length;
  const singleProductOrders = completedSessions.filter((s) => (s.cartItemCount ?? s.products.length) === 1).length;
  const multiPct = completedSessions.length > 0 ? Math.round((multiProductOrders / completedSessions.length) * 100) : 0;
  const singlePct = completedSessions.length > 0 ? Math.round((singleProductOrders / completedSessions.length) * 100) : 0;

  // Product combinations in completed orders
  const comboCounts = new Map<string, { count: number; totalCart: number }>();
  for (const s of completedSessions) {
    if (s.products.length < 2) continue;
    const titles = s.products.map((p) => p.productTitle ?? 'Unknown').sort();
    const key = titles.join(' + ');
    if (!comboCounts.has(key)) comboCounts.set(key, { count: 0, totalCart: 0 });
    const entry = comboCounts.get(key)!;
    entry.count++;
    entry.totalCart += s.cartValueEnd ?? s.cartValueStart ?? 0;
  }
  const topCombinations = Array.from(comboCounts.entries())
    .filter(([, v]) => v.count >= 5)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5)
    .map(([label, { count, totalCart }]) => ({
      label,
      count,
      avgCart: Math.round((totalCart / count) * 100) / 100,
    }));

  return NextResponse.json({
    completedOrders: completedCount,
    conversionBands,
    overallConvRate,
    aov: Math.round(aov * 100) / 100,
    revenuePerCoupon,
    timeIntelligence: {
      considerationMedianMs: considerationMedian,
      loadTimeMedianMs: loadTimeMedian,
      returnBuyerRate,
    },
    cartComposition: {
      multiProductPct: multiPct,
      singleProductPct: singlePct,
      totalCompleted: completedSessions.length,
      topCombinations,
    },
  });
}
