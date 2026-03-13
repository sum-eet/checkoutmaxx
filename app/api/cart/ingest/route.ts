import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const shopCache = new Map<string, string>();

async function resolveShopId(shopDomain: string): Promise<string | null> {
  if (shopCache.has(shopDomain)) return shopCache.get(shopDomain)!;
  const { data } = await supabase
    .from('Shop')
    .select('id')
    .eq('shopDomain', shopDomain)
    .single();
  if (data?.id) shopCache.set(shopDomain, data.id);
  return data?.id ?? null;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  void processEvent(req);
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}

async function processEvent(req: NextRequest) {
  try {
    const text = await req.text();
    if (!text) return;

    const event = JSON.parse(text);
    const { eventType, shopDomain, sessionId, cartToken, occurredAt, url, device, country, payload = {} } = event;

    if (!eventType || !shopDomain || !sessionId) return;

    const SKIP_EVENTS = new Set([
      'cart_fetched', 'cart_unknown_endpoint', 'cart_fetch_error',
      'cart_xhr_error', 'cart_xhr_parse_error', 'cart_non_json_response',
    ]);
    if (SKIP_EVENTS.has(eventType)) return;

    const shopId = await resolveShopId(shopDomain);
    if (!shopId) return;

    const rawLineItems = Array.isArray(payload.lineItems)
      ? payload.lineItems
      : Array.isArray(payload.itemsAdded)
      ? payload.itemsAdded
      : null;

    const sanitisedLineItems = rawLineItems?.map((item: any) => ({
      productId: item.productId ?? null,
      variantId: item.variantId ?? null,
      productTitle: item.productTitle ?? null,
      price: item.price ?? null,
      quantity: item.quantity ?? null,
    })) ?? null;

    const isCouponEvent = ['cart_coupon_applied', 'cart_coupon_failed',
      'cart_coupon_recovered', 'cart_coupon_removed'].includes(eventType);

    const couponSuccess =
      eventType === 'cart_coupon_applied' || eventType === 'cart_coupon_recovered' ? true
      : eventType === 'cart_coupon_failed' ? false
      : null;

    let sanitisedUrl: string | null = null;
    try { sanitisedUrl = url ? new URL(url).pathname : null; } catch {}

    await supabase.from('CartEvent').insert({
      shopId,
      sessionId,
      cartToken: cartToken ?? '',
      eventType,
      cartValue: typeof payload.cartValue === 'number' ? payload.cartValue : null,
      cartItemCount: typeof payload.cartItemCount === 'number' ? payload.cartItemCount : null,
      lineItems: sanitisedLineItems,
      couponCode: isCouponEvent ? (payload.code ?? null) : null,
      couponSuccess,
      couponFailReason: payload.failureReason ?? null,
      couponRecovered: payload.retriedAfterFail ?? null,
      discountAmount: typeof payload.discountAmount === 'number' ? payload.discountAmount : null,
      lineIndex: typeof payload.lineIndex === 'number' ? payload.lineIndex : null,
      newQuantity: typeof payload.newQuantity === 'number' ? payload.newQuantity : null,
      pageUrl: sanitisedUrl,
      device: typeof device === 'string' ? device : null,
      country: typeof country === 'string' ? country : null,
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
    });

  } catch (err) {
    console.error('[cart/ingest]', err);
  }
}
