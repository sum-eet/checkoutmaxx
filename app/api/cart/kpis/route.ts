export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getCartKPIs } from '@/lib/cart-metrics';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const shop = await prisma.shop.findUnique({ where: { shopDomain }, select: { id: true } });
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const kpis = await getCartKPIs(shop.id);
  return NextResponse.json({ kpis });
}
