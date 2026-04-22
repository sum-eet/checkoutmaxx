export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAuthenticatedShop } from '@/lib/verify-session-token';
import { getShop } from '@/lib/shop';

export async function GET(req: NextRequest) {
  console.log('[CMX claims] GET');
  const shopDomain = getAuthenticatedShop(req);
  if (!shopDomain) {
    console.warn('[CMX claims] unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const shop = await getShop(shopDomain);
  if (!shop) {
    console.warn('[CMX claims] no shop found:', shopDomain);
    return NextResponse.json({ error: 'No shop' }, { status: 400 });
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);

  const [todayRes, weekRes, recentRes, cvTodayRes, cvHourRes] = await Promise.all([
    supabase
      .from('RecoveryEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .eq('recoveryAction', 'show_code')
      .gte('createdAt', todayStart.toISOString()),
    supabase
      .from('RecoveryEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .eq('recoveryAction', 'show_code')
      .gte('createdAt', weekStart.toISOString()),
    supabase
      .from('RecoveryEvent')
      .select('id, recoveryCode, failureReason, source, cartValueAtFailure, discountValue, discountType, device, createdAt')
      .eq('shopId', shop.id)
      .eq('recoveryAction', 'show_code')
      .order('createdAt', { ascending: false })
      .limit(50),
    supabase
      .from('CheckoutEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .eq('eventType', 'cart_viewed')
      .gte('occurredAt', todayStart.toISOString()),
    supabase
      .from('CheckoutEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .eq('eventType', 'cart_viewed')
      .gte('occurredAt', new Date(Date.now() - 60 * 60 * 1000).toISOString()),
  ]);

  console.log('[CMX claims] today:', todayRes.count, 'week:', weekRes.count, 'recent rows:', recentRes.data?.length);
  console.log('[CMX claims] cartViews today:', cvTodayRes.count, 'hour:', cvHourRes.count);

  return NextResponse.json({
    counts: {
      today: todayRes.count ?? 0,
      week: weekRes.count ?? 0,
      cartViewsToday: cvTodayRes.count ?? 0,
      cartViewsHour: cvHourRes.count ?? 0,
    },
    recent: recentRes.data ?? [],
  });
}
