'use client';

import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import { Banner, BlockStack, Card, Icon, IndexTable, Page, Pagination, Spinner, Select, InlineStack, Badge, Button as PolarisButton } from '@shopify/polaris';
import { DesktopIcon, MobileIcon, TabletIcon, RefreshIcon } from '@shopify/polaris-icons';

import { useShop } from '@/hooks/useShop';
import { DateRangePicker, DateRange } from '@/components/couponmaxx/DateRangePicker';
import { KpiBox } from '@/components/couponmaxx/KpiBox';
import { LoadingBar } from '@/components/couponmaxx/LoadingBar';
import { deriveSourceV3 } from '@/lib/session-utils';
import type { CartSessionV3, CouponV3, LineItemV3 } from '@/lib/session-utils';

// ---------------------------------------------------------------------------
// Human-readable event labels
// ---------------------------------------------------------------------------

const EVENT_LABELS: Record<string, string> = {
  cart_bulk_updated: 'Cart updated',
  cart_item_added: 'Added item to cart',
  cart_item_removed: 'Removed item from cart',
  cart_coupon_applied: '✓ Coupon applied',
  cart_coupon_failed: '✗ Coupon failed',
  cart_coupon_removed: 'Coupon removed',
  cart_checkout_clicked: 'Proceeded to checkout',
  cart_page_hidden: 'Left the page',
  cart_page_visible: 'Returned to page',
  cart_atc_clicked: 'Add to cart clicked',
  cart_viewed: 'Viewed cart',
  checkout_started: 'Checkout started',
  checkout_completed: 'Order completed',
  payment_info_submitted: 'Entered payment info',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Boxes = {
  cartsOpened: number;
  emptyCount: number;
  withProducts: number;
  withProductsPct: number;
  couponAttempted: number;
  couponAttemptedPct: number;
  reachedCheckout: number;
  reachedCheckoutPct: number;
  checkoutWithCoupon: number;
  checkoutWithoutCoupon: number;
};

type ScopedCounts = {
  showing: number;
  checkoutRate: number;
  completionRate: number;
};

type ScopedBoxes = {
  cartsOpened: number;
  withProducts: number;
  couponAttempted: number;
  reachedCheckout: number;
};

type SessionsResponse = {
  boxes: Boxes;
  scopedBoxes?: ScopedBoxes;
  sessions: CartSessionV3[];
  total: number;
  page: number;
  perPage: number;
  scopedCounts: ScopedCounts;
};

type TimelineEvent = {
  source: 'cart' | 'checkout';
  eventType: string;
  occurredAt: string;
  label: string;
  detail: string | null;
  sentiment: 'positive' | 'negative' | 'neutral';
};

type SessionDetailResponse = {
  timeline: TimelineEvent[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function subHours(d: Date, h: number) {
  return new Date(d.getTime() - h * 3600000);
}

function toISO(d: Date) {
  return d.toISOString();
}

function fmtRelativeTime(isoStr: string): string {
  const now = Date.now();
  const then = new Date(isoStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) {
    const remMin = diffMin - diffHr * 60;
    return remMin > 0 ? `${diffHr}h ${remMin}m ago` : `${diffHr}h ago`;
  }
  if (diffDays === 1) return 'yesterday';
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtAbsoluteTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return '< 1s';
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function fmtMoney(dollars: number): string {
  return `$${dollars.toFixed(2).replace(/\.00$/, '')}`;
}

function fmtMoneyFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, '')}`;
}

function truncate(str: string, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function countryFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return '';
  const offset = 127397;
  return String.fromCodePoint(
    countryCode.toUpperCase().charCodeAt(0) + offset,
    countryCode.toUpperCase().charCodeAt(1) + offset,
  );
}

function fmtElapsed(ms: number): string {
  if (ms < 1000) return `+${ms}ms`;
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `+${sec}s`;
  return `+${min}m ${sec}s`;
}

function fmtTimelineTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function deriveSourceLabel(utmSource: string | null, utmMedium: string | null): string {
  return deriveSourceV3(utmSource, utmMedium);
}

// ---------------------------------------------------------------------------
// SVG Icons
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// DeviceCell
// ---------------------------------------------------------------------------

function DeviceCell({ device }: { device: string | null }) {
  if (!device) return <span style={{ color: '#9CA3AF' }}>—</span>;
  const lower = device.toLowerCase();
  const source = lower === 'desktop' ? DesktopIcon : lower === 'mobile' ? MobileIcon : lower === 'tablet' ? TabletIcon : null;
  if (!source) return <span style={{ fontSize: 12, color: '#6B7280' }}>{device}</span>;
  return (
    <div title={device} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon source={source} tone="subdued" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SourceChip
// ---------------------------------------------------------------------------

function SourceChip({ utmSource, utmMedium, utmCampaign }: { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null }) {
  const label = deriveSourceLabel(utmSource, utmMedium);
  const hasUtm = !!(utmSource || utmMedium || utmCampaign);

  const tooltipLines: string[] = [];
  if (utmSource) tooltipLines.push(`utm_source: ${utmSource}`);
  if (utmMedium) tooltipLines.push(`utm_medium: ${utmMedium}`);
  if (utmCampaign) tooltipLines.push(`utm_campaign: ${utmCampaign}`);
  const tooltipText = tooltipLines.join('\n');

  return (
    <span
      title={hasUtm ? tooltipText : undefined}
      style={{
        display: 'inline-block',
        background: '#F3F4F6',
        border: '1px solid #E5E7EB',
        borderRadius: 4,
        padding: '2px 6px',
        fontSize: 11,
        color: '#374151',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '100%',
      }}
    >
      {label.length > 10 ? label.slice(0, 10) : label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// OutcomeBadge
// ---------------------------------------------------------------------------

function OutcomeBadge({ outcome }: { outcome: 'ordered' | 'checkout' | 'abandoned' }) {
  if (outcome === 'ordered') return <Badge tone="success">Ordered</Badge>;
  if (outcome === 'checkout') return <Badge tone="info">Checkout</Badge>;
  return <Badge tone="attention">Abandoned</Badge>;
}

// ---------------------------------------------------------------------------
// ProductsCell
// ---------------------------------------------------------------------------

function ProductsCell({ products }: { products: LineItemV3[] }) {
  const [expanded, setExpanded] = useState(false);

  if (products.length === 0) {
    return <span style={{ fontSize: 12, color: '#9CA3AF', fontStyle: 'italic' }}>Empty cart</span>;
  }

  const displayCount = expanded ? products.length : Math.min(2, products.length);
  const moreCount = products.length - 2;
  const shown = products.slice(0, displayCount);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {shown.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 4, flexWrap: 'nowrap' }}>
          <span style={{ fontSize: 12, color: '#1A1A1A', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160 }}>
            {truncate(p.productTitle ?? 'Unknown', 28)}
          </span>
          <span style={{ fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>×{p.quantity}</span>
          {p.price != null && (
            <span style={{ fontSize: 11, color: '#6B7280', whiteSpace: 'nowrap' }}>
              {fmtMoneyFromCents(p.price)}
            </span>
          )}
        </div>
      ))}
      {!expanded && moreCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, color: '#0EA5E9', cursor: 'pointer', textAlign: 'left' }}
        >
          + {moreCount} more
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CartValueCell
// ---------------------------------------------------------------------------

function CartValueCell({ session }: { session: CartSessionV3 }) {
  const { cartValueStart, cartValueEnd, coupons } = session;

  let line1: React.ReactNode = <span style={{ color: '#9CA3AF' }}>—</span>;

  if (cartValueEnd != null && cartValueEnd > 0) {
    if (cartValueStart != null && cartValueStart !== cartValueEnd) {
      line1 = (
        <span>
          {fmtMoney(cartValueStart)}
          <span style={{ color: '#9CA3AF', margin: '0 2px' }}> → </span>
          {fmtMoney(cartValueEnd)}
        </span>
      );
    } else {
      line1 = <span>{fmtMoney(cartValueEnd ?? cartValueStart ?? 0)}</span>;
    }
  }

  const appliedCoupon = coupons.find((c) => c.status === 'applied' || c.status === 'recovered');
  let line2: React.ReactNode = null;
  if (appliedCoupon && appliedCoupon.discountAmount != null && cartValueEnd != null) {
    const postDiscount = cartValueEnd - appliedCoupon.discountAmount / 100;
    line2 = (
      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
        after coupon: {fmtMoney(postDiscount)}
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1A1A' }}>{line1}</div>
      {line2}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CouponsCell
// ---------------------------------------------------------------------------

function CouponsCell({ coupons }: { coupons: CouponV3[] }) {
  const [expanded, setExpanded] = useState(false);

  if (coupons.length === 0) {
    return <span style={{ fontSize: 12, color: '#9CA3AF' }}>—</span>;
  }

  const displayCount = expanded ? coupons.length : Math.min(2, coupons.length);
  const moreCount = coupons.length - 2;
  const shown = coupons.slice(0, displayCount);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {shown.map((c, i) => {
        if (c.status === 'applied') {
          return (
            <div key={i} style={{ fontSize: 12, color: '#15803D', whiteSpace: 'nowrap' }}>
              ✓ <span style={{ fontFamily: 'monospace' }}>{c.code}</span>
              {c.discountAmount != null && (
                <span style={{ fontFamily: 'inherit' }}> −{fmtMoneyFromCents(c.discountAmount)}</span>
              )}
            </div>
          );
        }
        if (c.status === 'recovered') {
          return (
            <div key={i} style={{ fontSize: 12, color: '#B45309', whiteSpace: 'nowrap' }}>
              ↑ <span style={{ fontFamily: 'monospace' }}>{c.code}</span>
              {c.discountAmount != null && (
                <span style={{ fontFamily: 'inherit' }}> −{fmtMoneyFromCents(c.discountAmount)}</span>
              )}
            </div>
          );
        }
        if (c.status === 'failed') {
          return (
            <div key={i} style={{ fontSize: 12, color: '#B91C1C', whiteSpace: 'nowrap' }}>
              ✗ <span style={{ fontFamily: 'monospace' }}>{c.code}</span>
            </div>
          );
        }
        return (
          <div key={i} style={{ fontSize: 12, color: '#6B7280', whiteSpace: 'nowrap' }}>
            <span style={{ fontFamily: 'monospace' }}>{c.code}</span>
          </div>
        );
      })}
      {!expanded && moreCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, color: '#0EA5E9', cursor: 'pointer', textAlign: 'left' }}
        >
          + {moreCount} more
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Timeline Panel
// ---------------------------------------------------------------------------

type TimelinePanelProps = {
  session: CartSessionV3;
  shop: string;
  onClose: () => void;
};

function buildPanelSummary(s: CartSessionV3): string {
  const product = s.products[0]?.productTitle ?? null;
  const productStr =
    s.products.length > 1
      ? `${product ?? 'item'} +${s.products.length - 1} more`
      : product ?? null;

  const coupon = s.coupons[0] ?? null;
  let couponStr = '';
  if (coupon) {
    if (coupon.status === 'applied') {
      const saved = coupon.discountAmount != null ? ` (saved ${fmtMoneyFromCents(coupon.discountAmount)})` : '';
      couponStr = `, applied ${coupon.code}${saved}`;
    } else if (coupon.status === 'recovered') {
      couponStr = `, unlocked ${coupon.code} after adding items`;
    } else {
      couponStr = `, tried ${coupon.code} (failed)`;
    }
  }

  if (s.outcome === 'ordered') return `${productStr ?? 'items'}${couponStr}, completed order`;
  if (s.outcome === 'checkout') return `${productStr ?? 'items'}${couponStr}, reached checkout`;
  if (s.products.length > 0) return `${productStr}${couponStr}, abandoned`;
  return 'Browsed without adding to cart';
}

async function fetchTimeline(url: string): Promise<SessionDetailResponse> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function TimelinePanel({ session, shop, onClose }: TimelinePanelProps) {
  const url = `/api/couponmaxx/session?shop=${encodeURIComponent(shop)}&sessionId=${encodeURIComponent(session.sessionId)}`;
  const { data, isLoading, error } = useSWR<SessionDetailResponse>(url, fetchTimeline);

  const summary = buildPanelSummary(session);
  const totalValue = session.cartValueEnd ?? session.cartValueStart ?? 0;

  return (
    <>
      {/* Session metadata */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A', marginBottom: 8, lineHeight: 1.4 }}>
          {summary}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <OutcomeBadge outcome={session.outcome} />
          {session.country && (
            <span style={{ fontSize: 12, color: '#374151' }}>
              {countryFlag(session.country)} {session.country}
            </span>
          )}
          {session.device && (
            <DeviceCell device={session.device} />
          )}
        </div>
        <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace' }}>
          {session.sessionId}
        </div>
      </div>

      {/* Products section */}
      {session.products.length > 0 && (
        <div style={{ marginBottom: 16, paddingBottom: 16, borderBottom: '1px solid #F3F4F6' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Products
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {session.products.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, color: '#1A1A1A', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.productTitle ?? 'Unknown'}
                </span>
                <span style={{ fontSize: 12, color: '#6B7280', whiteSpace: 'nowrap' }}>×{p.quantity}</span>
                {p.price != null && (
                  <span style={{ fontSize: 12, color: '#6B7280', whiteSpace: 'nowrap' }}>
                    {fmtMoneyFromCents(p.price)}
                  </span>
                )}
              </div>
            ))}
          </div>
          {totalValue > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, paddingTop: 8, borderTop: '1px solid #F3F4F6' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#1A1A1A' }}>
                Total: {fmtMoney(totalValue)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Timeline section */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Timeline
        </div>

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
            <Spinner size="small" />
          </div>
        )}

        {error && (
          <Banner tone="critical">Failed to load timeline.</Banner>
        )}

        {data && data.timeline.length === 0 && (
          <div style={{ fontSize: 13, color: '#9CA3AF', textAlign: 'center', padding: 24 }}>
            No events recorded.
          </div>
        )}

        {data && data.timeline.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {data.timeline.map((ev, i) => {
              const prevAt = i > 0 ? new Date(data.timeline[i - 1].occurredAt).getTime() : null;
              const thisAt = new Date(ev.occurredAt).getTime();
              const elapsedMs = prevAt != null ? thisAt - prevAt : null;

              const isCart = ev.source === 'cart';
              const isPositive = ev.sentiment === 'positive';
              const isNegative = ev.sentiment === 'negative';

              const labelColor = isPositive ? '#15803D' : isNegative ? '#B91C1C' : '#1A1A1A';
              const isCompleted = ev.eventType === 'checkout_completed';

              return (
                <div
                  key={i}
                  style={{
                    display: 'flex', gap: 12, paddingTop: 12, paddingBottom: 12,
                    borderBottom: i < data.timeline.length - 1 ? '1px solid #F3F4F6' : undefined,
                  }}
                >
                  {/* Time column */}
                  <div style={{ width: 72, flexShrink: 0, textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: '#374151' }}>
                      {fmtTimelineTime(ev.occurredAt)}
                    </div>
                    {elapsedMs != null && (
                      <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>
                        {fmtElapsed(elapsedMs)}
                      </div>
                    )}
                  </div>

                  {/* Badge */}
                  <div style={{ flexShrink: 0, paddingTop: 1 }}>
                    <span style={{
                      display: 'inline-block',
                      background: isCart ? '#F3F4F6' : '#EFF6FF',
                      color: isCart ? '#374151' : '#1D4ED8',
                      border: `1px solid ${isCart ? '#E5E7EB' : '#BFDBFE'}`,
                      borderRadius: 20,
                      padding: '1px 7px',
                      fontSize: 10,
                      fontWeight: 500,
                    }}>
                      {isCart ? 'Cart' : 'Checkout'}
                    </span>
                  </div>

                  {/* Label + detail */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13,
                      color: labelColor,
                      fontWeight: isCompleted ? 600 : 400,
                    }}>
                      {EVENT_LABELS[ev.eventType] || ev.label}
                    </div>
                    {ev.detail && (
                      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>
                        {ev.detail}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetcher(url: string): Promise<SessionsResponse> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SessionsPage() {
  const shop = useShop();

  // Date range — default 24h
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const end = new Date();
    return { start: subHours(end, 24), end };
  });

  // Box filter
  const [boxFilter, setBoxFilter] = useState('products');

  // Filters
  const [country, setCountry] = useState('');
  const [device, setDevice] = useState('');
  const [product, setProduct] = useState('');
  const [minCart, setMinCart] = useState('');
  const [maxCart, setMaxCart] = useState('');
  const [coupon, setCoupon] = useState('');
  const [outcome, setOutcome] = useState('');
  const [utmSource, setUtmSource] = useState('');

  // Pagination
  const [page, setPage] = useState(1);

  // Timeline panel
  const [panelSession, setPanelSession] = useState<CartSessionV3 | null>(null);

  // Refresh spinner
  const [refreshing, setRefreshing] = useState(false);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [dateRange, boxFilter, country, device, product, minCart, maxCart, coupon, outcome, utmSource]);

  // ---------------------------------------------------------------------------
  // SWR key
  // ---------------------------------------------------------------------------

  const swrKey = shop
    ? (() => {
        const p = new URLSearchParams();
        p.set('shop', shop);
        p.set('start', toISO(dateRange.start));
        p.set('end', toISO(dateRange.end));
        p.set('page', String(page));
        if (device) p.set('device', device);
        if (country) p.set('country', country);
        if (product) p.set('product', product);
        if (minCart) p.set('minCart', minCart);
        if (maxCart) p.set('maxCart', maxCart);
        if (coupon) p.set('coupon', coupon);
        if (outcome) p.set('outcome', outcome);
        if (utmSource) p.set('source', utmSource);
        if (boxFilter) p.set('boxFilter', boxFilter);
        return `/api/couponmaxx/sessions?${p.toString()}`;
      })()
    : null;

  const { data, isLoading, error, mutate } = useSWR<SessionsResponse>(swrKey, fetcher, {
    keepPreviousData: true,
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await mutate();
    setRefreshing(false);
  }, [mutate]);

  function handleBoxClick(filter: string) {
    setBoxFilter((prev) => prev === filter ? '' : filter);
  }

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const boxes = data?.boxes;
  const activeBoxes = data?.boxes;
  const sessions = data?.sessions ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / (data?.perPage ?? 25)));
  const scopedCounts = data?.scopedCounts;

  const anyFilterActive = !!(country || device || product || minCart || maxCart || coupon || outcome || utmSource);

  // ---------------------------------------------------------------------------
  // Filter options
  // ---------------------------------------------------------------------------

  const deviceOptions = [
    { label: 'All devices', value: '' },
    { label: 'Desktop', value: 'Desktop' },
    { label: 'Mobile', value: 'Mobile' },
    { label: 'Tablet', value: 'Tablet' },
  ];

  const cartValueOptions = [
    { label: 'Any value', value: '' },
    { label: 'Under $50', value: 'under50' },
    { label: '$50–$100', value: '50-100' },
    { label: '$100–$150', value: '100-150' },
    { label: '$150–$200', value: '150-200' },
    { label: '$200+', value: 'over200' },
  ];

  const couponOptions = [
    { label: 'Any', value: '' },
    { label: 'Used a coupon', value: 'any' },
    { label: 'No coupon', value: 'no' },
    { label: 'Applied successfully', value: 'applied' },
    { label: 'Failed (never recovered)', value: 'failed' },
    { label: 'Recovered', value: 'recovered' },
  ];

  const outcomeOptions = [
    { label: 'Any', value: '' },
    { label: 'Ordered', value: 'ordered' },
    { label: 'Reached checkout', value: 'checkout' },
    { label: 'Abandoned', value: 'abandoned' },
  ];

  // Cart value pill display uses encoded value; translate to min/max
  const cartValueDisplay = (() => {
    if (!minCart && !maxCart) return '';
    if (minCart === '0' && maxCart === '50') return 'under50';
    if (minCart === '50' && maxCart === '100') return '50-100';
    if (minCart === '100' && maxCart === '150') return '100-150';
    if (minCart === '150' && maxCart === '200') return '150-200';
    if (minCart === '200' && !maxCart) return 'over200';
    return 'under50'; // fallback
  })();

  function handleCartValueChange(val: string) {
    if (val === '') { setMinCart(''); setMaxCart(''); return; }
    if (val === 'under50') { setMinCart('0'); setMaxCart('50'); return; }
    if (val === '50-100') { setMinCart('50'); setMaxCart('100'); return; }
    if (val === '100-150') { setMinCart('100'); setMaxCart('150'); return; }
    if (val === '150-200') { setMinCart('150'); setMaxCart('200'); return; }
    if (val === 'over200') { setMinCart('200'); setMaxCart(''); return; }
  }

  // Country options — static common set; future: derive from data
  const countryOptions = [
    { label: 'All countries', value: '' },
    { label: 'US', value: 'US' },
    { label: 'GB', value: 'GB' },
    { label: 'CA', value: 'CA' },
    { label: 'AU', value: 'AU' },
    { label: 'IN', value: 'IN' },
    { label: 'DE', value: 'DE' },
    { label: 'FR', value: 'FR' },
    { label: 'BR', value: 'BR' },
    { label: 'MX', value: 'MX' },
  ];

  // Product options — static placeholder; future: derive from data
  const productOptions = [
    { label: 'All products', value: '' },
  ];

  const sourceOptions = [
    { label: 'All sources', value: '' },
    { label: 'Direct', value: 'Direct' },
    { label: 'Paid Search', value: 'Paid search' },
    { label: 'Social', value: 'Social' },
    { label: 'Email', value: 'Email' },
  ];

  // ---------------------------------------------------------------------------
  // Styles
  // ---------------------------------------------------------------------------

  const thStyle: React.CSSProperties = {
    padding: '10px 8px',
    textAlign: 'left',
    fontSize: 11,
    fontWeight: 600,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #E3E3E3',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  };

  const tdStyle: React.CSSProperties = {
    padding: '10px 8px',
    verticalAlign: 'top',
    borderBottom: '1px solid #F3F4F6',
    overflow: 'hidden',
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <LoadingBar loading={isLoading} />
      {/* Keyframe injection for spinner animation */}
      <Page title="Cart Sessions">
      <BlockStack gap="400">

        {/* Error banner */}
        {error && (
          <Banner tone="critical">
            Failed to load sessions data. Please try again.
          </Banner>
        )}


        {/* ---------------------------------------------------------------- */}
        {/* Section 1 — Date range pill + Refresh                            */}
        {/* ---------------------------------------------------------------- */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <DateRangePicker value={dateRange} onChange={setDateRange} defaultDays={1} />
          <PolarisButton
            icon={RefreshIcon}
            onClick={handleRefresh}
            loading={refreshing}
            accessibilityLabel="Refresh"
            variant="tertiary"
          />
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Section 2 — Four KPI boxes                                       */}
        {/* ---------------------------------------------------------------- */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, alignItems: 'stretch' }}>
          <KpiBox
            label="Carts Opened"
            value={activeBoxes?.cartsOpened ?? (isLoading ? '…' : '—')}
            sub1={boxes ? `${boxes.withProducts} with products · ${boxes.emptyCount} empty` : undefined}
            sub2={boxes ? `${boxes.couponAttempted} tried a coupon` : undefined}
            active={boxFilter === ''}
            onClick={() => handleBoxClick('')}
          />
          <KpiBox
            label="With Products"
            value={activeBoxes?.withProducts ?? (isLoading ? '…' : '—')}
            sub1={boxes ? `${boxes.withProductsPct}% of carts opened` : undefined}
            sub2={boxes ? `${boxes.couponAttempted} attempted a coupon` : undefined}
            active={boxFilter === 'products'}
            onClick={() => handleBoxClick('products')}
          />
          <KpiBox
            label="Coupon Attempted"
            value={activeBoxes?.couponAttempted ?? (isLoading ? '…' : '—')}
            sub1={boxes ? `${boxes.couponAttemptedPct}% of product carts` : undefined}
            sub2={boxes ? `${(boxes.couponAttempted ?? 0) - (boxes.reachedCheckout ?? 0)} abandoned after trying` : undefined}
            active={boxFilter === 'coupon'}
            onClick={() => handleBoxClick('coupon')}
          />
          <KpiBox
            label="Reached Checkout"
            value={activeBoxes?.reachedCheckout ?? (isLoading ? '…' : '—')}
            sub1={boxes ? `${boxes.reachedCheckoutPct}% of product carts` : undefined}
            sub2={
              boxes
                ? <span style={{ fontSize: 13, color: '#9CA3AF' }}>{boxes.checkoutWithCoupon} had a coupon · {boxes.checkoutWithoutCoupon} did not</span>
                : undefined
            }
            active={boxFilter === 'checkout'}
            onClick={() => handleBoxClick('checkout')}
          />
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Section 3 — Filter bar                                           */}
        {/* ---------------------------------------------------------------- */}
        <Card>
          <InlineStack gap="300" wrap>
            <Select
              label="Country"
              labelInline
              options={countryOptions}
              value={country}
              onChange={setCountry}
            />
            <Select
              label="Device"
              labelInline
              options={deviceOptions}
              value={device}
              onChange={setDevice}
            />
            <Select
              label="Cart value"
              labelInline
              options={cartValueOptions}
              value={cartValueDisplay}
              onChange={handleCartValueChange}
            />
            <Select
              label="Coupon"
              labelInline
              options={couponOptions}
              value={coupon}
              onChange={setCoupon}
            />
            <Select
              label="Outcome"
              labelInline
              options={outcomeOptions}
              value={outcome}
              onChange={setOutcome}
            />
            <Select
              label="Source"
              labelInline
              options={sourceOptions}
              value={utmSource}
              onChange={setUtmSource}
            />
          </InlineStack>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* Section 4 — Scoped counts                                        */}
        {/* ---------------------------------------------------------------- */}
        {scopedCounts && (
          <div style={{ fontSize: 13, color: '#6B7280' }}>
            Showing <strong style={{ color: '#374151' }}>{scopedCounts.showing}</strong> sessions
            <span style={{ margin: '0 8px', color: '#D1D5DB' }}>·</span>
            <strong style={{ color: '#374151' }}>{scopedCounts.checkoutRate}%</strong> reached checkout
            <span style={{ margin: '0 8px', color: '#D1D5DB' }}>·</span>
            <strong style={{ color: '#374151' }}>{scopedCounts.completionRate}%</strong> completed order
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Section 5 — Session table                                        */}
        {/* ---------------------------------------------------------------- */}
        <Card padding="0">
        <div style={{ overflowX: 'auto' }}>
          {isLoading && sessions.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 48 }}>
              <Spinner size="small" />
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: '#9CA3AF' }}>
              No sessions found for the selected filters.
            </div>
          ) : (
            <IndexTable
              resourceName={{ singular: 'session', plural: 'sessions' }}
              itemCount={sessions.length}
              headings={[
                { title: 'Time' },
                { title: 'Country' },
                { title: 'Device' },
                { title: 'Source' },
                { title: 'Products' },
                { title: 'Cart value' },
                { title: 'Coupons' },
                { title: 'Outcome' },
                { title: '' },
              ]}
              selectable={false}
            >
              {sessions.map((s, i) => (
                <IndexTable.Row
                  key={s.sessionId}
                  id={s.sessionId}
                  position={i}
                  onClick={() => setPanelSession(s)}
                >
                  <IndexTable.Cell>
                    <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1A1A', lineHeight: 1.3 }}>
                      {fmtRelativeTime(s.startTime)}
                    </div>
                    <div style={{ fontSize: 11, color: '#6B7280', marginTop: 1 }}>
                      {fmtAbsoluteTime(s.startTime)}
                    </div>
                    <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>
                      {fmtDuration(s.duration)}
                    </div>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {s.country ? (
                      <span style={{ fontSize: 12, color: '#374151', whiteSpace: 'nowrap' }}>{s.country}</span>
                    ) : (
                      <span style={{ color: '#9CA3AF' }}>—</span>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <DeviceCell device={s.device} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <SourceChip utmSource={s.utmSource} utmMedium={s.utmMedium} utmCampaign={s.utmCampaign} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <ProductsCell products={s.products} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <CartValueCell session={s} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <CouponsCell coupons={s.coupons} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <OutcomeBadge outcome={s.outcome} />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <span style={{ color: 'var(--p-color-text-subdued)', fontSize: 16 }}>›</span>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </div>
        </Card>

        {/* ---------------------------------------------------------------- */}
        {/* Pagination                                                        */}
        {/* ---------------------------------------------------------------- */}
        {total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>
              Page {page} of {totalPages} · {total} total sessions
            </span>
            <Pagination
              hasPrevious={page > 1}
              hasNext={page < totalPages}
              onPrevious={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            />
          </div>
        )}

      </BlockStack>
      </Page>

      {/* ------------------------------------------------------------------ */}
      {/* Slide-in session detail panel                                      */}
      {/* ------------------------------------------------------------------ */}

      {/* Overlay */}
      {panelSession && (
        <div
          onClick={() => setPanelSession(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.3)', zIndex: 99,
          }}
        />
      )}

      {/* Slide-in panel */}
      <div style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 480,
        height: '100vh',
        background: '#fff',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.08)',
        overflowY: 'auto',
        zIndex: 100,
        transform: panelSession ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.2s ease',
        padding: '20px',
      }}>
        {panelSession && shop && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button onClick={() => setPanelSession(null)} style={{
                background: 'none', border: 'none', fontSize: 20, cursor: 'pointer',
                color: 'var(--p-color-text-subdued)',
              }}>✕</button>
            </div>
            <TimelinePanel
              session={panelSession}
              shop={shop}
              onClose={() => setPanelSession(null)}
            />
          </>
        )}
      </div>
    </>
  );
}
