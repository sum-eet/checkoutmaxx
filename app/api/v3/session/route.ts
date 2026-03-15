export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function fmt(cents: number): string {
  return '$' + (cents / 100).toFixed(2);
}

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!shopDomain || !sessionId) return NextResponse.json({ error: 'Missing params' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop').select('id').eq('shopDomain', shopDomain).eq('isActive', true).single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const [cartRes, checkoutRes] = await Promise.all([
    supabase.from('CartEvent').select('*').eq('shopId', shop.id).eq('sessionId', sessionId)
      .order('occurredAt', { ascending: true }),
    supabase.from('CheckoutEvent').select('eventType, occurredAt, totalPrice')
      .eq('shopId', shop.id).eq('sessionId', sessionId)
      .order('occurredAt', { ascending: true }),
  ]);

  const cartEvents = cartRes.data ?? [];
  const checkoutEvents = checkoutRes.data ?? [];

  type TimelineEvent = {
    source: 'cart' | 'checkout';
    eventType: string;
    occurredAt: string;
    label: string;
    detail: string | null;
    sentiment: 'positive' | 'negative' | 'neutral';
  };

  const timeline: TimelineEvent[] = [];

  for (const ev of cartEvents) {
    let label = '';
    let detail: string | null = null;
    let sentiment: TimelineEvent['sentiment'] = 'neutral';

    switch (ev.eventType) {
      case 'cart_item_added':
        label = 'Added item to cart';
        detail = ev.cartValue != null && ev.cartValue > 0 ? `Cart: ${fmt(ev.cartValue)}` : null;
        break;
      case 'cart_item_changed':
        label = `Changed quantity to ${ev.newQuantity ?? '?'}`;
        detail = ev.cartValue != null && ev.cartValue > 0 ? `Cart: ${fmt(ev.cartValue)}` : null;
        break;
      case 'cart_item_removed':
        label = 'Removed item';
        detail = ev.cartValue != null && ev.cartValue > 0 ? `Cart: ${fmt(ev.cartValue)}` : null;
        break;
      case 'cart_coupon_applied':
        label = `Applied coupon ${ev.couponCode}`;
        detail = ev.discountAmount != null ? `Saved ${fmt(ev.discountAmount)}` : null;
        sentiment = 'positive';
        break;
      case 'cart_coupon_failed':
        label = `Tried coupon ${ev.couponCode}`;
        detail = 'Not applicable';
        sentiment = 'negative';
        break;
      case 'cart_coupon_recovered':
        label = `Coupon ${ev.couponCode} unlocked`;
        detail = ev.discountAmount != null ? `Added items to qualify — saved ${fmt(ev.discountAmount)}` : 'Added items to qualify';
        sentiment = 'positive';
        break;
      case 'cart_coupon_removed':
        label = `Removed coupon ${ev.couponCode}`;
        break;
      case 'cart_checkout_clicked':
        label = 'Clicked checkout';
        detail = ev.pageUrl ?? null;
        break;
      case 'cart_page_hidden':
        label = 'Left the page';
        detail = ev.pageUrl ?? null;
        break;
      case 'cart_bulk_updated':
        label = ev.cartValue != null && ev.cartValue > 0 ? 'Cart updated' : 'Opened page';
        detail = [
          ev.cartValue != null && ev.cartValue > 0 ? `Cart: ${fmt(ev.cartValue)}` : null,
          ev.pageUrl ?? null,
        ].filter(Boolean).join(' · ') || null;
        break;
      case 'cart_cleared':
        label = 'Cleared cart';
        detail = ev.pageUrl ?? null;
        break;
      case 'cart_drawer_opened':
        label = 'Opened cart drawer';
        detail = ev.pageUrl ?? null;
        break;
      case 'cart_drawer_closed':
        label = 'Closed cart drawer';
        detail = ev.pageUrl ?? null;
        break;
      case 'cart_atc_clicked':
        label = 'Clicked add to cart';
        detail = ev.pageUrl ?? null;
        break;
      default:
        label = ev.eventType;
        detail = ev.pageUrl ?? null;
    }

    if (ev.pageUrl && ['cart_item_added', 'cart_item_changed', 'cart_item_removed'].includes(ev.eventType)) {
      detail = detail ? `${detail} · ${ev.pageUrl}` : ev.pageUrl;
    }

    timeline.push({ source: 'cart', eventType: ev.eventType, occurredAt: ev.occurredAt, label, detail, sentiment });
  }

  const checkoutLabels: Record<string, string> = {
    checkout_started: 'Reached checkout',
    checkout_contact_info_submitted: 'Filled contact info',
    checkout_address_info_submitted: 'Filled shipping address',
    checkout_shipping_info_submitted: 'Selected shipping method',
    payment_info_submitted: 'Entered payment',
    checkout_completed: 'Order completed',
  };

  for (const ev of checkoutEvents) {
    timeline.push({
      source: 'checkout',
      eventType: ev.eventType,
      occurredAt: ev.occurredAt,
      label: checkoutLabels[ev.eventType] ?? ev.eventType,
      detail: ev.eventType === 'checkout_completed' && ev.totalPrice != null ? `$${Number(ev.totalPrice).toFixed(2)}` : null,
      sentiment: ev.eventType === 'checkout_completed' ? 'positive' : 'neutral',
    });
  }

  timeline.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());

  return NextResponse.json({ timeline });
}
