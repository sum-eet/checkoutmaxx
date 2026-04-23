export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { shopify, sessionStorage } from '@/lib/shopify';
import { cancelSubscription } from '@/lib/billing';
import { supabase } from '@/lib/supabase';
import { getShop } from '@/lib/shop';
import { getAuthenticatedShop } from '@/lib/verify-session-token';

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  console.log('[billing/cancel] POST');
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) {
    console.warn('[billing/cancel] unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const offlineId = shopify.session.getOfflineId(shopDomain);
  const session = await sessionStorage.loadSession(offlineId);
  if (!session?.accessToken) {
    console.warn('[billing/cancel] no session for shop=%s', shopDomain);
    return NextResponse.json({ error: 'No session' }, { status: 400 });
  }

  const shopRow = await getShop(shopDomain);
  if (!shopRow) {
    console.warn('[billing/cancel] no shop row for %s', shopDomain);
    return NextResponse.json({ error: 'No shop' }, { status: 400 });
  }

  const { data: shopData } = await supabase
    .from('Shop')
    .select('subscriptionId')
    .eq('id', shopRow.id)
    .maybeSingle();

  if (!shopData?.subscriptionId) {
    console.warn('[billing/cancel] no active subscription for shop=%s', shopDomain);
    return NextResponse.json({ error: 'No active subscription' }, { status: 400 });
  }

  try {
    await cancelSubscription(shopDomain, session.accessToken, shopData.subscriptionId);
  } catch (e: any) {
    console.error('[billing/cancel] failed shop=%s:', shopDomain, e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  const { error: dbErr } = await supabase
    .from('Shop')
    .update({ billingPlan: 'free', subscriptionStatus: 'CANCELLED' })
    .eq('id', shopRow.id);
  if (dbErr) console.error('[billing/cancel] DB update failed:', dbErr.message);

  console.log('[billing/cancel] ok shop=%s (%dms)', shopDomain, Date.now() - t0);
  return NextResponse.json({ ok: true });
}
