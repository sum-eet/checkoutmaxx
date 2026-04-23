export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAuthenticatedShop } from '@/lib/verify-session-token';
import { getShop } from '@/lib/shop';

export async function GET(req: NextRequest) {
  console.log('[CMX billing/status] GET');
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) {
    console.warn('[CMX billing/status] unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const shop = await getShop(shopDomain);
  if (!shop) {
    console.warn('[CMX billing/status] no shop:', shopDomain);
    return NextResponse.json({ error: 'No shop' }, { status: 400 });
  }

  const { data } = await supabase
    .from('Shop')
    .select('billingPlan, subscriptionStatus, subscriptionId, trialEndsAt')
    .eq('id', shop.id)
    .maybeSingle();

  console.log('[CMX billing/status] plan=%s status=%s shop=%s', data?.billingPlan, data?.subscriptionStatus, shopDomain);

  return NextResponse.json({
    plan: data?.billingPlan ?? 'free',
    status: data?.subscriptionStatus ?? null,
    subscriptionId: data?.subscriptionId ?? null,
    trialEndsAt: data?.trialEndsAt ?? null,
  });
}
