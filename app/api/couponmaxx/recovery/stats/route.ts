export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getShopFromRequest } from '@/lib/verify-session-token';
import { ensureShop } from '@/lib/ensure-shop';

export async function GET(req: NextRequest) {
  const shopResult = await ensureShop(req);
  if (!shopResult) return NextResponse.json({ error: 'Missing shop' }, { status: 400 });
  const shop = { id: shopResult.shopId };

  const p = req.nextUrl.searchParams;
  const from = p.get('from') ?? new Date(Date.now() - 7 * 86400000).toISOString();
  const to   = p.get('to')   ?? new Date().toISOString();

  // Fetch all recovery events in range
  const { data: events, error } = await supabase
    .from('RecoveryEvent')
    .select('recoveryAction, recoveryUsed, revenueRecovered, failureReason')
    .eq('shopId', shop.id)
    .gte('createdAt', from)
    .lte('createdAt', to);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = events ?? [];

  const codesOffered = rows.filter((r) => r.recoveryAction === 'show_code').length;
  const codesUsed    = rows.filter((r) => r.recoveryAction === 'show_code' && r.recoveryUsed).length;
  const revenueRecovered = rows.reduce(
    (sum, r) => sum + (r.recoveryUsed && r.revenueRecovered ? r.revenueRecovered : 0), 0
  );

  // Top trigger
  const triggerCounts: Record<string, number> = {};
  rows.forEach((r) => {
    triggerCounts[r.failureReason] = (triggerCounts[r.failureReason] ?? 0) + 1;
  });
  const topTrigger = Object.entries(triggerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Recovery settings for enabled check
  const { data: settings } = await supabase
    .from('MerchantRecoverySettings')
    .select('enabled')
    .eq('shopId', shop.id)
    .single();

  return NextResponse.json({
    enabled: settings?.enabled ?? false,
    codesOffered,
    codesUsed,
    useRate: codesOffered > 0 ? Math.round((codesUsed / codesOffered) * 1000) / 10 : 0,
    revenueRecovered,
    avgRevenuePerUse: codesUsed > 0 ? Math.round(revenueRecovered / codesUsed) : 0,
    topTrigger,
  });
}
