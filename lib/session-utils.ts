/**
 * V3 session building utilities.
 * Shared across /api/v3/overview and /api/v3/sessions.
 */

export type CouponV3 = {
  code: string;
  status: 'applied' | 'failed' | 'recovered';
  discountAmount: number | null; // cents
};

export type LineItemV3 = {
  productTitle: string | null;
  price: number | null; // cents
  quantity: number;
};

export type CartSessionV3 = {
  sessionId: string;
  startTime: string;
  duration: number; // ms
  country: string | null;
  device: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  products: LineItemV3[];
  cartItemCount: number | null;
  cartValueStart: number | null; // dollars
  cartValueEnd: number | null;   // dollars
  coupons: CouponV3[];
  outcome: 'ordered' | 'checkout' | 'abandoned';
  summary: string;
};

/** V3 source buckets (different from V2 which uses raw utm values) */
export function deriveSourceV3(utmSource: string | null, utmMedium: string | null): string {
  const src = (utmSource ?? '').toLowerCase();
  const med = (utmMedium ?? '').toLowerCase();
  if (!src && !med) return 'Direct';
  if (src === 'google' || src === 'bing') return 'Paid search';
  if (src === 'instagram' || src === 'facebook' || src === 'fb' || src === 'tiktok' || src === 'tiktok_ads') return 'Social';
  if (med === 'email' || src === 'klaviyo' || src === 'mailchimp' || src === 'email') return 'Email';
  if (src) return src.charAt(0).toUpperCase() + src.slice(1);
  return 'Other';
}

export function buildSessionSummaryV3(s: CartSessionV3): string {
  const product = s.products[0]?.productTitle ?? null;
  const productStr =
    s.products.length > 1
      ? `${product ?? 'item'} + ${s.products.length - 1} more`
      : product ?? null;

  const coupon = s.coupons[0] ?? null;
  let couponStr = '';
  if (coupon) {
    if (coupon.status === 'applied') couponStr = `, applied ${coupon.code}`;
    else if (coupon.status === 'recovered') couponStr = `, unlocked ${coupon.code} after adding items`;
    else couponStr = `, tried ${coupon.code} (failed)`;
  }

  if (s.outcome === 'ordered') return `${productStr ?? 'items'}${couponStr}, completed order`;
  if (s.outcome === 'checkout') return `${productStr ?? 'items'}${couponStr}, reached checkout`;
  if (s.products.length > 0) return `${productStr}${couponStr}, abandoned`;
  return 'Browsed without adding to cart';
}

type RawCartEvent = {
  sessionId: string;
  eventType: string;
  cartValue: number | null;
  cartItemCount: number | null;
  lineItems: unknown;
  couponCode: string | null;
  couponSuccess: boolean | null;
  couponRecovered: boolean | null;
  discountAmount: number | null;
  device: string | null;
  country: string | null;
  occurredAt: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
};

type RawCheckoutEvent = {
  sessionId: string;
  eventType: string;
  totalPrice: number | null;
  occurredAt: string;
};

export function buildSessionsFromEvents(
  cartEvents: RawCartEvent[],
  checkoutEvents: RawCheckoutEvent[],
): CartSessionV3[] {
  // Group cart events by session
  const bySession = new Map<string, RawCartEvent[]>();
  for (const e of cartEvents) {
    if (!bySession.has(e.sessionId)) bySession.set(e.sessionId, []);
    bySession.get(e.sessionId)!.push(e);
  }

  // Group checkout events by session
  const checkoutBySession = new Map<string, RawCheckoutEvent[]>();
  for (const e of checkoutEvents) {
    if (!checkoutBySession.has(e.sessionId)) checkoutBySession.set(e.sessionId, []);
    checkoutBySession.get(e.sessionId)!.push(e);
  }

  const sessions: CartSessionV3[] = [];

  for (const [sessionId, evs] of Array.from(bySession)) {
    // Sort ascending for logic, descending already from query
    const evsAsc = [...evs].sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    const checkEvs = checkoutBySession.get(sessionId) ?? [];

    // Products from last event with lineItems
    let products: LineItemV3[] = [];
    for (let i = evsAsc.length - 1; i >= 0; i--) {
      const li = evsAsc[i].lineItems;
      if (li && Array.isArray(li) && (li as unknown[]).length > 0) {
        products = (li as Array<{ productTitle?: string; price?: number; quantity?: number }>).map((item) => ({
          productTitle: item.productTitle ?? null,
          price: item.price ?? null,
          quantity: item.quantity ?? 1,
        }));
        break;
      }
    }

    // Cart values (in dollars — cartValue in DB is cents)
    let cartValueStart: number | null = null;
    let cartValueEnd: number | null = null;
    let cartItemCount: number | null = null;
    for (const e of evsAsc) {
      if ((e.cartValue ?? 0) > 0) {
        if (cartValueStart === null) cartValueStart = (e.cartValue!) / 100;
        cartValueEnd = (e.cartValue!) / 100;
      }
      if ((e.cartItemCount ?? 0) > 0) cartItemCount = e.cartItemCount;
    }

    // Content check
    const hasContent = products.length > 0
      || (cartItemCount != null && cartItemCount > 0)
      || (cartValueEnd != null && cartValueEnd > 0);
    if (!hasContent) continue;

    // Coupons — uppercase normalised keys, newest-first to get latest status
    const couponMap = new Map<string, CouponV3>();
    for (const e of [...evsAsc].reverse()) {
      if (!e.couponCode) continue;
      const key = e.couponCode.toUpperCase();
      if (couponMap.has(key)) continue; // keep newest (first seen in reversed order)
      let status: CouponV3['status'] = 'failed';
      if (e.couponRecovered) status = 'recovered';
      else if (e.couponSuccess === true) status = 'applied';
      couponMap.set(key, { code: key, status, discountAmount: e.discountAmount ?? null });
    }
    const coupons = Array.from(couponMap.values());

    // Outcome
    const hasCompleted = checkEvs.some((e) => e.eventType === 'checkout_completed');
    const hasCheckout =
      evsAsc.some((e) => e.eventType === 'cart_checkout_clicked') ||
      checkEvs.some((e) => e.eventType === 'checkout_started');
    const outcome = hasCompleted ? 'ordered' : hasCheckout ? 'checkout' : 'abandoned';

    // Timing
    const firstAt = new Date(evsAsc[0].occurredAt).getTime();
    const lastCartAt = new Date(evsAsc[evsAsc.length - 1].occurredAt).getTime();
    const lastCheckoutAt = checkEvs.length > 0
      ? Math.max(...checkEvs.map((e) => new Date(e.occurredAt).getTime()))
      : 0;
    const duration = Math.max(lastCartAt, lastCheckoutAt) - firstAt;

    // Country / device / UTM from first event with each
    const country = evsAsc.find((e) => e.country)?.country ?? null;
    const device = evsAsc.find((e) => e.device)?.device ?? null;
    const utmEvent = evsAsc.find((e) => e.utmSource || e.utmMedium || e.utmCampaign);
    const utmSource = utmEvent?.utmSource ?? null;
    const utmMedium = utmEvent?.utmMedium ?? null;
    const utmCampaign = utmEvent?.utmCampaign ?? null;

    const sess: CartSessionV3 = {
      sessionId,
      startTime: evsAsc[0].occurredAt,
      duration,
      country,
      device,
      utmSource,
      utmMedium,
      utmCampaign,
      products,
      cartItemCount,
      cartValueStart,
      cartValueEnd,
      coupons,
      outcome,
      summary: '',
    };
    sess.summary = buildSessionSummaryV3(sess);
    sessions.push(sess);
  }

  return sessions;
}
