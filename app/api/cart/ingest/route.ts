import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

// Module-level cache — same Vercel instance handles many beacons from the same shop.
// Avoids a DB roundtrip on every single cart event.
const shopIdCache = new Map<string, string>(); // shopDomain -> shopId

async function resolveShopId(shopDomain: string): Promise<string | null> {
  const cached = shopIdCache.get(shopDomain);
  if (cached) return cached;
  const shop = await prisma.shop.findUnique({ where: { shopDomain }, select: { id: true } });
  if (shop) shopIdCache.set(shopDomain, shop.id);
  return shop?.id ?? null;
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
  // Respond immediately — sendBeacon doesn't wait for response
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

    // Skip noisy or error-only events to keep DB lean
    const SKIP_EVENTS = new Set([
      'cart_fetched',
      'cart_unknown_endpoint',
      'cart_fetch_error',
      'cart_xhr_error',
      'cart_xhr_parse_error',
      'cart_non_json_response',
    ]);
    if (SKIP_EVENTS.has(eventType)) return;

    const shopId = await resolveShopId(shopDomain);
    if (!shopId) return;

    // Sanitise lineItems — strip any PII, keep only product data.
    // cart_item_added puts items in payload.itemsAdded, all others in payload.lineItems.
    const rawLineItems = Array.isArray(payload.lineItems)
      ? payload.lineItems
      : Array.isArray(payload.itemsAdded)
      ? payload.itemsAdded
      : null;
    const sanitisedLineItems = rawLineItems
      ? rawLineItems.map((item: any) => ({
          productId: item.productId ?? null,
          variantId: item.variantId ?? null,
          productTitle: item.productTitle ?? null,
          price: item.price ?? null,
          quantity: item.quantity ?? null,
        }))
      : null;

    const isCouponEvent = [
      'cart_coupon_applied',
      'cart_coupon_failed',
      'cart_coupon_recovered',
      'cart_coupon_removed',
    ].includes(eventType);

    const couponSuccess =
      eventType === 'cart_coupon_applied' || eventType === 'cart_coupon_recovered'
        ? true
        : eventType === 'cart_coupon_failed'
        ? false
        : null;

    // Sanitise pageUrl — store pathname only, no query params (may contain discount codes)
    let sanitisedUrl: string | null = null;
    try {
      sanitisedUrl = url ? new URL(url).pathname : null;
    } catch {
      sanitisedUrl = null;
    }

    await prisma.cartEvent.create({
      data: {
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
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      },
    });
  } catch (err) {
    // Never surface errors — beacon is fire-and-forget
    console.error('[cart/ingest]', err);
  }
}
