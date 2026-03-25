'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Card, InlineGrid, InlineStack, BlockStack, Text } from '@shopify/polaris';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';

import { useShop } from '@/hooks/useShop';
import { DateRangePicker, DateRange } from '@/components/couponmaxx/DateRangePicker';
import { KpiBox } from '@/components/couponmaxx/KpiBox';
import { LoadingBar } from '@/components/couponmaxx/LoadingBar';
import { ToggleGroup } from '@/components/couponmaxx/ToggleGroup';
import { SideBySideComparison, ComparisonRow } from '@/components/couponmaxx/SideBySideComparison';

// ── Types ──────────────────────────────────────────────────────────

type ProductConversionRow = {
  productTitle: string;
  addedToCart: number;
  checkedOutWith: number;
  cartToCheckoutRate: number;
  removedFromCart: number;
  removeRate: number;
  avgCartValueWhenAdded: number;
};

type SourceConversionRow = {
  source: string;
  utmSource: string | null;
  utmMedium: string | null;
  cartSessions: number;
  checkedOut: number;
  cartToCheckoutRate: number;
  avgCartValue: number;
  couponUsedPct: number;
};

type DeviceMetrics = {
  cartSessions: number;
  cartToCheckoutRate: number;
  medianTimeToCheckoutMs: number;
  avgCartValueAtCheckout: number;
  avgItemsInCart: number;
  couponAttemptRate: number;
};

type CountryRow = {
  country: string;
  cartSessions: number;
  cartToCheckoutRate: number;
  avgCartValue: number;
};

type ConversionData = {
  kpis: {
    cartToCheckoutRate: number;
    cartToCheckoutRateDelta: number;
    cartSessions: number;
    cartSessionsDelta: number;
    couponAttemptSessions: number;
    abandonedCarts: number;
    abandonedCartsDelta: number;
    abandonedCartsPct: number;
  };
  products: ProductConversionRow[];
  sources: SourceConversionRow[];
  devices: {
    mobile: DeviceMetrics;
    desktop: DeviceMetrics;
    tablet?: DeviceMetrics;
    _tabletIncluded?: number;
  };
  topCountries: CountryRow[];
};

type RemovalRow = {
  productTitle: string;
  timesRemoved: number;
  removeRate: number;
  avgCartValueAtRemoval: number;
  productThatStayed: string | null;
};

type ActivityData = {
  kpis: {
    medianTimeToCheckoutMs: number;
    medianTimeToCheckoutDeltaMs: number;
    avgCartEditsPerSession: number;
    avgCartEditsDelta: number;
    avgCartValueChangePct: number;
    avgCartValueChangeDelta: number;
  };
  timeDistribution: { bucket: string; sessions: number }[];
  removals: RemovalRow[];
  cartValueTrend: {
    grewPct: number;
    grewAvgIncreaseDollars: number;
    shrankPct: number;
    shrankAvgDecreaseDollars: number;
    unchangedPct: number;
  };
  sessionPatterns: {
    oneAndDone: number;
    oneAndDonePct: number;
    deliberate: number;
    deliberatePct: number;
    lostAfterAdding: number;
    lostAfterAddingPct: number;
  };
};

// ── Helpers ────────────────────────────────────────────────────────

function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }

const DEFAULT_RANGE: DateRange = {
  start: subDays(new Date(), 7),
  end: new Date(),
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmt$(n: number) { return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }

function fmtMs(ms: number) {
  if (!ms || ms <= 0) return '—';
  const totalS = Math.round(ms / 1000);
  const m = Math.floor(totalS / 60);
  const s = totalS % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

function fmtDeltaMs(ms: number) {
  if (!ms) return null;
  const sign = ms > 0 ? '+' : '';
  return sign + fmtMs(Math.abs(ms));
}

function ctrColor(rate: number) {
  if (rate >= 60) return '#15803D';
  if (rate >= 40) return '#B45309';
  return '#B91C1C';
}

function DeltaBadge({ value, suffix = '' }: { value: number; suffix?: string }) {
  if (value === 0) return <span style={{ color: '#6B7280' }}>—</span>;
  const color = value > 0 ? '#15803D' : '#B91C1C';
  const sign = value > 0 ? '+' : '';
  return <span style={{ color }}>{sign}{value}{suffix}</span>;
}

function sortable<T>(
  rows: T[],
  col: keyof T,
  dir: 'asc' | 'desc',
): T[] {
  return [...rows].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (typeof av === 'number' && typeof bv === 'number') {
      return dir === 'desc' ? bv - av : av - bv;
    }
    return dir === 'desc'
      ? String(bv).localeCompare(String(av))
      : String(av).localeCompare(String(bv));
  });
}

function truncate(s: string, n = 35) {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

// ── Sub-components ─────────────────────────────────────────────────

function CountryFlag({ country }: { country: string }) {
  // Simple approach — map well-known codes to flags
  const flags: Record<string, string> = {
    US: '🇺🇸', GB: '🇬🇧', CA: '🇨🇦', AU: '🇦🇺', DE: '🇩🇪',
    FR: '🇫🇷', NL: '🇳🇱', SE: '🇸🇪', NO: '🇳🇴', DK: '🇩🇰',
    IN: '🇮🇳', BR: '🇧🇷', JP: '🇯🇵', KR: '🇰🇷', MX: '🇲🇽',
    Other: '🌍', Unknown: '❓',
  };
  const code = country.toUpperCase();
  const flag = flags[code] ?? '🏳️';
  return <>{flag} {country}</>;
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  );
}

function LaptopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}

// ── Conversion Tab ─────────────────────────────────────────────────

function ConversionTab({ data }: { data: ConversionData }) {
  const [toggle, setToggle] = useState('Products');
  const [productSort, setProductSort] = useState<{ col: keyof ProductConversionRow; dir: 'asc' | 'desc' }>({ col: 'addedToCart', dir: 'desc' });
  const [sourceSort, setSourceSort] = useState<{ col: keyof SourceConversionRow; dir: 'asc' | 'desc' }>({ col: 'cartSessions', dir: 'desc' });

  const { kpis, products, sources, devices, topCountries } = data;

  function thStyle(active: boolean): React.CSSProperties {
    return {
      padding: '8px 12px', fontSize: 12, fontWeight: 500,
      color: active ? '#111827' : '#6B7280',
      textAlign: 'right', cursor: 'pointer', userSelect: 'none',
      whiteSpace: 'nowrap',
      background: active ? '#F9FAFB' : undefined,
    };
  }

  function handleProductSort(col: keyof ProductConversionRow) {
    setProductSort(prev => ({
      col,
      dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  }

  function handleSourceSort(col: keyof SourceConversionRow) {
    setSourceSort(prev => ({
      col,
      dir: prev.col === col && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  }

  const sortedProducts = sortable(products, productSort.col, productSort.dir);
  const sortedSources  = sortable(sources, sourceSort.col, sourceSort.dir);

  const mobileCTR  = devices.mobile?.cartToCheckoutRate ?? 0;
  const desktopCTR = devices.desktop?.cartToCheckoutRate ?? 0;
  const showAmber  = mobileCTR > 0 && desktopCTR > 0 && (desktopCTR - mobileCTR) > 15;

  function deviceRows(dev: DeviceMetrics): ComparisonRow[] {
    return [
      { label: 'Cart sessions',              leftValue: dev.cartSessions.toLocaleString(),                              rightValue: devices.desktop.cartSessions.toLocaleString() },
      { label: 'Cart-to-checkout rate',      leftValue: `${dev.cartToCheckoutRate}%`,                                  rightValue: `${devices.desktop.cartToCheckoutRate}%` },
      { label: 'Avg time to checkout',       leftValue: fmtMs(dev.medianTimeToCheckoutMs),                             rightValue: fmtMs(devices.desktop.medianTimeToCheckoutMs) },
      { label: 'Avg cart value at checkout', leftValue: fmt$(dev.avgCartValueAtCheckout),                              rightValue: fmt$(devices.desktop.avgCartValueAtCheckout) },
      { label: 'Avg items in cart',          leftValue: dev.avgItemsInCart.toFixed(1),                                 rightValue: devices.desktop.avgItemsInCart.toFixed(1) },
      { label: 'Coupon attempt rate',        leftValue: `${dev.couponAttemptRate}%`,                                   rightValue: `${devices.desktop.couponAttemptRate}%` },
    ];
  }

  const tabletCount = devices._tabletIncluded as unknown as number | undefined;

  return (
    <BlockStack gap="400">
      {/* KPI Row */}
      <InlineGrid columns={3} gap="300">
        <KpiBox
          label="Cart-to-checkout rate"
          value={`${kpis.cartToCheckoutRate}%`}
          sub1={`${kpis.cartSessions.toLocaleString()} sessions reached checkout`}
          sub2={<DeltaBadge value={kpis.cartToCheckoutRateDelta} suffix="pp" />}
        />
        <KpiBox
          label="Cart sessions"
          value={kpis.cartSessions.toLocaleString()}
          sub1={`${kpis.couponAttemptSessions.toLocaleString()} with a coupon attempted`}
          sub2={<DeltaBadge value={kpis.cartSessionsDelta} suffix="%" />}
        />
        <KpiBox
          label="Abandoned carts"
          value={kpis.abandonedCarts.toLocaleString()}
          sub1={`${kpis.abandonedCartsPct}% of product sessions`}
          sub2={<DeltaBadge value={kpis.abandonedCartsDelta} suffix="%" />}
        />
      </InlineGrid>

      {/* Toggle Card */}
      <Card>
        <BlockStack gap="400">
          <InlineStack align="space-between" blockAlign="center">
            <Text variant="headingSm" as="h3">Cart conversion by {toggle.toLowerCase()}</Text>
            <ToggleGroup options={['Products', 'Sources', 'Devices']} active={toggle} onChange={setToggle} />
          </InlineStack>

          {toggle === 'Products' && (
            products.length === 0
              ? <Text as="p" tone="subdued">No cart sessions with products in this period.</Text>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                        <th style={{ ...thStyle(false), textAlign: 'left' }}>Product</th>
                        {(
                          [
                            ['addedToCart', 'Added to cart'],
                            ['checkedOutWith', 'Checked out with'],
                            ['cartToCheckoutRate', 'CTR'],
                            ['removedFromCart', 'Removed'],
                            ['removeRate', 'Remove rate'],
                            ['avgCartValueWhenAdded', 'Avg cart value'],
                          ] as [keyof ProductConversionRow, string][]
                        ).map(([col, label]) => (
                          <th key={col} style={thStyle(productSort.col === col)} onClick={() => handleProductSort(col)}>
                            {label} {productSort.col === col ? (productSort.dir === 'desc' ? '↓' : '↑') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedProducts.map((row) => (
                        <tr key={row.productTitle} style={{ borderBottom: '1px solid #F3F4F6' }}>
                          <td style={{ padding: '8px 12px', color: '#111827' }} title={row.productTitle}>
                            {truncate(row.productTitle)}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{row.addedToCart.toLocaleString()}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{row.checkedOutWith.toLocaleString()}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: ctrColor(row.cartToCheckoutRate) }}>
                            {row.cartToCheckoutRate}%
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6B7280' }}>
                            {row.removedFromCart === 0 ? '—' : row.removedFromCart.toLocaleString()}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', color: row.removeRate > 30 ? '#B45309' : '#374151' }}>
                            {row.removedFromCart === 0 ? '—' : `${row.removeRate}%`}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt$(row.avgCartValueWhenAdded)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}

          {toggle === 'Sources' && (
            sources.length === 0
              ? <Text as="p" tone="subdued">No UTM source data yet. Source tracking starts once customers arrive via a tracked link.</Text>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                        <th style={{ ...thStyle(false), textAlign: 'left' }}>Source</th>
                        {(
                          [
                            ['cartSessions', 'Cart sessions'],
                            ['checkedOut', 'Checked out'],
                            ['cartToCheckoutRate', 'CTR'],
                            ['avgCartValue', 'Avg cart value'],
                            ['couponUsedPct', 'Coupon used %'],
                          ] as [keyof SourceConversionRow, string][]
                        ).map(([col, label]) => (
                          <th key={col} style={thStyle(sourceSort.col === col)} onClick={() => handleSourceSort(col)}>
                            {label} {sourceSort.col === col ? (sourceSort.dir === 'desc' ? '↓' : '↑') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sortedSources.map((row) => (
                        <tr key={`${row.source}-${row.utmMedium}`} style={{ borderBottom: '1px solid #F3F4F6' }}>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ color: '#111827' }}>{row.source}</div>
                            {row.utmMedium && <div style={{ fontSize: 11, color: '#9CA3AF' }}>{row.utmMedium}</div>}
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{row.cartSessions.toLocaleString()}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{row.checkedOut.toLocaleString()}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: ctrColor(row.cartToCheckoutRate) }}>
                            {row.cartToCheckoutRate}%
                          </td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt$(row.avgCartValue)}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{row.couponUsedPct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}

          {toggle === 'Devices' && (
            <BlockStack gap="400">
              {!devices.mobile && !devices.desktop
                ? <Text as="p" tone="subdued">No device data in this period.</Text>
                : (
                  <SideBySideComparison
                    leftLabel={`Mobile${tabletCount ? ` (includes ${tabletCount} tablet)` : ''}`}
                    rightLabel="Desktop"
                    leftIcon={<PhoneIcon />}
                    rightIcon={<LaptopIcon />}
                    rows={deviceRows(devices.mobile)}
                    showAmberBanner={showAmber}
                    amberMessage="Mobile conversion is significantly lower than desktop"
                  />
                )
              }

              {/* Top 5 Countries */}
              {topCountries.length > 0 && (
                <BlockStack gap="200">
                  <Text variant="headingSm" as="h3">By country</Text>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                          <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 500, color: '#6B7280' }}>Country</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#6B7280' }}>Cart sessions</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#6B7280' }}>CTR</th>
                          <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#6B7280' }}>Avg cart value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topCountries.map((row) => (
                          <tr key={row.country} style={{ borderBottom: '1px solid #F3F4F6' }}>
                            <td style={{ padding: '8px 12px', color: '#111827' }}>
                              <CountryFlag country={row.country} />
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{row.cartSessions.toLocaleString()}</td>
                            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600, color: ctrColor(row.cartToCheckoutRate) }}>
                              {row.cartToCheckoutRate}%
                            </td>
                            <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt$(row.avgCartValue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </BlockStack>
              )}
            </BlockStack>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

// ── Activity Tab ───────────────────────────────────────────────────

function ActivityTab({ data, shop }: { data: ActivityData; shop: string }) {
  const { kpis, timeDistribution, removals, cartValueTrend, sessionPatterns } = data;

  const valuePct = kpis.avgCartValueChangePct;
  const valueColor = Math.abs(valuePct) <= 2 ? '#6B7280' : valuePct > 0 ? '#15803D' : '#B91C1C';
  const valueSub1 = Math.abs(valuePct) <= 2
    ? 'Most customers buy what they first added'
    : valuePct > 0
    ? 'Carts are growing before checkout'
    : 'Customers are trimming carts before checkout';

  return (
    <BlockStack gap="400">
      {/* KPI Row */}
      <InlineGrid columns={3} gap="300">
        <KpiBox
          label="Median time to checkout"
          value={fmtMs(kpis.medianTimeToCheckoutMs)}
          sub1="For sessions that reached checkout"
          sub2={fmtDeltaMs(kpis.medianTimeToCheckoutDeltaMs) ? <DeltaBadge value={kpis.medianTimeToCheckoutDeltaMs / 1000} suffix="s" /> : undefined}
        />
        <KpiBox
          label="Avg cart edits per session"
          value={kpis.avgCartEditsPerSession.toFixed(1)}
          sub1="Adds, removes, and quantity changes"
          sub2={<DeltaBadge value={kpis.avgCartEditsDelta} />}
        />
        <KpiBox
          label="Avg cart value change"
          value={`${valuePct >= 0 ? '+' : ''}${valuePct}%`}
          sub1={valueSub1}
          sub2={<DeltaBadge value={kpis.avgCartValueChangeDelta} suffix="pp" />}
        />
      </InlineGrid>

      {/* Time Distribution Chart */}
      <Card>
        <BlockStack gap="300">
          <div>
            <Text variant="headingSm" as="h3">How long customers take before checking out</Text>
            <Text variant="bodySm" tone="subdued" as="p">Sessions that reached checkout, by time spent in cart</Text>
          </div>
          {timeDistribution.every((b) => b.sessions === 0)
            ? <Text as="p" tone="subdued">No sessions reached checkout in this period.</Text>
            : (
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={timeDistribution} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#6B7280' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} width={32} />
                    <Tooltip
                      formatter={(value) => [`${value} sessions`, '']}
                      labelFormatter={(label) => `${label}`}
                      contentStyle={{ fontSize: 12 }}
                    />
                    <Bar dataKey="sessions" fill="#0EA5E9" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )
          }
        </BlockStack>
      </Card>

      {/* Products Removed */}
      <Card>
        <BlockStack gap="300">
          <div>
            <Text variant="headingSm" as="h3">Products removed before checkout</Text>
            <Text variant="bodySm" tone="subdued" as="p">What customers add then take out</Text>
          </div>
          {removals.length === 0 ? (
            <BlockStack gap="100">
              <Text as="p" tone="subdued">No products were removed from carts in this period.</Text>
              <Text as="p" tone="subdued">Customers kept everything they added.</Text>
            </BlockStack>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 500, color: '#6B7280' }}>Product removed</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#6B7280' }}>Times removed</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#6B7280' }}>Remove rate</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 500, color: '#6B7280' }}>Avg cart value at removal</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 12, fontWeight: 500, color: '#6B7280' }}>Product that stayed</th>
                  </tr>
                </thead>
                <tbody>
                  {removals.map((row) => (
                    <tr key={row.productTitle} style={{ borderBottom: '1px solid #F3F4F6' }}>
                      <td style={{ padding: '8px 12px', color: '#111827' }} title={row.productTitle}>
                        {truncate(row.productTitle)}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{row.timesRemoved.toLocaleString()}</td>
                      <td style={{
                        padding: '8px 12px', textAlign: 'right', fontWeight: 500,
                        color: row.removeRate >= 50 ? '#B91C1C' : row.removeRate >= 30 ? '#B45309' : '#374151',
                      }}>
                        {row.removeRate}%
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{fmt$(row.avgCartValueAtRemoval)}</td>
                      <td style={{ padding: '8px 12px', color: '#6B7280' }}>
                        {row.productThatStayed ? truncate(row.productThatStayed) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </BlockStack>
      </Card>

      {/* Cart Value Trend */}
      <Card>
        <BlockStack gap="300">
          <Text variant="headingSm" as="h3">Cart value trend at checkout</Text>
          <InlineGrid columns={3} gap="300">
            <KpiBox
              label="Cart value increased"
              value={`${cartValueTrend.grewPct}%`}
              sub1={`avg increase: +${fmt$(cartValueTrend.grewAvgIncreaseDollars)} per session`}
            />
            <KpiBox
              label="Cart value decreased"
              value={`${cartValueTrend.shrankPct}%`}
              sub1={`avg trimmed: -${fmt$(cartValueTrend.shrankAvgDecreaseDollars)} per session`}
            />
            <KpiBox
              label="Cart value unchanged"
              value={`${cartValueTrend.unchangedPct}%`}
              sub1="one product, straight to checkout"
            />
          </InlineGrid>
        </BlockStack>
      </Card>

      {/* Session Patterns */}
      <Card>
        <BlockStack gap="300">
          <Text variant="headingSm" as="h3">Session patterns</Text>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
            {[
              {
                count: sessionPatterns.oneAndDone,
                pct: sessionPatterns.oneAndDonePct,
                label: 'Added one product, checked out',
              },
              {
                count: sessionPatterns.deliberate,
                pct: sessionPatterns.deliberatePct,
                label: 'Edited cart 3+ times before checkout',
              },
              {
                count: sessionPatterns.lostAfterAdding,
                pct: sessionPatterns.lostAfterAddingPct,
                label: 'Added to cart, then disappeared',
              },
            ].map((block) => (
              <div
                key={block.label}
                style={{ padding: '16px 20px', borderBottom: '2px solid #E5E7EB' }}
              >
                <div style={{ fontSize: 28, fontWeight: 700, color: '#111827', lineHeight: 1.2 }}>
                  {block.count.toLocaleString()}
                </div>
                <div style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>{block.label}</div>
                <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>{block.pct}%</div>
              </div>
            ))}
          </div>
          {sessionPatterns.lostAfterAdding > 0 && (
            <div style={{ fontSize: 12, color: '#6B7280' }}>
              <a
                href={`/couponmaxx/sessions?filter=lostAfterAdding&shop=${shop}`}
                style={{ color: '#0EA5E9', textDecoration: 'none' }}
              >
                View these {sessionPatterns.lostAfterAdding.toLocaleString()} sessions →
              </a>
            </div>
          )}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

// ── Page ───────────────────────────────────────────────────────────

export default function CartPage() {
  const shop = useShop();
  const [tab, setTab] = useState<'Conversion' | 'Activity'>('Conversion');
  const [dateRange, setDateRange] = useState<DateRange>(DEFAULT_RANGE);

  const params = shop
    ? `?shop=${shop}&start=${dateRange.start.toISOString()}&end=${dateRange.end.toISOString()}`
    : null;

  const conversionKey = tab === 'Conversion' && params ? `/api/couponmaxx/cart/conversion${params}` : null;
  const activityKey   = tab === 'Activity'   && params ? `/api/couponmaxx/cart/activity${params}`   : null;

  const { data: conversionData, isLoading: convLoading } = useSWR<ConversionData>(conversionKey, fetcher);
  const { data: activityData,   isLoading: actLoading   } = useSWR<ActivityData>(activityKey,   fetcher);

  const isLoading = tab === 'Conversion' ? convLoading : actLoading;

  return (
    <BlockStack gap="400">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Text variant="headingLg" as="h1">Cart</Text>
          <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0' }}>
            Where your carts are leaking and what happens inside them.
          </p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} defaultDays={7} />
      </div>

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #E5E7EB' }}>
        {(['Conversion', 'Activity'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px',
              fontSize: 14,
              fontWeight: tab === t ? 500 : 400,
              color: tab === t ? '#111827' : '#6B7280',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #0EA5E9' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <LoadingBar loading={isLoading} />

      {/* Tab Content */}
      {tab === 'Conversion' && (
        conversionData
          ? <ConversionTab data={conversionData} />
          : !isLoading && params && <Text as="p" tone="subdued">No data available.</Text>
      )}
      {tab === 'Activity' && (
        activityData
          ? <ActivityTab data={activityData} shop={shop ?? ''} />
          : !isLoading && params && <Text as="p" tone="subdued">No data available.</Text>
      )}
    </BlockStack>
  );
}
