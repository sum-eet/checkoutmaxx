export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { deriveSourceV3 } from '@/lib/session-utils';
import { getShopFromRequest } from "@/lib/verify-session-token";

function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }
function dateStr(d: Date | string)   { return new Date(d).toISOString().slice(0, 10); }

// Build CartSessionV3-compatible objects from SQL session summary rows.
// This replaces buildSessionsFromEvents — no raw event rows needed.
function sessionFromSummary(row: SessionSummaryRow) {
  // Derive outcome
  let outcome: 'ordered' | 'checkout' | 'abandoned' = 'abandoned';
  if (row.has_ordered)          outcome = 'ordered';
  else if (row.has_checkout_started || row.has_checkout_clicked) outcome = 'checkout';

  // Build products from line_items (real qty/price) with fallback to product_titles
  const rawLineItems = row.line_items as Array<{ productTitle?: string; price?: number; quantity?: number }> | null;
  const products = rawLineItems && rawLineItems.length > 0
    ? rawLineItems.map((item) => ({
        productTitle: item.productTitle ?? null,
        price: item.price ?? null,  // already in cents from CartEvent
        quantity: item.quantity ?? 1,
      }))
    : (row.product_titles ?? []).map((t: string) => ({ productTitle: t, price: null, quantity: 1 }));

  // Build coupons from coupon_events JSON
  // Each event: {code, eventType, recovered, discountAmount}
  // Collapse by code: last status wins; recovered beats failed
  const couponMap = new Map<string, { status: 'applied' | 'failed' | 'recovered'; discountAmount: number | null }>();
  for (const ev of (row.coupon_events ?? [])) {
    const existing = couponMap.get(ev.code);
    let status: 'applied' | 'failed' | 'recovered';
    if (ev.recovered)                        status = 'recovered';
    else if (ev.eventType === 'cart_coupon_applied') status = 'applied';
    else                                     status = 'failed';
    // applied/recovered always wins over failed
    if (!existing || status !== 'failed') {
      couponMap.set(ev.code, { status, discountAmount: ev.discountAmount ?? null });
    }
  }
  const coupons = Array.from(couponMap.entries()).map(([code, v]) => ({
    code,
    status: v.status,
    discountAmount: v.discountAmount,
  }));

  const cartValueEnd = row.cart_value_end_cents != null ? row.cart_value_end_cents / 100 : null;
  const cartValueStart = row.cart_value_start_cents != null ? row.cart_value_start_cents / 100 : null;

  const coupon  = coupons[0] ?? null;
  const product = products[0]?.productTitle ?? null;
  const productStr = products.length > 1 ? `${product ?? 'item'} +${products.length - 1} more` : product;
  const couponStr  = !coupon ? '' :
    coupon.status === 'applied'   ? `, applied ${coupon.code}` :
    coupon.status === 'recovered' ? `, unlocked ${coupon.code}` :
                                    `, tried ${coupon.code} (failed)`;
  const summary = outcome === 'ordered'   ? `${productStr ?? 'items'}${couponStr}, completed order` :
                  outcome === 'checkout'  ? `${productStr ?? 'items'}${couponStr}, reached checkout` :
                  products.length > 0     ? `${productStr}${couponStr}, abandoned` :
                                            'Browsed without adding to cart';

  return {
    sessionId:    row.session_id,
    startTime:    row.first_event,
    duration:     row.duration_ms ?? 0,
    country:      row.country     ?? null,
    device:       row.device      ?? null,
    utmSource:    row.utm_source  ?? null,
    utmMedium:    row.utm_medium  ?? null,
    utmCampaign:  row.utm_campaign ?? null,
    products,
    cartItemCount: row.cart_item_count ?? null,
    cartValueStart,
    cartValueEnd,
    coupons,
    outcome,
    summary,
  };
}

type CouponEvent = { code: string; eventType: string; recovered: boolean; discountAmount: number | null };
type SessionSummaryRow = {
  session_id:              string;
  first_event:             string;
  duration_ms:             number;
  country:                 string | null;
  device:                  string | null;
  utm_source:              string | null;
  utm_medium:              string | null;
  utm_campaign:            string | null;
  cart_value_start_cents:  number | null;
  cart_value_end_cents:    number | null;
  cart_item_count:         number | null;
  has_products:            boolean;
  product_titles:          string[];
  line_items:              unknown;
  coupon_events:           CouponEvent[];
  has_coupon:              boolean;
  has_applied:             boolean;
  has_failed:              boolean;
  has_recovered:           boolean;
  has_checkout_clicked:    boolean;
  has_ordered:             boolean;
  has_checkout_started:    boolean;
};

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const shopDomain = getShopFromRequest(req);
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase.from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const shopId = shop.id;

  const rawEnd   = new Date(p.get('end')   ?? new Date().toISOString());
  const rawStart = new Date(p.get('start') ?? subDays(rawEnd, 7).toISOString());
  const start    = new Date(dateStr(rawStart) + 'T00:00:00.000Z');
  const end      = new Date(dateStr(rawEnd)   + 'T23:59:59.999Z');
  const page     = Math.max(1, parseInt(p.get('page') ?? '1'));
  const perPage  = 25;

  const device       = p.get('device')    ?? '';
  const country      = p.get('country')   ?? '';
  const source       = p.get('source')    ?? '';
  const product      = p.get('product')   ?? '';
  const couponFilter = p.get('coupon')    ?? '';
  const outcome      = p.get('outcome')   ?? '';
  const search       = p.get('search')    ?? '';
  const boxFilter    = p.get('boxFilter') ?? '';
  const minCart      = parseFloat(p.get('minCart') ?? '0') || 0;
  const maxCart      = parseFloat(p.get('maxCart') ?? '0') || 0;

  // KPI boxes and session summaries in parallel
  const [kpisRes, summariesRes] = await Promise.all([
    supabase.rpc('couponmaxx_session_kpis', {
      p_shop_id: shopId,
      p_start:   start.toISOString(),
      p_end:     end.toISOString(),
    }),
    supabase.rpc('couponmaxx_session_summaries', {
      p_shop_id: shopId,
      p_start:   start.toISOString(),
      p_end:     end.toISOString(),
      p_device:  device  || null,
      p_country: country || null,
    }),
  ]);

  const kpi = kpisRes.data?.[0] ?? { carts_opened: 0, with_products: 0, with_coupon: 0, reached_checkout: 0, checkout_with_coupon: 0, checkout_without_coupon: 0 };
  const summaryRows: SessionSummaryRow[] = summariesRes.data ?? [];

  // Build session objects from SQL summaries
  let sessions = summaryRows.map(sessionFromSummary);

  // Apply filters (in JS, same as before — session summaries have all needed fields)
  if (source)       sessions = sessions.filter((s) => deriveSourceV3(s.utmSource, s.utmMedium).toLowerCase() === source.toLowerCase());
  if (product)      sessions = sessions.filter((s) => s.products.some((pr) => pr.productTitle === product));
  if (minCart > 0)  sessions = sessions.filter((s) => (s.cartValueEnd ?? 0) >= minCart);
  if (maxCart > 0)  sessions = sessions.filter((s) => (s.cartValueEnd ?? 0) <= maxCart);
  if (couponFilter === 'any')       sessions = sessions.filter((s) => s.coupons.length > 0);
  if (couponFilter === 'no')        sessions = sessions.filter((s) => s.coupons.length === 0);
  if (couponFilter === 'applied')   sessions = sessions.filter((s) => s.coupons.some((c) => c.status === 'applied' || c.status === 'recovered'));
  if (couponFilter === 'failed')    sessions = sessions.filter((s) => s.coupons.some((c) => c.status === 'failed'));
  if (couponFilter === 'recovered') sessions = sessions.filter((s) => s.coupons.some((c) => c.status === 'recovered'));
  if (outcome === 'ordered')    sessions = sessions.filter((s) => s.outcome === 'ordered');
  if (outcome === 'checkout')   sessions = sessions.filter((s) => s.outcome === 'checkout');
  if (outcome === 'abandoned')  sessions = sessions.filter((s) => s.outcome === 'abandoned');
  if (boxFilter === 'products') sessions = sessions.filter((s) => (s.cartItemCount ?? 0) > 0 || s.products.length > 0 || (s.cartValueEnd ?? 0) > 0);
  if (boxFilter === 'coupon')   sessions = sessions.filter((s) => s.coupons.length > 0);
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

  // Scoped KPI boxes — reflect whatever filters are active
  const scopedBoxes = {
    cartsOpened:     sessions.length,
    withProducts:    sessions.filter(s => s.products.length > 0 || (s.cartItemCount ?? 0) > 0 || (s.cartValueEnd ?? 0) > 0).length,
    couponAttempted: sessions.filter(s => s.coupons.length > 0).length,
    reachedCheckout: sessions.filter(s => s.outcome !== 'abandoned').length,
  };

  const total           = sessions.length;
  const paginated       = sessions.slice((page - 1) * perPage, page * perPage);
  const scopedCheckouts = sessions.filter((s) => s.outcome !== 'abandoned').length;
  const scopedOrdered   = sessions.filter((s) => s.outcome === 'ordered').length;

  return NextResponse.json({
    scopedBoxes,
    boxes: {
      cartsOpened:      kpi.carts_opened,
      emptyCount:       kpi.carts_opened - kpi.with_products,
      withProducts:     kpi.with_products,
      withProductsPct:  kpi.carts_opened > 0 ? Math.round((kpi.with_products / kpi.carts_opened) * 1000) / 10 : 0,
      couponAttempted:  kpi.with_coupon,
      couponAttemptedPct: kpi.with_products > 0 ? Math.round((kpi.with_coupon / kpi.with_products) * 1000) / 10 : 0,
      reachedCheckout:  kpi.reached_checkout,
      reachedCheckoutPct: kpi.with_products > 0 ? Math.round((kpi.reached_checkout / kpi.with_products) * 1000) / 10 : 0,
      checkoutWithCoupon:    kpi.checkout_with_coupon,
      checkoutWithoutCoupon: kpi.checkout_without_coupon,
    },
    sessions:  paginated,
    total,
    page,
    perPage,
    scopedCounts: {
      showing:        total,
      checkoutRate:   total > 0 ? Math.round((scopedCheckouts / total) * 1000) / 10 : 0,
      completionRate: total > 0 ? Math.round((scopedOrdered   / total) * 1000) / 10 : 0,
    },
  });
}
