export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getShopFromRequest } from '@/lib/verify-session-token';

export async function GET(req: NextRequest) {
  const shopDomain = getShopFromRequest(req);
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const { searchParams } = req.nextUrl;
  const start = searchParams.get('start');
  const end   = searchParams.get('end');

  if (!start || !end) return NextResponse.json({ error: 'Missing date range' }, { status: 400 });

  // Date picker controls everything — no special "today" logic
  const args = { p_shop_id: shop.id, p_start: start, p_end: end };

  const [
    funnelData,
    funnelBySource,
    checkoutSteps,
    lastEvents,
    checkoutTiming,
    converterComparison,
  ] = await Promise.all([
    supabase.rpc('cart_funnel_with_prior',            args),
    supabase.rpc('cart_funnel_by_source_with_prior',  args),
    supabase.rpc('checkout_step_funnel',              args),
    supabase.rpc('cart_abandoned_last_event',         args),
    supabase.rpc('checkout_timing_distribution',      args),
    supabase.rpc('cart_converter_comparison',         args),
  ]);

  return NextResponse.json({
    funnelData:          funnelData.data          ?? [],
    funnelBySource:      funnelBySource.data      ?? [],
    checkoutSteps:       checkoutSteps.data       ?? [],
    lastEvents:          lastEvents.data          ?? [],
    checkoutTiming:      checkoutTiming.data      ?? [],
    converterComparison: converterComparison.data ?? [],
  });
}
