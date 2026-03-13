export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { getSessionTimeline } from '@/lib/cart-metrics';
import { supabase } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  const sessionId = req.nextUrl.searchParams.get('sessionId');

  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

  const { data: shop } = await supabase.from('Shop').select('id').eq('shopDomain', shopDomain).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const timeline = await getSessionTimeline(shop.id, sessionId);
  return NextResponse.json({ timeline });
}
