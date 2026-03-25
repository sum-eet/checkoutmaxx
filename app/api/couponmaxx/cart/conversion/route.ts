export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getShopFromRequest } from '@/lib/verify-session-token';

function subMs(d: Date, ms: number) { return new Date(d.getTime() - ms); }
function dateStr(d: Date) { return d.toISOString().slice(0, 10); }

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const shopDomain = getShopFromRequest(req);
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const shopId = shop.id;

  const rawEnd   = new Date(p.get('end')   ?? new Date().toISOString());
  const rawStart = new Date(p.get('start') ?? subMs(rawEnd, 7 * 86400000).toISOString());
  const start    = new Date(dateStr(rawStart) + 'T00:00:00.000Z');
  const end      = new Date(dateStr(rawEnd)   + 'T23:59:59.999Z');
  const rangeMs  = end.getTime() - start.getTime();

  // Previous period for deltas
  const prevEnd   = new Date(start.getTime() - 1);
  const prevStart = subMs(prevEnd, rangeMs);

  const args = { p_shop_id: shopId, p_start: start.toISOString(), p_end: end.toISOString() };
  const prevArgs = { p_shop_id: shopId, p_start: prevStart.toISOString(), p_end: prevEnd.toISOString() };

  // Fire all queries in parallel
  const [
    productsRes, sourcesRes,
    mobileRes, desktopRes, tabletRes,
    countriesRes,
    // KPI raw counts
    cartSessionsRes, prevCartSessionsRes,
    checkoutSessionsRes, prevCheckoutSessionsRes,
    abandonedRes, prevAbandonedRes,
    couponAttemptsRes,
  ] = await Promise.all([
    supabase.rpc('product_cart_conversion', args),
    supabase.rpc('source_cart_conversion', args),
    supabase.rpc('device_cart_metrics', { ...args, p_device: 'mobile' }),
    supabase.rpc('device_cart_metrics', { ...args, p_device: 'desktop' }),
    supabase.rpc('device_cart_metrics', { ...args, p_device: 'tablet' }),
    supabase.rpc('top_countries_conversion', args),
    // Cart sessions (cartValue > 0 OR cartItemCount > 0)
    supabase.from('CartEvent').select('sessionId', { count: 'estimated', head: false })
      .eq('shopId', shopId).gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString())
      .or('cartValue.gt.0,cartItemCount.gt.0'),
    supabase.from('CartEvent').select('sessionId', { count: 'estimated', head: false })
      .eq('shopId', shopId).gte('occurredAt', prevStart.toISOString()).lte('occurredAt', prevEnd.toISOString())
      .or('cartValue.gt.0,cartItemCount.gt.0'),
    // Checkout sessions
    supabase.from('CartEvent').select('sessionId', { count: 'estimated', head: false })
      .eq('shopId', shopId).eq('eventType', 'cart_checkout_clicked')
      .gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString()),
    supabase.from('CartEvent').select('sessionId', { count: 'estimated', head: false })
      .eq('shopId', shopId).eq('eventType', 'cart_checkout_clicked')
      .gte('occurredAt', prevStart.toISOString()).lte('occurredAt', prevEnd.toISOString()),
    // Abandoned: cartValue > 0, no checkout (use JS dedup below)
    supabase.from('CartEvent').select('sessionId').eq('shopId', shopId)
      .gt('cartValue', 0).gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString()),
    supabase.from('CartEvent').select('sessionId').eq('shopId', shopId)
      .gt('cartValue', 0).gte('occurredAt', prevStart.toISOString()).lte('occurredAt', prevEnd.toISOString()),
    // Sessions with coupon attempts
    supabase.from('CartEvent').select('sessionId')
      .eq('shopId', shopId).like('eventType', 'cart_coupon%')
      .gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString()),
  ]);

  // Compute unique cart sessions via dedup
  const cartSessionSet    = new Set((cartSessionsRes.data ?? []).map((r: { sessionId: string }) => r.sessionId));
  const prevCartSessionSet = new Set((prevCartSessionsRes.data ?? []).map((r: { sessionId: string }) => r.sessionId));
  const checkoutSet       = new Set((checkoutSessionsRes.data ?? []).map((r: { sessionId: string }) => r.sessionId));
  const prevCheckoutSet   = new Set((prevCheckoutSessionsRes.data ?? []).map((r: { sessionId: string }) => r.sessionId));
  const couponSet         = new Set((couponAttemptsRes.data ?? []).map((r: { sessionId: string }) => r.sessionId));

  const cartSessions     = cartSessionSet.size;
  const prevCartSessions = prevCartSessionSet.size;
  const checkoutSessions = checkoutSet.size;
  const prevCheckoutSessions = prevCheckoutSet.size;

  // Abandoned = cart sessions with no checkout event
  const allWithCart    = new Set((abandonedRes.data ?? []).map((r: { sessionId: string }) => r.sessionId));
  const allWithCartPrev = new Set((prevAbandonedRes.data ?? []).map((r: { sessionId: string }) => r.sessionId));
  let abandoned = 0; for (const sid of Array.from(allWithCart)) { if (!checkoutSet.has(sid)) abandoned++; }
  let prevAbandoned = 0; for (const sid of Array.from(allWithCartPrev)) { if (!prevCheckoutSet.has(sid)) prevAbandoned++; }

  const cartToCheckoutRate     = cartSessions > 0 ? Math.round(checkoutSessions / cartSessions * 1000) / 10 : 0;
  const prevCartToCheckoutRate = prevCartSessions > 0 ? Math.round(prevCheckoutSessions / prevCartSessions * 1000) / 10 : 0;

  const cartSessionsDelta = prevCartSessions > 0
    ? Math.round((cartSessions - prevCartSessions) / prevCartSessions * 1000) / 10 : 0;
  const abandonedDelta = prevAbandoned > 0
    ? Math.round((abandoned - prevAbandoned) / prevAbandoned * 1000) / 10 : 0;

  // Tablet: omit if < 10 sessions
  const tabletData = mobileRes.data?.[0];
  const desktopData = desktopRes.data?.[0];
  const mobileData  = mobileRes.data?.[0];
  const tabletSessions = tabletRes.data?.[0]?.cart_sessions ?? 0;

  type DeviceRow = {
    cart_sessions: number;
    cart_to_checkout_rate: number;
    median_time_to_checkout_ms: number;
    avg_cart_value_at_checkout: number;
    avg_items_in_cart: number;
    coupon_attempt_rate: number;
  };

  function mapDevice(d: DeviceRow | undefined) {
    if (!d) return { cartSessions: 0, cartToCheckoutRate: 0, medianTimeToCheckoutMs: 0, avgCartValueAtCheckout: 0, avgItemsInCart: 0, couponAttemptRate: 0 };
    return {
      cartSessions: Number(d.cart_sessions),
      cartToCheckoutRate: Number(d.cart_to_checkout_rate),
      medianTimeToCheckoutMs: Number(d.median_time_to_checkout_ms),
      avgCartValueAtCheckout: Number(d.avg_cart_value_at_checkout),
      avgItemsInCart: Number(d.avg_items_in_cart),
      couponAttemptRate: Number(d.coupon_attempt_rate),
    };
  }

  const devices: Record<string, ReturnType<typeof mapDevice>> = {
    mobile:  mapDevice(mobileData as unknown as DeviceRow),
    desktop: mapDevice(desktopData as unknown as DeviceRow),
  };
  if (tabletSessions >= 10) {
    devices.tablet = mapDevice(tabletData as unknown as DeviceRow);
  } else if (tabletSessions > 0) {
    // Fold tablet into desktop note — surface count for UI
    devices.desktop = { ...devices.desktop, cartSessions: devices.desktop.cartSessions + Number(tabletSessions) };
    devices._tabletIncluded = tabletSessions as unknown as ReturnType<typeof mapDevice>;
  }

  type ProductRow = {
    product_title: string;
    added_to_cart: number;
    checked_out_with: number;
    cart_to_checkout_rate: number;
    removed_from_cart: number;
    remove_rate: number;
    avg_cart_value_when_added: number;
  };

  type SourceRow = {
    source: string;
    utm_source: string | null;
    utm_medium: string | null;
    cart_sessions: number;
    checked_out: number;
    cart_to_checkout_rate: number;
    avg_cart_value: number;
    coupon_used_pct: number;
  };

  type CountryRow = {
    country: string;
    cart_sessions: number;
    cart_to_checkout_rate: number;
    avg_cart_value: number;
  };

  const products = (productsRes.data ?? []).map((r: ProductRow) => ({
    productTitle: r.product_title,
    addedToCart: Number(r.added_to_cart),
    checkedOutWith: Number(r.checked_out_with),
    cartToCheckoutRate: Number(r.cart_to_checkout_rate),
    removedFromCart: Number(r.removed_from_cart),
    removeRate: Number(r.remove_rate),
    avgCartValueWhenAdded: Number(r.avg_cart_value_when_added),
  }));

  const sources = (sourcesRes.data ?? []).map((r: SourceRow) => ({
    source: r.source,
    utmSource: r.utm_source,
    utmMedium: r.utm_medium,
    cartSessions: Number(r.cart_sessions),
    checkedOut: Number(r.checked_out),
    cartToCheckoutRate: Number(r.cart_to_checkout_rate),
    avgCartValue: Number(r.avg_cart_value),
    couponUsedPct: Number(r.coupon_used_pct),
  }));

  const topCountries = (countriesRes.data ?? []).map((r: CountryRow) => ({
    country: r.country,
    cartSessions: Number(r.cart_sessions),
    cartToCheckoutRate: Number(r.cart_to_checkout_rate),
    avgCartValue: Number(r.avg_cart_value),
  }));

  return NextResponse.json({
    kpis: {
      cartToCheckoutRate,
      cartToCheckoutRateDelta: Math.round((cartToCheckoutRate - prevCartToCheckoutRate) * 10) / 10,
      cartSessions,
      cartSessionsDelta,
      couponAttemptSessions: couponSet.size,
      abandonedCarts: abandoned,
      abandonedCartsDelta: abandonedDelta,
      abandonedCartsPct: cartSessions > 0 ? Math.round(abandoned / cartSessions * 1000) / 10 : 0,
    },
    products,
    sources,
    devices,
    topCountries,
  });
}
