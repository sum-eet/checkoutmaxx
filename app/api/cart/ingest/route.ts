import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/lib/supabase';
import { getShop } from '@/lib/shop';

// Rate limiting: 500 requests per minute per shop domain
const RATE_LIMIT = 500;
const RATE_WINDOW_MS = 60_000;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// GET is only for UptimeRobot health pings — real events come via POST
export async function GET() {
  return new NextResponse('ok', { status: 200, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  // Read body before responding — stream can't be consumed after response is sent
  let text: string;
  try {
    text = await req.text();
  } catch {
    return NextResponse.json({ ok: false }, { headers: CORS_HEADERS });
  }

  // Rate limit by shop domain (extracted cheaply from raw body before full parse)
  const shopDomainMatch = text.match(/"shopDomain"\s*:\s*"([^"]+)"/);
  const rateLimitKey = shopDomainMatch?.[1] ?? req.headers.get("x-forwarded-for") ?? "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(rateLimitKey);
  if (entry && now < entry.resetAt) {
    if (entry.count >= RATE_LIMIT) {
      return NextResponse.json({ ok: false }, { status: 429, headers: CORS_HEADERS });
    }
    entry.count++;
  } else {
    rateLimitMap.set(rateLimitKey, { count: 1, resetAt: now + RATE_WINDOW_MS });
  }

  // Respond immediately — sendBeacon doesn't care about response body
  waitUntil(processEvent(text));
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}

const SKIP_EVENTS = new Set([
  'cart_fetched', 'cart_unknown_endpoint', 'cart_fetch_error',
  'cart_xhr_error', 'cart_xhr_parse_error', 'cart_non_json_response',
]);

async function processEvent(text: string) {
  const start = Date.now();
  let shopDomain = 'unknown';
  let eventType: string | null = null;
  try {
    if (!text) return;

    const event = JSON.parse(text);
    eventType = event.eventType ?? null;
    shopDomain = event.shopDomain ?? 'unknown';
    const { sessionId, cartToken, occurredAt, url, device, country, utmSource, utmMedium, utmCampaign, utmReferrer, payload = {} } = event;

    console.log('[cart/ingest] hit', { shopDomain, eventType, sessionId: sessionId ?? null });

    if (!eventType || !shopDomain || !sessionId) {
      console.warn('[cart/ingest] reject', { reason: 'missing_fields', eventType, shopDomain, hasSession: !!sessionId });
      return;
    }
    if (SKIP_EVENTS.has(eventType)) return;

    const shopResult = await getShop(shopDomain);
    console.log('[cart/ingest] shop_lookup', { shopDomain, found: !!shopResult, shopId: shopResult?.id ?? null });
    if (!shopResult) {
      return;
    }
    const shopId = shopResult.id;

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

    const isCouponEvent = [
      'cart_coupon_applied', 'cart_coupon_failed',
      'cart_coupon_recovered', 'cart_coupon_removed',
      'checkout_coupon_applied', 'checkout_coupon_failed',
    ].includes(eventType);

    const couponSuccess =
      eventType === 'cart_coupon_applied' ||
      eventType === 'cart_coupon_recovered' ||
      eventType === 'checkout_coupon_applied' ? true
      : eventType === 'cart_coupon_failed' ||
        eventType === 'checkout_coupon_failed' ? false
      : null;

    if (isCouponEvent) {
      console.log('[cart/ingest] coupon event', {
        eventType,
        code: payload.code ?? null,
        failureReason: payload.failureReason ?? null,
        sessionId,
      });
    }

    let sanitisedUrl: string | null = null;
    try { sanitisedUrl = url ? new URL(url).pathname : null; } catch {}

    const { error: insertError } = await supabase.from('CartEvent').insert({
      id: crypto.randomUUID(),
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
      utmSource: typeof utmSource === 'string' ? utmSource : null,
      utmMedium: typeof utmMedium === 'string' ? utmMedium : null,
      utmCampaign: typeof utmCampaign === 'string' ? utmCampaign : null,
      utmReferrer: typeof utmReferrer === 'string' ? utmReferrer : null,
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString(),
    });

    if (insertError) {
      console.error('[cart/ingest] insert_fail', { code: (insertError as any).code, message: insertError.message, shopId, eventType });
    } else {
      console.log('[cart/ingest] ok', { shopId, eventType, cartToken: cartToken ?? null });
    }

  } catch (err: any) {
    console.error('[cart/ingest]', err);
  }
}
