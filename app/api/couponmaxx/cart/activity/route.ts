export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAuthenticatedShop } from '@/lib/verify-session-token';
import { getShop } from '@/lib/shop';

function subMs(d: Date, ms: number) { return new Date(d.getTime() - ms); }
function dateStr(d: Date) { return d.toISOString().slice(0, 10); }

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) return NextResponse.json({ error: 'Missing shop' }, { status: 401 });
  const shopData = await getShop(shopDomain);
  if (!shopData) return NextResponse.json({ error: 'Install required' }, { status: 400 });
  const shopId = shopData.id;

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

  const [
    medianRes, prevMedianRes,
    timeDistRes,
    removalsRes,
    cartValueTrendRes, prevCartValueTrendRes,
    sessionPatternsRes,
    // avg cart edits — fetch all edit events per session
    editsRes, prevEditsRes,
  ] = await Promise.all([
    supabase.rpc('median_time_to_checkout', args),
    supabase.rpc('median_time_to_checkout', prevArgs),
    supabase.rpc('cart_time_distribution', args),
    supabase.rpc('product_removals', args),
    supabase.rpc('cart_value_trend', args),
    supabase.rpc('cart_value_trend', prevArgs),
    supabase.rpc('session_patterns', args),
    // Edit events for avg-edits-per-session KPI
    supabase.from('CartEvent').select('sessionId, eventType')
      .eq('shopId', shopId)
      .in('eventType', ['cart_item_added', 'cart_item_removed', 'cart_item_changed'])
      .gte('occurredAt', start.toISOString()).lte('occurredAt', end.toISOString()),
    supabase.from('CartEvent').select('sessionId, eventType')
      .eq('shopId', shopId)
      .in('eventType', ['cart_item_added', 'cart_item_removed', 'cart_item_changed'])
      .gte('occurredAt', prevStart.toISOString()).lte('occurredAt', prevEnd.toISOString()),
  ]);

  // Avg cart edits per session
  function calcAvgEdits(rows: { sessionId: string }[] | null) {
    if (!rows || rows.length === 0) return 0;
    const bySession = new Map<string, number>();
    for (const r of rows) {
      bySession.set(r.sessionId, (bySession.get(r.sessionId) ?? 0) + 1);
    }
    const total = Array.from(bySession.values()).reduce((a, b) => a + b, 0);
    return Math.round(total / bySession.size * 10) / 10;
  }

  const avgEdits     = calcAvgEdits(editsRes.data as { sessionId: string }[] | null);
  const prevAvgEdits = calcAvgEdits(prevEditsRes.data as { sessionId: string }[] | null);

  // Median time KPI
  const medianMs     = Number(medianRes.data?.[0]?.median_ms ?? 0);
  const prevMedianMs = Number(prevMedianRes.data?.[0]?.median_ms ?? 0);

  // Cart value trend KPI
  type TrendRow = {
    grew_pct: number;
    grew_avg_increase_dollars: number;
    shrank_pct: number;
    shrank_avg_decrease_dollars: number;
    unchanged_pct: number;
  };
  const trend:     TrendRow = cartValueTrendRes.data?.[0]     ?? { grew_pct: 0, grew_avg_increase_dollars: 0, shrank_pct: 0, shrank_avg_decrease_dollars: 0, unchanged_pct: 0 };
  const prevTrend: TrendRow = prevCartValueTrendRes.data?.[0] ?? { grew_pct: 0, grew_avg_increase_dollars: 0, shrank_pct: 0, shrank_avg_decrease_dollars: 0, unchanged_pct: 0 };

  // avgCartValueChangePct = grew% - shrank% (net direction)
  const avgCartValueChangePct     = Math.round((Number(trend.grew_pct) - Number(trend.shrank_pct)) * 10) / 10;
  const prevAvgCartValueChangePct = Math.round((Number(prevTrend.grew_pct) - Number(prevTrend.shrank_pct)) * 10) / 10;

  // Session patterns
  type PatternRow = {
    one_and_done: number;
    one_and_done_pct: number;
    deliberate: number;
    deliberate_pct: number;
    lost_after_adding: number;
    lost_after_adding_pct: number;
  };
  const patterns: PatternRow = sessionPatternsRes.data?.[0] ?? {
    one_and_done: 0, one_and_done_pct: 0,
    deliberate: 0, deliberate_pct: 0,
    lost_after_adding: 0, lost_after_adding_pct: 0,
  };

  // Removals
  type RemovalRow = {
    product_title: string;
    times_removed: number;
    remove_rate: number;
    avg_cart_value_at_removal: number;
    product_that_stayed: string | null;
  };
  const removals = (removalsRes.data ?? []).map((r: RemovalRow) => ({
    productTitle: r.product_title,
    timesRemoved: Number(r.times_removed),
    removeRate: Number(r.remove_rate),
    avgCartValueAtRemoval: Number(r.avg_cart_value_at_removal),
    productThatStayed: r.product_that_stayed ?? null,
  }));

  // Time distribution — always 6 buckets
  type BucketRow = { bucket: string; sessions: number };
  const timeDistribution = (timeDistRes.data ?? []).map((r: BucketRow) => ({
    bucket: r.bucket,
    sessions: Number(r.sessions),
  }));

  return NextResponse.json({
    kpis: {
      medianTimeToCheckoutMs: medianMs,
      medianTimeToCheckoutDeltaMs: medianMs - prevMedianMs,
      avgCartEditsPerSession: avgEdits,
      avgCartEditsDelta: Math.round((avgEdits - prevAvgEdits) * 10) / 10,
      avgCartValueChangePct,
      avgCartValueChangeDelta: Math.round((avgCartValueChangePct - prevAvgCartValueChangePct) * 10) / 10,
    },
    timeDistribution,
    removals,
    cartValueTrend: {
      grewPct: Number(trend.grew_pct),
      grewAvgIncreaseDollars: Number(trend.grew_avg_increase_dollars),
      shrankPct: Number(trend.shrank_pct),
      shrankAvgDecreaseDollars: Number(trend.shrank_avg_decrease_dollars),
      unchangedPct: Number(trend.unchanged_pct),
    },
    sessionPatterns: {
      oneAndDone: Number(patterns.one_and_done),
      oneAndDonePct: Number(patterns.one_and_done_pct),
      deliberate: Number(patterns.deliberate),
      deliberatePct: Number(patterns.deliberate_pct),
      lostAfterAdding: Number(patterns.lost_after_adding),
      lostAfterAddingPct: Number(patterns.lost_after_adding_pct),
    },
  });
}
