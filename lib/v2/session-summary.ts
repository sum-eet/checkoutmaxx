export type CouponSummary = {
  code: string;
  status: 'applied' | 'failed' | 'recovered';
};

export type LineItem = {
  productId?: string;
  variantId?: string;
  productTitle?: string;
  price?: number;
  quantity?: number;
};

export type CartSessionV2 = {
  sessionId: string;
  startTime: string;
  duration: number;
  country: string | null;
  device: string | null;
  products: LineItem[];
  cartValueStart: number | null;
  cartValueEnd: number | null;
  coupons: CouponSummary[];
  outcome: 'ordered' | 'checkout' | 'abandoned';
  summary: string;
};

export function buildSessionSummary(session: CartSessionV2): string {
  const product = session.products[0]?.productTitle ?? null;
  const productCount = session.products.length;
  const productStr =
    productCount > 1
      ? `${product ?? 'item'} + ${productCount - 1} more`
      : (product ?? 'items');

  const coupon = session.coupons[0] ?? null;
  let couponStr = '';
  if (coupon) {
    if (coupon.status === 'applied') {
      couponStr = `, applied ${coupon.code}`;
    } else if (coupon.status === 'recovered') {
      couponStr = `, unlocked ${coupon.code} after adding items`;
    } else if (coupon.status === 'failed') {
      couponStr = `, tried ${coupon.code} (failed)`;
    }
  }

  if (session.outcome === 'ordered') {
    return `${productStr}${couponStr}, completed order`;
  } else if (session.outcome === 'checkout') {
    return `${productStr}${couponStr}, reached checkout`;
  } else if (session.products.length > 0) {
    return `${productStr}${couponStr}, abandoned`;
  } else {
    return 'Browsed without adding to cart';
  }
}

export function buildOutcome(
  hasCompleted: boolean,
  hasCheckout: boolean,
  hasProducts: boolean
): 'ordered' | 'checkout' | 'abandoned' {
  if (hasCompleted) return 'ordered';
  if (hasCheckout) return 'checkout';
  return 'abandoned';
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return '< 1m';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds}s`;
}

export function sparklineLabel(date: Date, granularity: 'hour' | 'day' | 'week'): string {
  if (granularity === 'hour') {
    return `${date.getHours()}:00`;
  }
  if (granularity === 'day') {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return `W${getWeekNumber(date)}`;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export function getGranularity(start: Date, end: Date): 'hour' | 'day' | 'week' {
  const ms = end.getTime() - start.getTime();
  const days = ms / (1000 * 60 * 60 * 24);
  if (days <= 1) return 'hour';
  if (days <= 60) return 'day';
  return 'week';
}
