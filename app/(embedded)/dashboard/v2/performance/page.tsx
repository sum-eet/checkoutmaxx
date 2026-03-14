'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Page,
  Layout,
  Card,
  Text,
  InlineStack,
  BlockStack,
  EmptyState,
  Banner,
  SkeletonBodyText,
} from '@shopify/polaris';
import { useShop } from '@/hooks/useShop';
import { DateRangeSelector, type DateRange } from '@/components/monitor/DateRangeSelector';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
  BarChart as HBarChart,
} from 'recharts';

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86400000);
}
const fetcher = (url: string) => fetch(url).then((r) => r.json());

function CompRow({ label, left, right }: { label: string; left: string; right: string }) {
  return (
    <tr style={{ borderBottom: '1px solid #f4f6f8' }}>
      <td style={{ padding: '8px 12px', color: '#6d7175', fontSize: 13 }}>{label}</td>
      <td style={{ padding: '8px 12px', fontWeight: 500, fontSize: 13 }}>{left}</td>
      <td style={{ padding: '8px 12px', fontWeight: 500, fontSize: 13 }}>{right}</td>
    </tr>
  );
}

function fmt(v: number | null | undefined, type: 'dollar' | 'count' | 'pct' | 'duration' | 'text', fallback = '—'): string {
  if (v == null) return fallback;
  if (type === 'dollar') return `$${v.toFixed(2)}`;
  if (type === 'pct') return `${v.toFixed(1)}%`;
  if (type === 'count') return v.toFixed(1);
  if (type === 'duration') {
    const ms = v;
    if (ms < 60000) return `< 1m`;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
  }
  return String(v);
}

export default function PerformancePage() {
  const shop = useShop();
  const now = new Date();
  const [range, setRange] = useState<DateRange>({ start: subDays(now, 7), end: now });

  const rangeQuery = `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;
  const { data, error, isLoading } = useSWR(
    shop ? `/api/v2/performance?shop=${shop}&${rangeQuery}` : null,
    fetcher,
    { refreshInterval: 120000 }
  );

  const comparison = data?.comparison;
  const bands: { label: string; minCents: number; maxCents: number; sessions: number; conversions: number; conversionRate: number; isAovBand: boolean }[] = data?.conversionBands ?? [];
  const coupons: { code: string | null; sessions: number; convRate: number; avgCartDollars: number; avgDiscountDollars: number; revPerSession: number; vsBaseline: number; isLowData: boolean }[] = data?.revenuePerCoupon ?? [];
  const aovCents: number = data?.aovCents ?? 0;

  // Overall CVR across all bands (for colour logic)
  const totalCheckoutSessions = bands.reduce((a, b) => a + b.sessions, 0);
  const totalConversions = bands.reduce((a, b) => a + b.conversions, 0);
  const overallCvr = totalCheckoutSessions > 0 ? (totalConversions / totalCheckoutSessions) * 100 : 0;

  // Insight line
  const sufficientBands = bands.filter((b) => b.sessions >= 10);
  const highestBand = [...sufficientBands].sort((a, b) => b.conversionRate - a.conversionRate)[0];
  const aovBand = bands.find((b) => aovCents >= b.minCents && aovCents < b.maxCents);
  let insight: string | null = null;
  if (highestBand && aovBand) {
    if (highestBand.label !== aovBand.label) {
      insight = `Sessions with carts of ${highestBand.label} convert at ${highestBand.conversionRate.toFixed(0)}% vs ${(aovBand.conversionRate ?? 0).toFixed(0)}% for your average cart of $${(aovCents / 100).toFixed(0)}.`;
    } else {
      insight = `Your average cart of $${(aovCents / 100).toFixed(0)} is already in your best-converting range (${highestBand.conversionRate.toFixed(0)}%).`;
    }
  }

  // Bar colours
  function bandColor(band: { sessions: number; conversionRate: number; isAovBand: boolean }): string {
    if (band.sessions < 10) return '#c4c4c4';
    if (band.conversionRate >= overallCvr + 10) return '#1a6bbb';
    if (band.conversionRate >= overallCvr) return '#2c6ecb';
    return '#c4c4c4';
  }

  // Coupon bar colours
  function couponColor(row: { code: string | null; vsBaseline: number; isLowData: boolean }): string {
    if (row.code === null) return '#c4c4c4';
    if (row.isLowData) return '#c4c4c4';
    if (row.vsBaseline > 5) return '#108043';
    if (row.vsBaseline < -5) return '#d82c0d';
    return '#c4c4c4';
  }

  // Coupon delta label
  function couponDelta(row: { code: string | null; vsBaseline: number; isLowData: boolean }): string {
    if (row.code === null) return 'baseline';
    if (row.isLowData) return 'Low data';
    const sign = row.vsBaseline >= 0 ? '+' : '';
    return `${sign}$${row.vsBaseline.toFixed(2)} vs no coupon`;
  }

  const converted = comparison?.converted;
  const abandoned = comparison?.abandoned;

  return (
    <Page
      title="Cart Performance"
      primaryAction={<DateRangeSelector value={range} onChange={setRange} />}
    >
      {error && (
        <Banner tone="critical" title="Failed to load performance data">
          <p>Please refresh the page.</p>
        </Banner>
      )}

      <Layout>
        {/* Converted vs Abandoned */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Converting sessions vs abandoned sessions</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Based on {data?.basedOnSessions ?? 0} sessions with products in cart
                </Text>
              </BlockStack>

              {isLoading ? (
                <SkeletonBodyText lines={8} />
              ) : !converted && !abandoned ? (
                <EmptyState heading="No sessions in this period" image="">
                  <p>Cart sessions will appear here once customers visit the store.</p>
                </EmptyState>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e1e3e5' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6d7175', fontWeight: 500 }}></th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#008060', fontWeight: 600 }}>
                          Converted ({(comparison?.convertedCount ?? 0).toLocaleString()} sessions)
                        </th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', color: '#d72c0d', fontWeight: 600 }}>
                          Abandoned ({(comparison?.abandonedCount ?? 0).toLocaleString()} sessions)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <CompRow label="Avg cart value" left={fmt(converted?.avgCartValue, 'dollar')} right={fmt(abandoned?.avgCartValue, 'dollar')} />
                      <CompRow label="Avg items in cart" left={fmt(converted?.avgItemCount, 'count')} right={fmt(abandoned?.avgItemCount, 'count')} />
                      <CompRow label="Used a discount code" left={fmt(converted?.couponUsagePct, 'pct')} right={fmt(abandoned?.couponUsagePct, 'pct')} />
                      <CompRow label="Time in cart (median)" left={fmt(converted?.medianDurationMs, 'duration')} right={fmt(abandoned?.medianDurationMs, 'duration')} />
                      <CompRow
                        label="Cart composition"
                        left={converted ? `${(converted.singleProductPct ?? 0).toFixed(0)}% single · ${(converted.multiProductPct ?? 0).toFixed(0)}% multi` : '—'}
                        right={abandoned ? `${(abandoned.singleProductPct ?? 0).toFixed(0)}% single · ${(abandoned.multiProductPct ?? 0).toFixed(0)}% multi` : '—'}
                      />
                      <CompRow
                        label="Most common product"
                        left={converted?.mostCommonProduct ? converted.mostCommonProduct.slice(0, 35) : '—'}
                        right={abandoned?.mostCommonProduct ? abandoned.mostCommonProduct.slice(0, 35) : '—'}
                      />
                      <CompRow
                        label="Most common combination"
                        left={converted?.mostCommonCombination ?? '—'}
                        right={abandoned?.mostCommonCombination ?? '—'}
                      />
                    </tbody>
                  </table>
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Conversion by Cart Value */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">Conversion rate by cart value</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Based on {data?.basedOnSessions ?? 0} sessions
                </Text>
              </BlockStack>

              {isLoading ? (
                <SkeletonBodyText lines={6} />
              ) : bands.length === 0 || totalCheckoutSessions < 10 ? (
                <EmptyState heading="Not enough data yet" image="">
                  <p>Based on {totalCheckoutSessions} sessions. Select a wider date range for more data.</p>
                </EmptyState>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={bands} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                      <RechartsTooltip
                        formatter={(value) => [`${Number(value).toFixed(1)}%`, 'Conversion rate']}
                        content={({ active, payload }) => {
                          if (!active || !payload?.[0]) return null;
                          const d = payload[0].payload;
                          return (
                            <div style={{ background: '#fff', border: '1px solid #e1e3e5', padding: '8px 12px', borderRadius: 6, fontSize: 12 }}>
                              <div style={{ fontWeight: 600 }}>{d.label} carts</div>
                              <div>Conversion rate: {d.conversionRate.toFixed(1)}%</div>
                              <div>{d.sessions} attempted checkout</div>
                              <div>{d.conversions} completed order</div>
                            </div>
                          );
                        }}
                      />
                      <ReferenceLine y={overallCvr} stroke="#c4c4c4" strokeDasharray="4 2" label={{ value: `Avg CVR ${overallCvr.toFixed(0)}%`, fontSize: 11, fill: '#6d7175' }} />
                      <Bar dataKey="conversionRate" radius={[4, 4, 0, 0]}>
                        {bands.map((band, i) => (
                          <Cell key={i} fill={bandColor(band)} stroke={band.isAovBand ? '#2c6ecb' : 'none'} strokeWidth={2} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                  {insight && (
                    <Text as="p" variant="bodySm" tone="subdued">{insight}</Text>
                  )}
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Revenue Per Coupon */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">How discounts affect revenue per session</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Net revenue generated per session, by discount code
                </Text>
              </BlockStack>

              {isLoading ? (
                <SkeletonBodyText lines={6} />
              ) : coupons.length <= 1 ? (
                <EmptyState heading="No discount codes used in this period" image="">
                  <p>Coupon attempts will appear here once customers try discount codes.</p>
                </EmptyState>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={Math.max(120, coupons.length * 40)}>
                    <BarChart
                      layout="vertical"
                      data={coupons}
                      margin={{ top: 8, right: 100, bottom: 8, left: 80 }}
                    >
                      <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(0)}`} />
                      <YAxis type="category" dataKey="code" tick={{ fontSize: 12 }} tickFormatter={(v) => v ?? 'No coupon'} width={80} />
                      <RechartsTooltip
                        formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Rev/session']}
                      />
                      <Bar dataKey="revPerSession" radius={[0, 4, 4, 0]}>
                        {coupons.map((row, i) => (
                          <Cell key={i} fill={couponColor(row)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Exact numbers table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e1e3e5' }}>
                          {['Code', 'Sessions', 'Conv%', 'Avg cart', 'Avg discount', 'Rev/session', 'vs baseline'].map((h) => (
                            <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#6d7175', fontWeight: 500 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {coupons.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f4f6f8' }}>
                            <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: i === 0 ? 600 : 400 }}>
                              {row.code ?? 'No coupon'}
                            </td>
                            <td style={{ padding: '6px 10px' }}>{row.sessions}</td>
                            <td style={{ padding: '6px 10px' }}>{row.convRate.toFixed(1)}%</td>
                            <td style={{ padding: '6px 10px' }}>${row.avgCartDollars.toFixed(2)}</td>
                            <td style={{ padding: '6px 10px' }}>${row.avgDiscountDollars.toFixed(2)}</td>
                            <td style={{ padding: '6px 10px', fontWeight: 500 }}>${row.revPerSession.toFixed(2)}</td>
                            <td style={{ padding: '6px 10px', color: row.code === null ? '#6d7175' : row.vsBaseline > 5 ? '#108043' : row.vsBaseline < -5 ? '#d82c0d' : '#6d7175' }}>
                              {couponDelta(row)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <Text as="p" variant="bodySm" tone="subdued">
                    Rev/session = (avg cart value − avg discount) × conversion rate. A code with higher rev/session than baseline generates more net revenue per visitor than no discount at all.
                  </Text>
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
