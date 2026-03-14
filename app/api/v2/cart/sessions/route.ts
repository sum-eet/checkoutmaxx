export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  buildSessionSummary,
  buildOutcome,
  type CartSessionV2,
  type CouponSummary,
  type LineItem,
} from '@/lib/v2/session-summary';

function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

const PER_PAGE = 25;

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
  const start = new Date(req.nextUrl.searchParams.get('start') ?? subDays(end, 7).toISOString());
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10));

  const outcome = req.nextUrl.searchParams.get('outcome') ?? 'all'; // all | ordered | checkout | abandoned
  const country = req.nextUrl.searchParams.get('country') ?? '';
  const device = req.nextUrl.searchParams.get('device') ?? '';
  const minCart = req.nextUrl.searchParams.get('minCart'); // dollars
  const maxCart = req.nextUrl.searchParams.get('maxCart'); // dollars
  const hasCoupon = req.nextUrl.searchParams.get('hasCoupon') ?? ''; // any | failed | recovered | no
  const product = req.nextUrl.searchParams.get('product') ?? '';

  // Fetch all cart events for the period
  let cartQuery = supabase
    .from('CartEvent')
    .select('sessionId, eventType, cartValue, cartItemCount, lineItems, couponCode, couponSuccess, couponRecovered, discountAmount, device, country, occurredAt, pageUrl')
    .eq('shopId', shop.id)
    .gte('occurredAt', start.toISOString())
    .lte('occurredAt', end.toISOString())
    .order('occurredAt', { ascending: true })
    .limit(10000);

  if (country) cartQuery = cartQuery.eq('country', country);
  if (device) cartQuery = cartQuery.eq('device', device);

  const { data: cartEvents } = await cartQuery;
  if (!cartEvents || cartEvents.length === 0) {
    return NextResponse.json({
      sessions: [],
      total: 0,
      page,
      perPage: PER_PAGE,
      scopedCounts: { total: 0, checkoutRate: 0, completionRate: 0 },
    });
  }

  // Group by session
  const bySession = new Map<string, typeof cartEvents>();
  for (const e of cartEvents) {
    if (!bySession.has(e.sessionId)) bySession.set(e.sessionId, []);
    bySession.get(e.sessionId)!.push(e);
  }

  const sessionIds = Array.from(bySession.keys());

  // Fetch checkout events for these sessions
  const { data: checkoutEvents } = await supabase
    .from('CheckoutEvent')
    .select('sessionId, eventType, totalPrice, occurredAt')
    .eq('shopId', shop.id)
    .in('sessionId', sessionIds.slice(0, 500)) // Supabase IN limit
    .order('occurredAt', { ascending: true })
    .limit(5000);

  const checkoutBySession = new Map<string, typeof checkoutEvents>();
  for (const e of checkoutEvents ?? []) {
    if (!checkoutBySession.has(e.sessionId)) checkoutBySession.set(e.sessionId, []);
    checkoutBySession.get(e.sessionId)!.push(e);
  }

  // Build sessions
  const sessions: CartSessionV2[] = [];

  for (const [sessionId, events] of Array.from(bySession)) {
    events.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    const checkEvs = checkoutBySession.get(sessionId) ?? [];

    // Products from last event with lineItems
    let products: LineItem[] = [];
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].lineItems && Array.isArray(events[i].lineItems) && (events[i].lineItems as any[]).length > 0) {
        products = events[i].lineItems as LineItem[];
        break;
      }
    }

    // Cart values
    let cartValueStart: number | null = null;
    let cartValueEnd: number | null = null;
    for (const e of events) {
      if ((e.cartValue ?? 0) > 0) {
        if (cartValueStart === null) cartValueStart = (e.cartValue ?? 0) / 100;
        cartValueEnd = (e.cartValue ?? 0) / 100;
      }
    }

    // Coupons
    const couponMap = new Map<string, CouponSummary>();
    for (const e of events) {
      if (!e.couponCode) continue;
      const code = e.couponCode.toUpperCase();
      if (e.couponRecovered) {
        couponMap.set(code, { code, status: 'recovered' });
      } else if (e.couponSuccess === true) {
        if (!couponMap.has(code) || couponMap.get(code)!.status === 'failed') {
          couponMap.set(code, { code, status: 'applied' });
        }
      } else if (e.couponSuccess === false && !couponMap.has(code)) {
        couponMap.set(code, { code, status: 'failed' });
      }
    }
    const coupons = Array.from(couponMap.values());

    // Outcome
    const hasCompleted = checkEvs.some((e) => e.eventType === 'checkout_completed');
    const hasCheckout =
      events.some((e) => e.eventType === 'cart_checkout_clicked') ||
      checkEvs.some((e) => e.eventType === 'checkout_started');
    const hasProducts =
      events.some((e) => (e.cartValue ?? 0) > 0 || (e.cartItemCount ?? 0) > 0);
    const outcomeVal = buildOutcome(hasCompleted, hasCheckout, hasProducts);

    // Duration
    const firstAt = new Date(events[0].occurredAt).getTime();
    const lastCartAt = new Date(events[events.length - 1].occurredAt).getTime();
    const lastCheckoutAt =
      checkEvs.length > 0
        ? new Date(checkEvs[checkEvs.length - 1].occurredAt).getTime()
        : 0;
    const lastAt = Math.max(lastCartAt, lastCheckoutAt);
    const duration = lastAt - firstAt;

    // Country/device from first event that has them
    const country_ =
      events.find((e) => e.country)?.country ?? null;
    const device_ =
      events.find((e) => e.device)?.device ?? null;

    const sess: CartSessionV2 = {
      sessionId,
      startTime: events[0].occurredAt,
      duration,
      country: country_,
      device: device_,
      products,
      cartValueStart,
      cartValueEnd,
      coupons,
      outcome: outcomeVal,
      summary: '',
    };
    sess.summary = buildSessionSummary(sess);

    sessions.push(sess);
  }

  // Apply filters
  let filtered = sessions.filter((s) => {
    // Outcome filter
    if (outcome !== 'all' && s.outcome !== outcome) return false;

    // Cart value filter (in dollars)
    const cartVal = s.cartValueEnd ?? s.cartValueStart ?? 0;
    if (minCart !== null && cartVal < parseFloat(minCart)) return false;
    if (maxCart !== null && cartVal > parseFloat(maxCart)) return false;

    // Coupon filter
    if (hasCoupon === 'any' && s.coupons.length === 0) return false;
    if (hasCoupon === 'no' && s.coupons.length > 0) return false;
    if (hasCoupon === 'failed' && !s.coupons.some((c) => c.status === 'failed')) return false;
    if (hasCoupon === 'recovered' && !s.coupons.some((c) => c.status === 'recovered')) return false;

    // Product search
    if (product) {
      const term = product.toLowerCase();
      const match = s.products.some((p) =>
        (p.productTitle ?? '').toLowerCase().includes(term)
      );
      if (!match) return false;
    }

    return true;
  });

  // Sort by startTime DESC
  filtered.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  // Scoped counts
  const total = filtered.length;
  const checkoutCount = filtered.filter(
    (s) => s.outcome === 'checkout' || s.outcome === 'ordered'
  ).length;
  const completedCount = filtered.filter((s) => s.outcome === 'ordered').length;
  const checkoutRate = total > 0 ? Math.round((checkoutCount / total) * 1000) / 10 : 0;
  const completionRate = total > 0 ? Math.round((completedCount / total) * 1000) / 10 : 0;

  // Paginate
  const offset = (page - 1) * PER_PAGE;
  const paginated = filtered.slice(offset, offset + PER_PAGE);

  return NextResponse.json({
    sessions: paginated,
    total,
    page,
    perPage: PER_PAGE,
    scopedCounts: { total, checkoutRate, completionRate },
  });
}
