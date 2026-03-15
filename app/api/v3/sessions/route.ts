export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { buildSessionsFromEvents, deriveSourceV3, type CartSessionV3 } from '@/lib/v3/session-builder';

const PER_PAGE = 25;

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const end = new Date(req.nextUrl.searchParams.get('end') ?? new Date().toISOString());
  const defaultStart = new Date(end.getTime() - 24 * 3600 * 1000);
  const start = new Date(req.nextUrl.searchParams.get('start') ?? defaultStart.toISOString());
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10));

  // Filter params
  const device = req.nextUrl.searchParams.get('device') ?? '';
  const country = req.nextUrl.searchParams.get('country') ?? '';
  const source = req.nextUrl.searchParams.get('source') ?? '';
  const product = req.nextUrl.searchParams.get('product') ?? '';
  const minCart = req.nextUrl.searchParams.get('minCart') ?? '';
  const maxCart = req.nextUrl.searchParams.get('maxCart') ?? '';
  const hasCoupon = req.nextUrl.searchParams.get('hasCoupon') ?? '';
  const search = req.nextUrl.searchParams.get('search') ?? '';

  // Fetch cart events
  let cartQuery = supabase.from('CartEvent')
    .select('sessionId, eventType, cartValue, cartItemCount, lineItems, couponCode, couponSuccess, couponRecovered, discountAmount, device, country, occurredAt, utmSource, utmMedium, utmCampaign')
    .eq('shopId', shop.id)
    .gte('occurredAt', start.toISOString())
    .lte('occurredAt', end.toISOString())
    .order('occurredAt', { ascending: false })
    .limit(15000);

  if (device) cartQuery = cartQuery.eq('device', device);
  if (country) cartQuery = cartQuery.ilike('country', country);

  const { data: cartEvents } = await cartQuery;
  if (!cartEvents || cartEvents.length === 0) {
    return NextResponse.json({ sessions: [], total: 0, page, perPage: PER_PAGE, scopedCounts: { total: 0, checkoutRate: 0, completionRate: 0 } });
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

  // Apply filters
  const filtered = allSessions.filter((s: CartSessionV3) => {
    // Source filter
    if (source) {
      const label = deriveSourceV3(s.utmSource, s.utmMedium);
      if (label.toLowerCase() !== source.toLowerCase()) return false;
    }

    // Cart value filter (dollars)
    const cartVal = s.cartValueEnd ?? s.cartValueStart ?? 0;
    if (minCart && cartVal < parseFloat(minCart)) return false;
    if (maxCart && cartVal > parseFloat(maxCart)) return false;

    // Coupon filter
    if (hasCoupon === 'any' && s.coupons.length === 0) return false;
    if (hasCoupon === 'no' && s.coupons.length > 0) return false;
    if (hasCoupon === 'failed' && !s.coupons.some((c) => c.status === 'failed')) return false;
    if (hasCoupon === 'recovered' && !s.coupons.some((c) => c.status === 'recovered')) return false;

    // Product filter
    if (product) {
      const term = product.toLowerCase();
      if (!s.products.some((p) => (p.productTitle ?? '').toLowerCase().includes(term))) return false;
    }

    // Full-text search across sessionId, product titles, coupon codes
    if (search) {
      const term = search.toLowerCase();
      const inSession = s.sessionId.toLowerCase().includes(term);
      const inProduct = s.products.some((p) => (p.productTitle ?? '').toLowerCase().includes(term));
      const inCoupon = s.coupons.some((c) => c.code.toLowerCase().includes(term));
      if (!inSession && !inProduct && !inCoupon) return false;
    }

    return true;
  });

  // Sort by startTime DESC
  filtered.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

  // Scoped counts
  const total = filtered.length;
  const checkoutCount = filtered.filter((s) => s.outcome === 'checkout' || s.outcome === 'ordered').length;
  const completedCount = filtered.filter((s) => s.outcome === 'ordered').length;
  const checkoutRate = total > 0 ? Math.round((checkoutCount / total) * 1000) / 10 : 0;
  const completionRate = total > 0 ? Math.round((completedCount / total) * 1000) / 10 : 0;

  // Paginate
  const paginated = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return NextResponse.json({
    sessions: paginated,
    total,
    page,
    perPage: PER_PAGE,
    scopedCounts: { total, checkoutRate, completionRate },
  });
}
