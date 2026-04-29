export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAuthenticatedShopAndToken } from '@/lib/verify-session-token';
import { ensureShop } from '@/lib/shop';

export async function GET(req: NextRequest) {
  console.log('[CMX claims] GET');
  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn('[CMX claims] unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const shop = await ensureShop(authed.shopDomain, authed.token);
  if (!shop) {
    console.warn('[CMX claims] no shop found:', authed.shopDomain);
    return NextResponse.json({ error: 'No shop' }, { status: 400 });
  }
  console.log('[CMX claims] ensureShop ok id=%s', shop.id);

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 30);

  const [todayRes, weekRes, recentRes, cvTodayRes, cvHourRes, coViewsRes, couponsTriedRes] = await Promise.all([
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
    supabase
      .from('CheckoutEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .eq('eventType', 'checkout_started')
      .gte('occurredAt', todayStart.toISOString()),
    supabase
      .from('CartEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .in('eventType', ['cart_coupon_applied', 'cart_coupon_failed', 'cart_coupon_recovered', 'checkout_coupon_applied', 'checkout_coupon_failed'])
      .gte('occurredAt', todayStart.toISOString()),
  ]);

  console.log('[CMX claims] today:', todayRes.count, 'week:', weekRes.count, 'recent rows:', recentRes.data?.length);
  console.log('[CMX claims] cartViews today:', cvTodayRes.count, 'hour:', cvHourRes.count, 'checkoutViews:', coViewsRes.count, 'couponsTried:', couponsTriedRes.count);

  return NextResponse.json({
    counts: {
      today: todayRes.count ?? 0,
      week: weekRes.count ?? 0,
      cartViewsToday: cvTodayRes.count ?? 0,
      cartViewsHour: cvHourRes.count ?? 0,
      checkoutViewsToday: coViewsRes.count ?? 0,
      couponsTriedToday: couponsTriedRes.count ?? 0,
    },
    recent: recentRes.data ?? [],
  });
}
