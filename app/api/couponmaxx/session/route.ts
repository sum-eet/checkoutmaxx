export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getShopFromRequest } from "@/lib/verify-session-token";

type TimelineEvent = {
  source: 'cart' | 'checkout';
  eventType: string;
  occurredAt: string;
  label: string;
  detail: string | null;
  sentiment: 'positive' | 'negative' | 'neutral';
};

const CART_LABELS: Record<string, (e: Record<string, unknown>) => { label: string; detail: string | null; sentiment: TimelineEvent['sentiment'] }> = {
  cart_item_added:       (e) => ({ label: 'Added to cart', detail: `Cart: $${((e.cartValue as number ?? 0) / 100).toFixed(2)}`, sentiment: 'positive' }),
  cart_item_changed:     (e) => ({ label: `Changed quantity`, detail: `Cart: $${((e.cartValue as number ?? 0) / 100).toFixed(2)}`, sentiment: 'neutral' }),
  cart_item_removed:     (e) => ({ label: 'Removed item', detail: `Cart: $${((e.cartValue as number ?? 0) / 100).toFixed(2)}`, sentiment: 'neutral' }),
  cart_coupon_applied:   (e) => ({ label: `Applied ${e.couponCode ?? ''}`, detail: e.discountAmount ? `Saved $${((e.discountAmount as number) / 100).toFixed(2)}` : null, sentiment: 'positive' }),
  cart_coupon_failed:    (e) => ({ label: `Tried ${e.couponCode ?? ''}`, detail: 'Not applicable', sentiment: 'negative' }),
  cart_coupon_recovered: (e) => ({ label: `Unlocked ${e.couponCode ?? ''}`, detail: `Added items · Saved $${((e.discountAmount as number ?? 0) / 100).toFixed(2)}`, sentiment: 'positive' }),
  cart_coupon_removed:   (e) => ({ label: `Removed ${e.couponCode ?? ''}`, detail: null, sentiment: 'neutral' }),
  cart_checkout_clicked: (e) => ({ label: 'Clicked checkout', detail: `Cart: $${((e.cartValue as number ?? 0) / 100).toFixed(2)}`, sentiment: 'positive' }),
  cart_page_hidden:      (e) => ({ label: 'Left the page', detail: (e.pageUrl as string) ?? null, sentiment: 'neutral' }),
  cart_drawer_opened:    () => ({ label: 'Opened cart drawer', detail: null, sentiment: 'neutral' }),
  cart_atc_clicked:      (e) => ({ label: 'Clicked add to cart', detail: (e.pageUrl as string) ?? null, sentiment: 'neutral' }),
};

const CHECKOUT_LABELS: Record<string, string> = {
  checkout_started:              'Reached checkout',
  checkout_contact_submitted:    'Filled contact info',
  checkout_address_submitted:    'Filled shipping address',
  checkout_shipping_submitted:   'Selected shipping',
  payment_submitted:             'Entered payment',
  checkout_completed:            'Order completed ✓',
  alert_displayed:               'Checkout alert',
};

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const shopDomain = getShopFromRequest(req);
  const sessionId = p.get('sessionId');
  if (!shopDomain || !sessionId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const { data: shop } = await supabase.from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const [{ data: cartEvs }, { data: checkoutEvs }] = await Promise.all([
    supabase.from('CartEvent')
      .select('sessionId, eventType, cartValue, cartItemCount, couponCode, couponSuccess, couponRecovered, discountAmount, lineItems, occurredAt, device, country, pageUrl, utmSource, utmMedium, utmCampaign')
      .eq('shopId', shop.id).eq('sessionId', sessionId).order('occurredAt', { ascending: true }).limit(500),
    supabase.from('CheckoutEvent')
      .select('sessionId, eventType, totalPrice, occurredAt, errorMessage')
      .eq('shopId', shop.id).eq('sessionId', sessionId).order('occurredAt', { ascending: true }).limit(200),
  ]);

  const timeline: TimelineEvent[] = [];

  for (const e of cartEvs ?? []) {
    const mapper = CART_LABELS[e.eventType];
    const { label, detail, sentiment } = mapper
      ? mapper(e as unknown as Record<string, unknown>)
      : { label: e.eventType, detail: null, sentiment: 'neutral' as const };
    timeline.push({ source: 'cart', eventType: e.eventType, occurredAt: e.occurredAt, label, detail, sentiment });
  }

  for (const e of checkoutEvs ?? []) {
    const base = CHECKOUT_LABELS[e.eventType] ?? e.eventType;
    const label = e.eventType === 'alert_displayed' ? `Checkout alert: ${(e as unknown as Record<string, unknown>).errorMessage ?? ''}` : base;
    const sentiment: TimelineEvent['sentiment'] = e.eventType === 'checkout_completed' ? 'positive' : e.eventType === 'alert_displayed' ? 'negative' : 'neutral';
    timeline.push({ source: 'checkout', eventType: e.eventType, occurredAt: e.occurredAt, label, detail: null, sentiment });
  }

  timeline.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

  return NextResponse.json({ timeline });
}
