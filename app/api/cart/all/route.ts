export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import {
  getCartKPIs,
  getCartSessions,
  getCouponStats,
  getCachedDashboard,
  setCachedDashboard,
  invalidateDashboardCache,
} from '@/lib/cart-metrics';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const shop = await prisma.shop.findUnique({ where: { shopDomain }, select: { id: true } });
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const startParam = req.nextUrl.searchParams.get('start');
  const since = startParam ? new Date(startParam) : undefined;
  const cacheKey = `${shop.id}:${startParam ?? 'today'}`;

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
  if (forceRefresh) invalidateDashboardCache(cacheKey);

  const cached = getCachedDashboard(cacheKey);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  const [kpis, sessions, couponStats] = await Promise.all([
    getCartKPIs(shop.id, since),
    getCartSessions(shop.id, since),
    getCouponStats(shop.id, since),
  ]);

  const data = { kpis, sessions, couponStats };
  setCachedDashboard(cacheKey, data);

  return NextResponse.json({ ...data, cached: false });
}
