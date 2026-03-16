export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { buildSessionsFromEvents, deriveSourceV3 } from '@/lib/v3/session-builder';

function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const shopDomain = p.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const shop = await prisma.shop.findFirst({ where: { shopDomain, isActive: true }, select: { id: true } });
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });
  const shopId = shop.id;

  const rawEnd = new Date(p.get('end') ?? new Date().toISOString());
  const rawStart = new Date(p.get('start') ?? subDays(rawEnd, 7).toISOString());
  // Normalise to full UTC calendar days so no events are lost due to timezone offset.
  const startDayStr = rawStart.toISOString().slice(0, 10);
  const endDayStr   = rawEnd.toISOString().slice(0, 10);
  const start = new Date(startDayStr + 'T00:00:00.000Z');
  const end   = new Date(endDayStr   + 'T23:59:59.999Z');
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

  // Fetch all cart events via Prisma — no PostgREST 1000-row cap
  const rawCartEvs = await prisma.cartEvent.findMany({
    select: {
      sessionId: true, eventType: true, cartValue: true, cartItemCount: true,
      lineItems: true, couponCode: true, couponSuccess: true, couponRecovered: true,
      discountAmount: true, device: true, country: true,
      occurredAt: true, utmSource: true, utmMedium: true, utmCampaign: true,
    },
    where: {
      shopId,
      occurredAt: { gte: start, lte: end },
      ...(device ? { device } : {}),
      ...(country ? { country: { contains: country, mode: 'insensitive' as const } } : {}),
    },
    orderBy: { occurredAt: 'asc' },
  });

  // buildSessionsFromEvents expects occurredAt as ISO string
  const cartEvents = rawCartEvs.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() }));

  const sessionIds = Array.from(new Set(cartEvents.map((e) => e.sessionId)));

  // Checkout events — no session slice cap
  const rawCheckoutEvs = await prisma.checkoutEvent.findMany({
    select: { sessionId: true, eventType: true, totalPrice: true, occurredAt: true },
    where: { shopId, sessionId: { in: sessionIds } },
  });
  const checkoutEvs = rawCheckoutEvs.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() }));

  // True unique session count from raw events (includes empty-cart visitors)
  const allUniqueSessionIds = new Set(cartEvents.map((e) => e.sessionId));
  const trueTotal = allUniqueSessionIds.size;

  let sessions = buildSessionsFromEvents(cartEvents, checkoutEvs);

  // KPI box counts (before filters)
  const withProducts = sessions.filter((s) => (s.cartItemCount ?? 0) > 0 || s.products.length > 0).length;
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
  if (boxFilter === 'products') sessions = sessions.filter((s) => (s.cartItemCount ?? 0) > 0 || s.products.length > 0);
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
      cartsOpened: trueTotal,
      emptyCount: trueTotal - withProducts,
      withProducts,
      withProductsPct: trueTotal > 0 ? Math.round((withProducts / trueTotal) * 1000) / 10 : 0,
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
