export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAuthenticatedShopAndToken } from '@/lib/verify-session-token';
import { ensureShop } from '@/lib/shop';

export async function GET(req: NextRequest) {
  console.log('[CMX billing/status] GET');
  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn('[CMX billing/status] unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const shop = await ensureShop(authed.shopDomain, authed.token);
  if (!shop) {
    console.warn('[CMX billing/status] no shop:', authed.shopDomain);
    return NextResponse.json({ error: 'No shop' }, { status: 400 });
  }
  console.log('[CMX billing/status] ensureShop ok id=%s', shop.id);

  const { data } = await supabase
    .from('Shop')
    .select('billingPlan, subscriptionStatus, subscriptionId, trialEndsAt')
    .eq('id', shop.id)
    .maybeSingle();

  console.log('[CMX billing/status] plan=%s status=%s shop=%s', data?.billingPlan, data?.subscriptionStatus, authed.shopDomain);

  return NextResponse.json({
    plan: data?.billingPlan ?? 'free',
    status: data?.subscriptionStatus ?? null,
    subscriptionId: data?.subscriptionId ?? null,
    trialEndsAt: data?.trialEndsAt ?? null,
  });
}
