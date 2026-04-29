export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAuthenticatedShopAndToken } from '@/lib/verify-session-token';
import { ensureShop } from '@/lib/shop';

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  console.log('[CMX claims] GET start');
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
  console.log('[CMX claims] ensureShop ok id=%s domain=%s', shop.id, authed.shopDomain);

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now);
  monthStart.setDate(monthStart.getDate() - 30);
  const hourStart = new Date(now.getTime() - 60 * 60 * 1000);

  const todayIso = todayStart.toISOString();
  const monthIso = monthStart.toISOString();
  const hourIso = hourStart.toISOString();

  console.log('[CMX claims] windows todayStart=%s monthStart=%s hourStart=%s', todayIso, monthIso, hourIso);

  // Coupons tried = explicit attempt events + successful checkout_completed with couponCode.
  // Supabase JS lacks a clean OR-with-IS-NOT-NULL across .in() + .not() in one call,
  // so split into two count queries and sum.
  const couponsTriedTodayPromise = Promise.all([
    supabase
      .from('CartEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .in('eventType', [
        'cart_coupon_applied',
        'cart_coupon_failed',
        'cart_coupon_recovered',
        'checkout_coupon_applied',
        'checkout_coupon_failed',
      ])
      .gte('occurredAt', todayIso),
    supabase
      .from('CartEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .eq('eventType', 'checkout_completed')
      .not('couponCode', 'is', null)
      .gte('occurredAt', todayIso),
  ]).then(([a, b]) => {
    console.log('[CMX claims] couponsTried split: attempts=%s completedWithCode=%s', a.count, b.count);
    return { count: (a.count ?? 0) + (b.count ?? 0) };
  });

  const [
    todayRes,
    monthRes,
    recoveryRecentRes,
    checkoutRecentRes,
    cvTodayRes,
    cvHourRes,
    coViewsRes,
    couponsTriedRes,
  ] = await Promise.all([
    // Claims today: orders today with a discount code applied at checkout
    supabase
      .from('CheckoutEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .eq('eventType', 'checkout_completed')
      .not('discountCode', 'is', null)
      .gte('occurredAt', todayIso),

    // Claims (30 days)
    supabase
      .from('CheckoutEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .eq('eventType', 'checkout_completed')
      .not('discountCode', 'is', null)
      .gte('occurredAt', monthIso),

    // Recovery-extension claims (existing surface)
    supabase
      .from('RecoveryEvent')
      .select(
        'id, recoveryCode, failureReason, source, cartValueAtFailure, discountValue, discountType, device, createdAt'
      )
      .eq('shopId', shop.id)
      .eq('recoveryAction', 'show_code')
      .order('createdAt', { ascending: false })
      .limit(50),

    // Manual-code orders (NEW — surfaces LUCKYCHECKOUT100-style usage)
    supabase
      .from('CheckoutEvent')
      .select('id, discountCode, totalPrice, occurredAt')
      .eq('shopId', shop.id)
      .eq('eventType', 'checkout_completed')
      .not('discountCode', 'is', null)
      .order('occurredAt', { ascending: false })
      .limit(50),

    // Cart views today — fixed: CartEvent (was wrongly querying CheckoutEvent)
    supabase
      .from('CartEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .eq('eventType', 'cart_viewed')
      .gte('occurredAt', todayIso),

    // Cart views last hour
    supabase
      .from('CartEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .eq('eventType', 'cart_viewed')
      .gte('occurredAt', hourIso),

    // Checkout views today
    supabase
      .from('CheckoutEvent')
      .select('*', { count: 'exact', head: true })
      .eq('shopId', shop.id)
      .eq('eventType', 'checkout_started')
      .gte('occurredAt', todayIso),

    // Coupons tried today (split-and-sum, see promise above)
    couponsTriedTodayPromise,
  ]);

  console.log(
    '[CMX claims] counts today=%s month=%s cartViewsToday=%s cartViewsHour=%s checkoutViewsToday=%s couponsTriedToday=%s',
    todayRes.count,
    monthRes.count,
    cvTodayRes.count,
    cvHourRes.count,
    coViewsRes.count,
    couponsTriedRes.count
  );
  console.log(
    '[CMX claims] recent rows recovery=%s checkout=%s',
    recoveryRecentRes.data?.length,
    checkoutRecentRes.data?.length
  );

  // Merge recovery-extension claims + manual-code orders into one timeline.
  type RecentRow = {
    id: string;
    recoveryCode: string | null;
    failureReason: string | null;
    source: string | null;
    cartValueAtFailure: number | null;
    discountValue: number | null;
    discountType: string | null;
    device: string | null;
    createdAt: string;
  };

  const recoveryRows: RecentRow[] = (recoveryRecentRes.data ?? []).map((r: any) => ({
    id: r.id,
    recoveryCode: r.recoveryCode ?? null,
    failureReason: r.failureReason ?? null,
    source: r.source ?? 'recovery',
    cartValueAtFailure: r.cartValueAtFailure ?? null,
    discountValue: r.discountValue ?? null,
    discountType: r.discountType ?? null,
    device: r.device ?? null,
    createdAt: r.createdAt,
  }));

  const manualRows: RecentRow[] = (checkoutRecentRes.data ?? []).map((r: any) => ({
    id: r.id,
    recoveryCode: r.discountCode ?? null,
    failureReason: null,
    source: 'manual_checkout',
    cartValueAtFailure:
      r.totalPrice != null ? Math.round(Number(r.totalPrice) * 100) : null,
    discountValue: null,
    discountType: null,
    device: null,
    createdAt: r.occurredAt,
  }));

  const recent = [...recoveryRows, ...manualRows]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50);

  console.log('[CMX claims] merged recent=%s (%dms)', recent.length, Date.now() - t0);

  return NextResponse.json({
    counts: {
      today: todayRes.count ?? 0,
      week: monthRes.count ?? 0,
      cartViewsToday: cvTodayRes.count ?? 0,
      cartViewsHour: cvHourRes.count ?? 0,
      checkoutViewsToday: coViewsRes.count ?? 0,
      couponsTriedToday: couponsTriedRes.count ?? 0,
    },
    recent,
  });
}
