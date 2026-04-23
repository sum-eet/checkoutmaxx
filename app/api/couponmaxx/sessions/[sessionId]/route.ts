export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getAuthenticatedShopAndToken } from '@/lib/verify-session-token';
import { ensureShop } from '@/lib/shop';

export async function GET(req: NextRequest, { params }: { params: { sessionId: string } }) {
  const { sessionId } = params;
  console.log('[CMX session-detail] GET', { sessionId });

  const authed = getAuthenticatedShopAndToken(req);
  if (!authed) {
    console.warn('[CMX session-detail] unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const shop = await ensureShop(authed.shopDomain, authed.token);
  if (!shop) {
    console.warn('[CMX session-detail] no shop:', authed.shopDomain);
    return NextResponse.json({ error: 'No shop' }, { status: 400 });
  }
  console.log('[CMX session-detail] ensureShop ok id=%s', shop.id);

  const [cartRes, checkoutRes] = await Promise.all([
    supabase
      .from('CartEvent')
      .select('eventType, couponCode, couponSuccess, couponFailReason, cartValue, lineItems, device, country, pageUrl, occurredAt')
      .eq('shopId', shop.id)
      .eq('sessionId', sessionId)
      .order('occurredAt', { ascending: true })
      .limit(500),
    supabase
      .from('CheckoutEvent')
      .select('eventType, discountCode, errorMessage, totalPrice, currency, occurredAt')
      .eq('shopId', shop.id)
      .eq('sessionId', sessionId)
      .order('occurredAt', { ascending: true })
      .limit(200),
  ]);

  const cartRows = cartRes.data ?? [];
  const checkoutRows = checkoutRes.data ?? [];

  console.log('[CMX session-detail] cartRows:', cartRows.length, 'checkoutRows:', checkoutRows.length, 'sessionId:', sessionId);

  if (checkoutRows.length === 0 && cartRows.some(r => r.eventType === 'cart_checkout_clicked')) {
    console.warn('[CMX session-detail] no CheckoutEvent rows despite checkout_clicked — sessionId bridge miss', { sessionId });
  }

  // Most recent CartEvent with non-empty lineItems
  let cartContents: any[] | null = null;
  for (let i = cartRows.length - 1; i >= 0; i--) {
    if (Array.isArray(cartRows[i].lineItems) && (cartRows[i].lineItems as any[]).length > 0) {
      cartContents = cartRows[i].lineItems as any[];
      break;
    }
  }

  const events = [
    ...cartRows.map(r => ({ ...r, source: 'cart' as const })),
    ...checkoutRows.map(r => ({ ...r, source: 'checkout' as const })),
  ].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

  return NextResponse.json({ events, cartContents });
}
