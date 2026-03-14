export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  buildSessionSummary,
  buildOutcome,
  type CartSessionV2,
  type CouponSummary,
  type LineItem,
} from '@/lib/v2/session-summary';

const CART_LABEL_MAP: Record<string, string> = {
  cart_item_added: 'Added to cart',
  cart_item_changed: 'Changed quantity',
  cart_item_removed: 'Removed item',
  cart_bulk_updated: 'Cart updated',
  cart_coupon_applied: 'Applied coupon',
  cart_coupon_failed: 'Tried coupon',
  cart_coupon_recovered: 'Unlocked coupon',
  cart_coupon_removed: 'Removed coupon',
  cart_checkout_clicked: 'Clicked checkout',
  cart_page_hidden: 'Left the page',
  cart_drawer_opened: 'Opened cart drawer',
  cart_drawer_closed: 'Closed cart drawer',
  cart_atc_clicked: 'Clicked add to cart',
  cart_session_started: 'Session started',
};

const CHECKOUT_LABEL_MAP: Record<string, string> = {
  checkout_started: 'Reached checkout',
  checkout_contact_info_submitted: 'Filled contact info',
  checkout_address_info_submitted: 'Filled shipping address',
  checkout_shipping_info_submitted: 'Selected shipping method',
  payment_info_submitted: 'Entered payment',
  checkout_completed: 'Order completed',
  alert_displayed: 'Checkout alert',
  ui_extension_errored: 'Extension error',
};

function getSentiment(eventType: string): 'positive' | 'negative' | 'neutral' {
  if (['cart_coupon_applied', 'cart_coupon_recovered', 'checkout_completed'].includes(eventType))
    return 'positive';
  if (eventType === 'cart_coupon_failed') return 'negative';
  return 'neutral';
}

function buildCartDetail(e: Record<string, unknown>): string | null {
  switch (e.eventType as string) {
    case 'cart_item_added': {
      const li = (e.lineItems as { productTitle?: string }[] | null)?.[0];
      const val = e.cartValue ? `  ·  Cart: $${((e.cartValue as number) / 100).toFixed(2)}` : '';
      return li?.productTitle ? `${li.productTitle}${val}` : val || null;
    }
    case 'cart_item_changed':
      return e.cartValue ? `Cart: $${((e.cartValue as number) / 100).toFixed(2)}` : null;
    case 'cart_item_removed':
      return e.cartValue ? `Cart: $${((e.cartValue as number) / 100).toFixed(2)}` : null;
    case 'cart_coupon_applied':
      return e.discountAmount ? `Saved $${((e.discountAmount as number) / 100).toFixed(2)}` : null;
    case 'cart_coupon_failed':
      return `Code: ${e.couponCode ?? ''}  ·  Not applicable`;
    case 'cart_coupon_recovered': {
      const saving = e.discountAmount ? `Saved $${((e.discountAmount as number) / 100).toFixed(2)}` : '';
      return `Added items to qualify${saving ? '  ·  ' + saving : ''}`;
    }
    case 'cart_coupon_removed':
      return null;
    case 'cart_checkout_clicked':
      return e.cartValue ? `Cart: $${((e.cartValue as number) / 100).toFixed(2)}` : null;
    case 'cart_page_hidden':
    case 'cart_atc_clicked':
    case 'cart_session_started':
    case 'cart_drawer_opened':
      return (e.pageUrl as string) ?? null;
    default:
      return (e.pageUrl as string) ?? null;
  }
}

function buildCartLabel(e: Record<string, unknown>): string {
  const base = CART_LABEL_MAP[e.eventType as string] ?? (e.eventType as string);
  switch (e.eventType as string) {
    case 'cart_coupon_applied':
    case 'cart_coupon_failed':
    case 'cart_coupon_recovered':
    case 'cart_coupon_removed':
      return e.couponCode ? `${base.replace('coupon', String(e.couponCode))}` : base;
    default:
      return base;
  }
}

export async function GET(req: NextRequest) {
  const shopDomain = req.nextUrl.searchParams.get('shop');
  const sessionId = req.nextUrl.searchParams.get('sessionId');
  if (!shopDomain || !sessionId)
    return NextResponse.json({ error: 'Missing shop or sessionId' }, { status: 400 });

  const { data: shop } = await supabase
    .from('Shop')
    .select('id')
    .eq('shopDomain', shopDomain)
    .eq('isActive', true)
    .single();
  if (!shop) return NextResponse.json({ error: 'Shop not found' }, { status: 404 });

  const [cartRes, checkoutRes] = await Promise.all([
    supabase
      .from('CartEvent')
      .select('sessionId, eventType, cartValue, cartItemCount, lineItems, couponCode, couponSuccess, couponRecovered, discountAmount, device, country, occurredAt, pageUrl, newQuantity')
      .eq('shopId', shop.id)
      .eq('sessionId', sessionId)
      .order('occurredAt', { ascending: true }),
    supabase
      .from('CheckoutEvent')
      .select('sessionId, eventType, totalPrice, occurredAt, errorMessage, discountCode')
      .eq('shopId', shop.id)
      .eq('sessionId', sessionId)
      .order('occurredAt', { ascending: true }),
  ]);

  const cartEvents = cartRes.data ?? [];
  const checkoutEvents = checkoutRes.data ?? [];

  if (cartEvents.length === 0 && checkoutEvents.length === 0) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // Build session summary
  let products: LineItem[] = [];
  for (let i = cartEvents.length - 1; i >= 0; i--) {
    if (cartEvents[i].lineItems && Array.isArray(cartEvents[i].lineItems) && (cartEvents[i].lineItems as any[]).length > 0) {
      products = cartEvents[i].lineItems as LineItem[];
      break;
    }
  }

  let cartValueStart: number | null = null;
  let cartValueEnd: number | null = null;
  let cartItemCount: number | null = null;
  for (const e of cartEvents) {
    if ((e.cartValue ?? 0) > 0) {
      if (cartValueStart === null) cartValueStart = (e.cartValue ?? 0) / 100;
      cartValueEnd = (e.cartValue ?? 0) / 100;
    }
    if ((e.cartItemCount ?? 0) > 0) cartItemCount = e.cartItemCount ?? null;
  }

  const couponMap = new Map<string, CouponSummary>();
  for (const e of cartEvents) {
    if (!e.couponCode) continue;
    const code = e.couponCode.toUpperCase();
    if (e.couponRecovered) {
      couponMap.set(code, { code, status: 'recovered' });
    } else if (e.couponSuccess === true) {
      if (!couponMap.has(code) || couponMap.get(code)!.status === 'failed') {
        couponMap.set(code, { code, status: 'applied' });
      }
    } else if (e.couponSuccess === false && !couponMap.has(code)) {
      couponMap.set(code, { code, status: 'failed' });
    }
  }

  const hasCompleted = checkoutEvents.some((e) => e.eventType === 'checkout_completed');
  const hasCheckout =
    cartEvents.some((e) => e.eventType === 'cart_checkout_clicked') ||
    checkoutEvents.some((e) => e.eventType === 'checkout_started');
  const hasProducts = cartEvents.some(
    (e) => (e.cartValue ?? 0) > 0 || (e.cartItemCount ?? 0) > 0
  );

  const allTimes = [
    ...cartEvents.map((e) => new Date(e.occurredAt).getTime()),
    ...checkoutEvents.map((e) => new Date(e.occurredAt).getTime()),
  ];
  const firstAt = Math.min(...allTimes);
  const lastAt = Math.max(...allTimes);

  const country = cartEvents.find((e) => e.country)?.country ?? null;
  const device = cartEvents.find((e) => e.device)?.device ?? null;

  const coupons = Array.from(couponMap.values());
  const outcome = buildOutcome(hasCompleted, hasCheckout, hasProducts);

  const session: CartSessionV2 = {
    sessionId,
    startTime: new Date(firstAt).toISOString(),
    duration: lastAt - firstAt,
    country,
    device,
    products,
    cartItemCount,
    cartValueStart,
    cartValueEnd,
    coupons,
    outcome,
    summary: '',
  };
  session.summary = buildSessionSummary(session);

  // Build merged timeline
  const cartRows = cartEvents.map((e) => ({
    source: 'cart' as const,
    eventType: e.eventType,
    occurredAt: e.occurredAt,
    label: buildCartLabel(e as Record<string, unknown>),
    detail: buildCartDetail(e as Record<string, unknown>),
    sentiment: getSentiment(e.eventType),
  }));

  const checkoutRows = checkoutEvents.map((e) => {
    let label = CHECKOUT_LABEL_MAP[e.eventType] ?? e.eventType;
    if (e.eventType === 'alert_displayed' && e.errorMessage) {
      label = `Checkout alert: ${e.errorMessage}`;
    }
    return {
      source: 'checkout' as const,
      eventType: e.eventType,
      occurredAt: e.occurredAt,
      label,
      detail: e.totalPrice != null ? `Total: $${e.totalPrice.toFixed(2)}` : null,
      sentiment: getSentiment(e.eventType),
    };
  });

  const timeline = [...cartRows, ...checkoutRows].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  );

  return NextResponse.json({ session, timeline });
}
