export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAuthenticatedShopAndToken } from '@/lib/verify-session-token';
import { ensureShop } from '@/lib/shop';

export async function GET(req: NextRequest) {
  console.log('[CMX sessions] GET');
  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn('[CMX sessions] unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const shop = await ensureShop(authed.shopDomain, authed.token);
  if (!shop) {
    console.warn('[CMX sessions] no shop:', authed.shopDomain);
    return NextResponse.json({ error: 'No shop' }, { status: 400 });
  }
  console.log('[CMX sessions] ensureShop ok id=%s', shop.id);

  const since = new Date();
  since.setDate(since.getDate() - 7);

  const { data: cartRows, error: cartErr } = await supabase
    .from('CartEvent')
    .select('sessionId, eventType, couponCode, couponSuccess, cartValue, lineItems, device, country, occurredAt')
    .eq('shopId', shop.id)
    .gte('occurredAt', since.toISOString())
    .order('occurredAt', { ascending: true })
    .limit(2000);

  if (cartErr) {
    console.error('[CMX sessions] cart query error:', cartErr);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  console.log('[CMX sessions] cartRows:', cartRows?.length ?? 0);

  const bySession = new Map<string, {
    sessionId: string;
    startedAt: string;
    lastSeenAt: string;
    device: string | null;
    country: string | null;
    cartValue: number;
    lineItems: any[];
    couponAttempts: { code: string | null; success: boolean | null; at: string }[];
    reachedCheckout: boolean;
    completed: boolean;
  }>();

  for (const r of cartRows ?? []) {
    if (!bySession.has(r.sessionId)) {
      bySession.set(r.sessionId, {
        sessionId: r.sessionId,
        startedAt: r.occurredAt,
        lastSeenAt: r.occurredAt,
        device: r.device,
        country: r.country,
        cartValue: r.cartValue ?? 0,
        lineItems: [],
        couponAttempts: [],
        reachedCheckout: false,
        completed: false,
      });
    }
    const s = bySession.get(r.sessionId)!;
    s.lastSeenAt = r.occurredAt;
    if (r.cartValue) s.cartValue = r.cartValue;
    if (Array.isArray(r.lineItems) && r.lineItems.length > 0) {
      s.lineItems = r.lineItems;
    }
    if (
      r.eventType === 'cart_coupon_applied' ||
      r.eventType === 'cart_coupon_failed' ||
      r.eventType === 'cart_coupon_recovered' ||
      r.eventType === 'checkout_coupon_applied' ||
      r.eventType === 'checkout_coupon_failed'
    ) {
      s.couponAttempts.push({ code: r.couponCode, success: r.couponSuccess, at: r.occurredAt });
    }
    if (r.eventType === 'cart_checkout_clicked') s.reachedCheckout = true;
  }

  const sessionIds = Array.from(bySession.keys()).slice(0, 200);
  if (sessionIds.length) {
    const { data: coRows } = await supabase
      .from('CheckoutEvent')
      .select('sessionId, eventType')
      .eq('shopId', shop.id)
      .in('sessionId', sessionIds);
    console.log('[CMX sessions] checkoutRows:', coRows?.length ?? 0);
    for (const r of coRows ?? []) {
      const s = bySession.get(r.sessionId);
      if (!s) continue;
      if (r.eventType === 'checkout_started') s.reachedCheckout = true;
      if (r.eventType === 'checkout_completed') s.completed = true;
    }
  }

  const sessions = Array.from(bySession.values())
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())
    .slice(0, 100);

  console.log('[CMX sessions] returning', sessions.length, 'sessions');
  return NextResponse.json({ sessions });
}
