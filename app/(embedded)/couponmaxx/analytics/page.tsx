'use client';

import { useState, useRef, useEffect } from 'react';
import useSWR from 'swr';
import { Banner } from '@shopify/polaris';

import { useShop } from '@/hooks/useShop';
import { DateRangePicker, DateRange } from '@/components/couponmaxx/DateRangePicker';
import { FilterPill } from '@/components/couponmaxx/FilterPill';
import { MetricCard } from '@/components/couponmaxx/MetricCard';
import { FunnelChart } from '@/components/couponmaxx/FunnelChart';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DailyPoint = { date: string; value: number };

type AnalyticsData = {
  couponSuccessRate: {
    average: number;
    daily: DailyPoint[];
    comparison?: DailyPoint[];
  };
  cartsWithCoupon: {
    average: number;
    daily: DailyPoint[];
    comparison?: DailyPoint[];
  };
  attributedSales: {
    total: number;
    daily: DailyPoint[];
    comparison?: DailyPoint[];
  };
  cartViews: {
    total: { total: number; daily: DailyPoint[] };
    withProducts: { total: number; daily: DailyPoint[] };
    checkouts: { total: number; daily: DailyPoint[] };
    comparison?: {
      total: { total: number; daily: DailyPoint[] };
      withProducts: { total: number; daily: DailyPoint[] };
      checkouts: { total: number; daily: DailyPoint[] };
    };
  };
  funnel: {
    cartViews: number;
    cartsWithProducts: number;
    couponsAttempted: number;
    couponsApplied: number;
    couponsFailed: number;
    reachedCheckout: number;
    daily?: {
      cartViews: DailyPoint[];
      cartsWithProducts: DailyPoint[];
      couponsAttempted: DailyPoint[];
      couponsApplied: DailyPoint[];
      couponsFailed: DailyPoint[];
      reachedCheckout: DailyPoint[];
    };
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function subDays(d: Date, n: number) {
  return new Date(d.getTime() - n * 86400000);
}

function toISO(d: Date) {
  return d.toISOString();
}

function fmtPct(v: number) {
  return `${v.toFixed(1)}%`;
}

function fmtDollars(v: number) {
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`;
}

function fmtInt(v: number) {
  return v.toLocaleString();
}

// ---------------------------------------------------------------------------
// Compare-to pill component
// ---------------------------------------------------------------------------

type CompareOption = '' | 'previous_period' | 'previous_year';

function CompareToDropdown({
  value,
  onChange,
}: {
  value: CompareOption;
  onChange: (v: CompareOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const options: { label: string; value: CompareOption }[] = [
    { label: 'No comparison', value: '' },
    { label: 'Previous period', value: 'previous_period' },
    { label: 'Previous year', value: 'previous_year' },
  ];

  const selectedLabel = options.find((o) => o.value === value)?.label ?? 'Compare to';
  const active = value !== '';

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px',
          border: active ? '1px solid #BFDBFE' : '1px solid #D1D5DB',
          borderRadius: 6,
          background: active ? '#EFF6FF' : '#FFFFFF',
          color: active ? '#1D4ED8' : '#374151',
          fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {active ? selectedLabel : 'Compare to'}
        {active && (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            style={{ marginLeft: 2, fontSize: 14, lineHeight: 1, color: '#1D4ED8', fontWeight: 700 }}
          >×</span>
        )}
        {!active && <span style={{ fontSize: 10, marginLeft: 2 }}>▾</span>}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 100,
          background: '#fff', border: '1px solid #E3E3E3', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: 180, padding: '4px 0',
        }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '8px 14px', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 13,
                color: opt.value === value ? '#1D4ED8' : '#374151', textAlign: 'left', gap: 8,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F9FAFB'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
            >
              <span>{opt.label}</span>
              {opt.value === value && <span style={{ color: '#1D4ED8', fontSize: 13 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

async function fetcher(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<AnalyticsData>;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnalyticsPage() {
  const shop = useShop();

  // Date range — default last 30 days
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const end = new Date();
    return { start: subDays(end, 30), end };
  });

  // Compare to
  const [compareTo, setCompareTo] = useState<CompareOption>('');

  // Filters
  const [device, setDevice] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [product, setProduct] = useState('');

  // Attributed sales dropdowns
  const [attrWindow, setAttrWindow] = useState<'1' | '7' | '14' | '30'>('14');
  const [priceType, setPriceType] = useState<'pre' | 'post'>('pre');

  // Cart view metric switcher
  const [cartViewMetric, setCartViewMetric] = useState<'total' | 'withProducts' | 'checkouts'>('total');

  // ---------------------------------------------------------------------------
  // Build SWR key
  // ---------------------------------------------------------------------------

  const swrKey = shop
    ? (() => {
        const p = new URLSearchParams();
        p.set('shop', shop);
        p.set('start', toISO(dateRange.start));
        p.set('end', toISO(dateRange.end));
        if (device) p.set('device', device);
        if (utmSource) p.set('utmSource', utmSource);
        if (product) p.set('product', product);
        if (compareTo) p.set('compareTo', compareTo);
        p.set('attrWindow', attrWindow);
        p.set('priceType', priceType);
        return `/api/couponmaxx/analytics?${p.toString()}`;
      })()
    : null;

  const { data, isLoading, error } = useSWR<AnalyticsData>(swrKey, fetcher, {
    keepPreviousData: true,
  });

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------

  const compareActive = compareTo !== '';

  // Coupon success rate
  const successRateData = data?.couponSuccessRate.daily ?? [];
  const successRateCompare = compareActive ? (data?.couponSuccessRate.comparison ?? []) : undefined;
  const successRateBigNum = data
    ? fmtPct(data.couponSuccessRate.average)
    : '—';

  // Carts with coupon
  const cartsWithCouponData = data?.cartsWithCoupon.daily ?? [];
  const cartsWithCouponCompare = compareActive ? (data?.cartsWithCoupon.comparison ?? []) : undefined;
  const cartsWithCouponBigNum = data
    ? fmtPct(data.cartsWithCoupon.average)
    : '—';

  // Attributed sales
  const attributedSalesData = data?.attributedSales.daily ?? [];
  const attributedSalesCompare = compareActive ? (data?.attributedSales.comparison ?? []) : undefined;
  const attributedSalesBigNum = data
    ? `$${data.attributedSales.total.toLocaleString()}`
    : '—';

  const attributedSalesDefinition =
    priceType === 'pre'
      ? 'Total pre-discount cart value from sessions with a coupon, within the attribution window'
      : 'Total post-discount revenue from sessions with a coupon, within the attribution window';

  // Cart views — metric switcher
  const cartViewsVariant = data?.cartViews[cartViewMetric];
  const cartViewsData = cartViewsVariant?.daily ?? [];
  const cartViewsCompare = compareActive
    ? (data?.cartViews.comparison?.[cartViewMetric]?.daily ?? [])
    : undefined;
  const cartViewsBigNum = cartViewsVariant
    ? cartViewsVariant.total.toLocaleString()
    : '—';

  const cartViewsDefinitions: Record<string, string> = {
    total: 'Total number of cart sessions opened',
    withProducts: 'Sessions where at least one product was in the cart',
    checkouts: 'Sessions that reached Shopify checkout',
  };

  // Funnel columns
  const funnelColumns = [
    {
      key: 'cartViews',
      label: 'Cart views',
      value: data?.funnel.cartViews ?? 0,
      daily: data?.funnel.daily?.cartViews,
    },
    {
      key: 'cartsWithProducts',
      label: 'Carts with products',
      value: data?.funnel.cartsWithProducts ?? 0,
      daily: data?.funnel.daily?.cartsWithProducts,
    },
    {
      key: 'couponsAttempted',
      label: 'Coupons attempted',
      value: data?.funnel.couponsAttempted ?? 0,
      daily: data?.funnel.daily?.couponsAttempted,
    },
    {
      key: 'couponsApplied',
      label: 'Coupons applied',
      value: data?.funnel.couponsApplied ?? 0,
      daily: data?.funnel.daily?.couponsApplied,
    },
    {
      key: 'couponsFailed',
      label: 'Coupons failed',
      value: data?.funnel.couponsFailed ?? 0,
      daily: data?.funnel.daily?.couponsFailed,
    },
    {
      key: 'reachedCheckout',
      label: 'Reached checkout',
      value: data?.funnel.reachedCheckout ?? 0,
      daily: data?.funnel.daily?.reachedCheckout,
    },
  ];

  // ---------------------------------------------------------------------------
  // Filter options
  // ---------------------------------------------------------------------------

  const deviceOptions = [
    { label: 'All devices', value: '' },
    { label: 'Desktop', value: 'Desktop' },
    { label: 'Mobile', value: 'Mobile' },
    { label: 'Tablet', value: 'Tablet' },
  ];

  const utmSourceOptions = [
    { label: 'All sources', value: '' },
    { label: 'Direct', value: 'Direct' },
    { label: 'Paid search', value: 'Paid search' },
    { label: 'Social', value: 'Social' },
    { label: 'Email', value: 'Email' },
  ];

  const productOptions = [
    { label: 'All products', value: '' },
  ];

  // ---------------------------------------------------------------------------
  // Attribution window + priceType dropdown options for MetricCard
  // ---------------------------------------------------------------------------

  const attrWindowOptions = [
    { label: '1 day', value: '1' },
    { label: '7 days', value: '7' },
    { label: '14 days', value: '14' },
    { label: '30 days', value: '30' },
  ];

  const priceTypeOptions = [
    { label: 'Pre-discount', value: 'pre' },
    { label: 'Post-discount', value: 'post' },
  ];

  const cartViewMetricOptions = [
    { label: 'Cart views', value: 'total' },
    { label: 'Carts with products', value: 'withProducts' },
    { label: 'Checkouts', value: 'checkouts' },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Error banner */}
      {error && (
        <Banner tone="critical">
          Failed to load analytics data. Please try again.
        </Banner>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Row 0 — Page title + date controls                                  */}
      {/* ------------------------------------------------------------------ */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
      }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: '#111827' }}>
          Analytics
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <DateRangePicker value={dateRange} onChange={setDateRange} defaultDays={30} />
          <CompareToDropdown value={compareTo} onChange={setCompareTo} />
          {compareActive && (
            <span style={{ fontSize: 12, color: '#9CA3AF' }}>
              vs. {compareTo === 'previous_period' ? 'previous period' : 'previous year'}
            </span>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Row 1 — Filter pills                                                */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: '#6B7280', fontWeight: 500 }}>Add filters</span>
        <FilterPill
          label="Product"
          value={product}
          options={productOptions}
          onChange={setProduct}
        />
        <FilterPill
          label="Device type"
          value={device}
          options={deviceOptions}
          onChange={setDevice}
        />
        <FilterPill
          label="UTM source"
          value={utmSource}
          options={utmSourceOptions}
          onChange={setUtmSource}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Row 2 — Metric cards: Coupon success rate + Carts with coupon      */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <MetricCard
          title="Coupon success rate"
          definition="Percent of coupon applications that were successfully applied"
          bigNumber={successRateBigNum}
          data={successRateData}
          compareData={successRateCompare}
          formatY={fmtPct}
          formatTooltip={(v) => fmtPct(v)}
          emptyMessage="No coupon data in this period"
          loading={isLoading}
          error={!!error}
        />

        <MetricCard
          title="Carts with coupon applied"
          definition="Percent of product carts where a coupon code was attempted"
          bigNumber={cartsWithCouponBigNum}
          data={cartsWithCouponData}
          compareData={cartsWithCouponCompare}
          formatY={fmtPct}
          formatTooltip={(v) => fmtPct(v)}
          emptyMessage="No cart data in this period"
          loading={isLoading}
          error={!!error}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Row 3 — Attributed sales + Cart views                              */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <MetricCard
          title="Attributed sales"
          titleDropdowns={[
            {
              value: attrWindow,
              options: attrWindowOptions,
              onChange: (v) => setAttrWindow(v as typeof attrWindow),
            },
            {
              value: priceType,
              options: priceTypeOptions,
              onChange: (v) => setPriceType(v as typeof priceType),
            },
          ]}
          definition={attributedSalesDefinition}
          bigNumber={attributedSalesBigNum}
          data={attributedSalesData}
          compareData={attributedSalesCompare}
          formatY={fmtDollars}
          formatTooltip={(v) => `$${v.toLocaleString()}`}
          emptyMessage="No attributed sales in this period"
          loading={isLoading}
          error={!!error}
        />

        <MetricCard
          title="Cart views"
          titleDropdowns={[
            {
              value: cartViewMetric,
              options: cartViewMetricOptions,
              onChange: (v) => setCartViewMetric(v as typeof cartViewMetric),
            },
          ]}
          definition={cartViewsDefinitions[cartViewMetric]}
          bigNumber={cartViewsBigNum}
          data={cartViewsData}
          compareData={cartViewsCompare}
          formatY={fmtInt}
          formatTooltip={(v) => v.toLocaleString()}
          emptyMessage="No cart data in this period"
          loading={isLoading}
          error={!!error}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Row 4 — Coupon funnel (full width card)                            */}
      {/* ------------------------------------------------------------------ */}
      <div style={{
        background: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: 8, padding: 20,
      }}>
        <FunnelChart columns={funnelColumns} loading={isLoading} />
      </div>

    </div>
  );
}
