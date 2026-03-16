'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import useSWR from 'swr';
import { Banner, Spinner } from '@shopify/polaris';

import { useShop } from '@/hooks/useShop';
import { DateRangePicker, DateRange } from '@/components/couponmaxx/DateRangePicker';
import { FilterPill } from '@/components/couponmaxx/FilterPill';
import { KpiBox } from '@/components/couponmaxx/KpiBox';
import { deriveSourceV3 } from '@/lib/v3/session-builder';
import type { CartSessionV3, CouponV3, LineItemV3 } from '@/lib/v3/session-builder';

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

type SessionsResponse = {
  boxes: Boxes;
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

function DesktopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

function MobileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function TabletIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M12 18h.01" />
    </svg>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#6B7280"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ animation: spinning ? 'spin 0.8s linear infinite' : undefined }}
    >
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// DeviceCell
// ---------------------------------------------------------------------------

function DeviceCell({ device }: { device: string | null }) {
  if (!device) return <span style={{ color: '#9CA3AF' }}>—</span>;
  const lower = device.toLowerCase();
  let icon: React.ReactNode = <span style={{ color: '#9CA3AF' }}>—</span>;
  let label = device;

  if (lower === 'desktop') { icon = <DesktopIcon />; label = 'Desktop'; }
  else if (lower === 'mobile') { icon = <MobileIcon />; label = 'Mobile'; }
  else if (lower === 'tablet') { icon = <TabletIcon />; label = 'Tablet'; }

  return (
    <div title={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {icon}
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
  const config: Record<string, { bg: string; text: string; border: string; label: string }> = {
    ordered:   { bg: '#F0FDF4', text: '#15803D', border: '#BBF7D0', label: 'Ordered' },
    checkout:  { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A', label: 'Checkout' },
    abandoned: { bg: '#F9FAFB', text: '#6B7280', border: '#E5E7EB', label: 'Abandoned' },
  };
  const c = config[outcome] ?? config.abandoned;
  const tooltip = outcome === 'abandoned'
    ? 'Based on this session only. Customer may have returned later.'
    : undefined;

  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-block',
        background: c.bg,
        color: c.text,
        border: `1px solid ${c.border}`,
        borderRadius: 20,
        padding: '3px 10px',
        fontSize: 11,
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {c.label}
    </span>
  );
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
      {/* Dark overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 480, background: '#FFFFFF',
          borderLeft: '1px solid #E3E3E3',
          zIndex: 201, overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #E3E3E3', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: '#9CA3AF', fontFamily: 'monospace', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session.sessionId}
              </div>
              <div style={{ fontSize: 13, color: '#374151', marginBottom: 8, lineHeight: 1.4 }}>
                {summary}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
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
            </div>
            <button
              onClick={onClose}
              style={{
                flexShrink: 0, background: 'none', border: '1px solid #E3E3E3',
                borderRadius: 6, padding: 6, cursor: 'pointer',
                display: 'flex', alignItems: 'center',
              }}
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Products section */}
        {session.products.length > 0 && (
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #E3E3E3', flexShrink: 0 }}>
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
        <div style={{ padding: '16px 20px', flex: 1 }}>
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
                        {ev.label}
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
  const [boxFilter, setBoxFilter] = useState('');

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
    { label: '🇺🇸 US', value: 'US' },
    { label: '🇬🇧 GB', value: 'GB' },
    { label: '🇨🇦 CA', value: 'CA' },
    { label: '🇦🇺 AU', value: 'AU' },
    { label: '🇮🇳 IN', value: 'IN' },
    { label: '🇩🇪 DE', value: 'DE' },
    { label: '🇫🇷 FR', value: 'FR' },
    { label: '🇧🇷 BR', value: 'BR' },
    { label: '🇲🇽 MX', value: 'MX' },
  ];

  // Product options — static placeholder; future: derive from data
  const productOptions = [
    { label: 'All products', value: '' },
  ];

  const sourceOptions = [
    { label: 'All sources', value: '' },
    { label: 'Direct', value: 'Direct' },
    { label: 'Organic', value: 'Organic' },
    { label: 'Email', value: 'Email' },
    { label: 'Paid Search', value: 'Paid Search' },
    { label: 'Paid Social', value: 'Paid Social' },
    { label: 'Social', value: 'Social' },
    { label: 'Affiliate', value: 'Affiliate' },
    { label: 'Referral', value: 'Referral' },
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
      {/* Keyframe injection for spinner animation */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Error banner */}
        {error && (
          <Banner tone="critical">
            Failed to load sessions data. Please try again.
          </Banner>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Page title + purpose line                                         */}
        {/* ---------------------------------------------------------------- */}
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#111827' }}>
            Cart Sessions
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6B7280' }}>
            Click a card to filter the table. Click View on any row to see the full journey.
          </p>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Section 1 — Date range pill + Refresh                            */}
        {/* ---------------------------------------------------------------- */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <DateRangePicker value={dateRange} onChange={setDateRange} defaultDays={1} />
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Refresh"
            style={{
              width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#FFFFFF', border: '1px solid #D1D5DB', borderRadius: '50%',
              cursor: 'pointer', padding: 0, flexShrink: 0,
            }}
          >
            <RefreshIcon spinning={refreshing} />
          </button>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Section 2 — Four KPI boxes                                       */}
        {/* ---------------------------------------------------------------- */}
        <div style={{ display: 'flex', gap: 12 }}>
          <KpiBox
            label="Carts Opened"
            value={boxes?.cartsOpened ?? (isLoading ? '…' : '—')}
            sub1={boxes ? `${boxes.withProducts} with products` : undefined}
            sub2={boxes ? `${boxes.emptyCount} empty` : undefined}
            active={boxFilter === ''}
            onClick={() => handleBoxClick('')}
          />
          <KpiBox
            label="With Products"
            value={boxes?.withProducts ?? (isLoading ? '…' : '—')}
            sub1={boxes ? `${boxes.withProductsPct}% of carts opened` : undefined}
            active={boxFilter === 'products'}
            onClick={() => handleBoxClick('products')}
          />
          <KpiBox
            label="Coupon Attempted"
            value={boxes?.couponAttempted ?? (isLoading ? '…' : '—')}
            sub1={boxes ? `${boxes.couponAttemptedPct}% of product carts` : undefined}
            active={boxFilter === 'coupon'}
            onClick={() => handleBoxClick('coupon')}
          />
          <KpiBox
            label="Reached Checkout"
            value={boxes?.reachedCheckout ?? (isLoading ? '…' : '—')}
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
        <div
          style={{
            background: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: 8, padding: '12px 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <FilterPill
              label="Country"
              value={country}
              options={countryOptions}
              onChange={setCountry}
            />
            <FilterPill
              label="Device"
              value={device}
              options={deviceOptions}
              onChange={setDevice}
            />
            <FilterPill
              label="Product"
              value={product}
              options={productOptions}
              onChange={setProduct}
            />
            <FilterPill
              label="Cart value"
              value={cartValueDisplay}
              options={cartValueOptions}
              onChange={handleCartValueChange}
            />
            <FilterPill
              label="Coupon"
              value={coupon}
              options={couponOptions}
              onChange={setCoupon}
            />
            <FilterPill
              label="Outcome"
              value={outcome}
              options={outcomeOptions}
              onChange={setOutcome}
            />
            <FilterPill
              label="Source"
              value={utmSource}
              options={sourceOptions}
              onChange={setUtmSource}
            />
            {anyFilterActive && (
              <button
                onClick={() => {
                  setCountry(''); setDevice(''); setProduct('');
                  setMinCart(''); setMaxCart(''); setCoupon(''); setOutcome(''); setUtmSource('');
                }}
                style={{
                  marginLeft: 'auto', background: 'none', border: 'none',
                  fontSize: 12, color: '#6B7280', cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                Clear all
              </button>
            )}
          </div>
        </div>

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
        <div style={{ background: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: 8, overflow: 'hidden' }}>
          {isLoading && sessions.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 48 }}>
              <Spinner size="small" />
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: '#9CA3AF' }}>
              No sessions found for the selected filters.
            </div>
          ) : (
            <table
              style={{
                tableLayout: 'fixed', width: '100%', borderCollapse: 'collapse',
              }}
            >
              <colgroup>
                <col style={{ width: 110 }} />
                <col style={{ width: 50 }} />
                <col style={{ width: 50 }} />
                <col style={{ width: 80 }} />
                <col /> {/* flex */}
                <col style={{ width: 110 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 48 }} />
              </colgroup>
              <thead>
                <tr style={{ background: '#FAFAFA' }}>
                  <th style={thStyle}>Time</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Country</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Device</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Products</th>
                  <th style={thStyle}>Cart value</th>
                  <th style={thStyle}>Coupons</th>
                  <th style={thStyle}>Outcome</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>View</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr
                    key={s.sessionId}
                    style={{ transition: 'background 0.1s' }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#FAFAFA'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                  >
                    {/* Time */}
                    <td style={tdStyle}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: '#1A1A1A', lineHeight: 1.3 }}>
                        {fmtRelativeTime(s.startTime)}
                      </div>
                      <div style={{ fontSize: 11, color: '#6B7280', marginTop: 1 }}>
                        {fmtAbsoluteTime(s.startTime)}
                      </div>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 1 }}>
                        {fmtDuration(s.duration)}
                      </div>
                    </td>

                    {/* Country */}
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {s.country ? (
                        <span style={{ fontSize: 12, color: '#374151', whiteSpace: 'nowrap' }}>
                          {countryFlag(s.country)} {s.country}
                        </span>
                      ) : (
                        <span style={{ color: '#9CA3AF' }}>—</span>
                      )}
                    </td>

                    {/* Device */}
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <DeviceCell device={s.device} />
                    </td>

                    {/* Source */}
                    <td style={tdStyle}>
                      <SourceChip
                        utmSource={s.utmSource}
                        utmMedium={s.utmMedium}
                        utmCampaign={s.utmCampaign}
                      />
                    </td>

                    {/* Products */}
                    <td style={tdStyle}>
                      <ProductsCell products={s.products} />
                    </td>

                    {/* Cart value */}
                    <td style={tdStyle}>
                      <CartValueCell session={s} />
                    </td>

                    {/* Coupons */}
                    <td style={tdStyle}>
                      <CouponsCell coupons={s.coupons} />
                    </td>

                    {/* Outcome */}
                    <td style={tdStyle}>
                      <OutcomeBadge outcome={s.outcome} />
                    </td>

                    {/* View */}
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <button
                        onClick={() => setPanelSession(s)}
                        style={{
                          background: 'none', border: 'none', padding: 0,
                          fontSize: 12, color: '#0EA5E9', cursor: 'pointer',
                          fontWeight: 500, whiteSpace: 'nowrap',
                        }}
                      >
                        View →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Pagination                                                        */}
        {/* ---------------------------------------------------------------- */}
        {total > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#6B7280' }}>
              Page {page} of {totalPages} · {total} total sessions
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{
                  padding: '6px 14px', background: '#FFFFFF', border: '1px solid #D1D5DB',
                  borderRadius: 6, fontSize: 13, color: page <= 1 ? '#9CA3AF' : '#374151',
                  cursor: page <= 1 ? 'default' : 'pointer',
                }}
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{
                  padding: '6px 14px', background: '#FFFFFF', border: '1px solid #D1D5DB',
                  borderRadius: 6, fontSize: 13, color: page >= totalPages ? '#9CA3AF' : '#374151',
                  cursor: page >= totalPages ? 'default' : 'pointer',
                }}
              >
                Next →
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Timeline panel (portal-style, rendered outside main flow)          */}
      {/* ------------------------------------------------------------------ */}
      {panelSession && shop && (
        <TimelinePanel
          session={panelSession}
          shop={shop}
          onClose={() => setPanelSession(null)}
        />
      )}
    </>
  );
}
