export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { buildSessionsFromEvents, deriveSourceV3 } from '@/lib/v3/session-builder';

function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const shopDomain = p.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase.from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const shopId = shop.id;

  const end = new Date(p.get('end') ?? new Date().toISOString());
  const start = new Date(p.get('start') ?? subDays(end, 7).toISOString());
  const page = Math.max(1, parseInt(p.get('page') ?? '1'));
  const perPage = 25;

  const device = p.get('device') ?? '';
  const country = p.get('country') ?? '';
  const source = p.get('source') ?? '';
  const product = p.get('product') ?? '';
  const couponFilter = p.get('coupon') ?? '';
  const outcome = p.get('outcome') ?? '';
  const search = p.get('search') ?? '';
  const boxFilter = p.get('boxFilter') ?? '';
  const minCart = parseFloat(p.get('minCart') ?? '0') || 0;
  const maxCart = parseFloat(p.get('maxCart') ?? '0') || 0;

  let cartQ = supabase.from('CartEvent')
    .select('sessionId, eventType, cartValue, cartItemCount, lineItems, couponCode, couponSuccess, couponRecovered, discountAmount, device, country, occurredAt, utmSource, utmMedium, utmCampaign')
    .eq('shopId', shopId).gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString()).limit(20000);
  if (device) cartQ = cartQ.eq('device', device);
  if (country) cartQ = cartQ.ilike('country', country);

  const { data: cartEvs } = await cartQ;
  const cartEvents = cartEvs ?? [];
  const sessionIds = Array.from(new Set(cartEvents.map((e) => e.sessionId)));

  const { data: checkoutEvs } = await supabase.from('CheckoutEvent')
    .select('sessionId, eventType, totalPrice, occurredAt').eq('shopId', shopId)
    .in('sessionId', sessionIds.slice(0, 500)).limit(5000);

  let sessions = buildSessionsFromEvents(
    cartEvents as Parameters<typeof buildSessionsFromEvents>[0],
    checkoutEvs ?? [],
  );

  // KPI box counts (before filters)
  const all = sessions.length;
  const withProducts = sessions.filter((s) => s.products.length > 0 || (s.cartValueEnd ?? 0) > 0 || (s.cartItemCount ?? 0) > 0).length;
  const withCoupon = sessions.filter((s) => s.coupons.length > 0).length;
  const reachedCheckout = sessions.filter((s) => s.outcome !== 'abandoned').length;
  const checkoutWithCoupon = sessions.filter((s) => s.outcome !== 'abandoned' && s.coupons.length > 0).length;
  const checkoutWithoutCoupon = reachedCheckout - checkoutWithCoupon;

  // Apply filters
  if (source) sessions = sessions.filter((s) => deriveSourceV3(s.utmSource, s.utmMedium).toLowerCase() === source.toLowerCase());
  if (product) sessions = sessions.filter((s) => s.products.some((pr) => pr.productTitle === product));
  if (minCart > 0) sessions = sessions.filter((s) => (s.cartValueEnd ?? 0) >= minCart);
  if (maxCart > 0) sessions = sessions.filter((s) => (s.cartValueEnd ?? 0) <= maxCart);
  if (couponFilter === 'any') sessions = sessions.filter((s) => s.coupons.length > 0);
  if (couponFilter === 'no') sessions = sessions.filter((s) => s.coupons.length === 0);
  if (couponFilter === 'applied') sessions = sessions.filter((s) => s.coupons.some((c) => c.status === 'applied' || c.status === 'recovered'));
  if (couponFilter === 'failed') sessions = sessions.filter((s) => s.coupons.some((c) => c.status === 'failed'));
  if (couponFilter === 'recovered') sessions = sessions.filter((s) => s.coupons.some((c) => c.status === 'recovered'));
  if (outcome === 'ordered') sessions = sessions.filter((s) => s.outcome === 'ordered');
  if (outcome === 'checkout') sessions = sessions.filter((s) => s.outcome === 'checkout');
  if (outcome === 'abandoned') sessions = sessions.filter((s) => s.outcome === 'abandoned');
  if (boxFilter === 'products') sessions = sessions.filter((s) => s.products.length > 0 || (s.cartValueEnd ?? 0) > 0);
  if (boxFilter === 'coupon') sessions = sessions.filter((s) => s.coupons.length > 0);
  if (boxFilter === 'checkout') sessions = sessions.filter((s) => s.outcome !== 'abandoned');
  if (search) {
    const q = search.toLowerCase();
    sessions = sessions.filter((s) =>
      s.sessionId.toLowerCase().includes(q) ||
      s.products.some((pr) => pr.productTitle?.toLowerCase().includes(q)) ||
      s.coupons.some((c) => c.code.toLowerCase().includes(q)) ||
      s.summary.toLowerCase().includes(q)
    );
  }

  const total = sessions.length;
  const paginated = sessions.slice((page - 1) * perPage, page * perPage);
  const scopedCheckouts = sessions.filter((s) => s.outcome !== 'abandoned').length;
  const scopedOrdered = sessions.filter((s) => s.outcome === 'ordered').length;

  return NextResponse.json({
    boxes: {
      cartsOpened: all,
      emptyCount: all - withProducts,
      withProducts,
      withProductsPct: all > 0 ? Math.round((withProducts / all) * 1000) / 10 : 0,
      couponAttempted: withCoupon,
      couponAttemptedPct: withProducts > 0 ? Math.round((withCoupon / withProducts) * 1000) / 10 : 0,
      reachedCheckout,
      reachedCheckoutPct: withProducts > 0 ? Math.round((reachedCheckout / withProducts) * 1000) / 10 : 0,
      checkoutWithCoupon,
      checkoutWithoutCoupon,
    },
    sessions: paginated,
    total,
    page,
    perPage,
    scopedCounts: {
      showing: total,
      checkoutRate: total > 0 ? Math.round((scopedCheckouts / total) * 1000) / 10 : 0,
      completionRate: total > 0 ? Math.round((scopedOrdered / total) * 1000) / 10 : 0,
    },
  });
}
