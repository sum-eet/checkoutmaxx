'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Banner, Select, InlineStack } from '@shopify/polaris';

import { useShop } from '@/hooks/useShop';
import { DateRangePicker, DateRange } from '@/components/couponmaxx/DateRangePicker';
import { MetricCard } from '@/components/couponmaxx/MetricCard';
import { FunnelChart } from '@/components/couponmaxx/FunnelChart';
import { OnboardingBanner } from '@/components/couponmaxx/OnboardingBanner';

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

  // Date range — default last 7 days
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const end = new Date();
    return { start: subDays(end, 7), end };
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

  // App status: whether we have received any data yet
  const hasData = !!(data && (
    data.funnel.cartViews > 0 ||
    data.cartViews.total.total > 0
  ));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Onboarding banner (dismissible setup guide) */}
      <OnboardingBanner />

      {/* App status banner — only after onboarding dismissed, before data arrives */}
      {!isLoading && !hasData && !error && (
        <Banner tone="info">
          No cart activity yet for this period. Data appears as customers visit your cart.
        </Banner>
      )}

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
        <InlineStack gap="200" blockAlign="center">
          <DateRangePicker value={dateRange} onChange={setDateRange} defaultDays={7} />
          <Select
            label="Compare to"
            labelInline
            options={[
              { label: 'No comparison', value: '' },
              { label: 'Previous period', value: 'previous_period' },
              { label: 'Previous year', value: 'previous_year' },
            ]}
            value={compareTo}
            onChange={(v) => setCompareTo(v as CompareOption)}
          />
        </InlineStack>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Row 1 — Filter pills                                                */}
      {/* ------------------------------------------------------------------ */}
      <InlineStack gap="300" blockAlign="center">
        <Select
          label="Device"
          labelInline
          options={deviceOptions}
          value={device}
          onChange={setDevice}
        />
        <Select
          label="UTM source"
          labelInline
          options={utmSourceOptions}
          value={utmSource}
          onChange={setUtmSource}
        />
      </InlineStack>

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
          title="Coupon usage rate"
          definition="Percent of product carts where a customer entered a coupon code"
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
