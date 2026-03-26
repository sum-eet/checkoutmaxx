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
  const end = searchParams.get('end');

  if (!start || !end) return NextResponse.json({ error: 'Missing date range' }, { status: 400 });

  // Section 1 always shows today vs 7-day avg — not tied to date picker
  const now = new Date();
  const todayStart = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z').toISOString();
  const todayEnd = now.toISOString();

  const args = { p_shop_id: shop.id, p_start: start, p_end: end };
  const todayArgs = { p_shop_id: shop.id, p_today_start: todayStart, p_today_end: todayEnd };

  const [
    funnelToday,
    funnelBySource,
    checkoutSteps,
    lastEvents,
    checkoutTiming,
    converterComparison,
    timeDistribution,
  ] = await Promise.all([
    supabase.rpc('cart_funnel_today_vs_avg', todayArgs),
    supabase.rpc('cart_funnel_by_source_today', todayArgs),
    supabase.rpc('checkout_step_funnel', args),
    supabase.rpc('cart_abandoned_last_event', args),
    supabase.rpc('checkout_timing_distribution', args),
    supabase.rpc('cart_converter_comparison', args),
    supabase.rpc('cart_time_distribution', args),
  ]);

  return NextResponse.json({
    funnelToday: funnelToday.data ?? [],
    funnelBySource: funnelBySource.data ?? [],
    checkoutSteps: checkoutSteps.data ?? [],
    lastEvents: lastEvents.data ?? [],
    checkoutTiming: checkoutTiming.data ?? [],
    converterComparison: converterComparison.data ?? [],
    timeDistribution: (timeDistribution.data ?? []).map((r: { bucket: string; sessions: number }) => ({
      bucket: r.bucket,
      sessions: Number(r.sessions),
    })),
  });
}
