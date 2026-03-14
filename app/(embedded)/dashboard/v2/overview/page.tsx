'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Page,
  Layout,
  Card,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  Box,
  Banner,
  SkeletonBodyText,
  SkeletonDisplayText,
  EmptyState,
} from '@shopify/polaris';
import { useShop } from '@/hooks/useShop';
import { DateRangeSelector, type DateRange } from '@/components/monitor/DateRangeSelector';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86400000);
}
const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatDelta(delta: number, type: 'pct' | 'pp' | 'dollar'): string {
  const sign = delta >= 0 ? '+' : '';
  if (type === 'dollar') return `${sign}$${Math.abs(delta).toFixed(2)}`;
  if (type === 'pp') return `${sign}${delta.toFixed(1)}pp`;
  return `${sign}${delta.toFixed(1)}%`;
}

function deltaColor(delta: number, threshold = 0): string {
  if (Math.abs(delta) <= threshold) return '#6d7175';
  return delta > 0 ? '#008060' : '#d72c0d';
}

type SparkPoint = { label: string; value: number };

type SparklineProps = {
  current: SparkPoint[];
  previous: SparkPoint[];
  yLabel: string;
  valueFormatter?: (v: number) => string;
};

function KpiSparkline({ current, previous, yLabel, valueFormatter }: SparklineProps) {
  if (!current || current.length < 2) return <div style={{ height: 80 }} />;

  // Merge current + previous by index so both lines share the same x-axis points
  const merged = current.map((pt, i) => ({
    label: pt.label,
    current: pt.value,
    previous: previous[i]?.value ?? null,
  }));

  const fmt = valueFormatter ?? ((v: number) => String(v));

  return (
    <ResponsiveContainer width="100%" height={80}>
      <LineChart data={merged} margin={{ top: 4, right: 4, bottom: 16, left: 28 }}>
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: '#9ba0a5' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 9, fill: '#9ba0a5' }}
          tickLine={false}
          axisLine={false}
          width={26}
          label={{ value: yLabel, angle: -90, position: 'insideLeft', fontSize: 9, fill: '#9ba0a5', dx: -2 }}
          tickFormatter={(v) => fmt(v)}
        />
        <RechartsTooltip
          contentStyle={{ fontSize: 11, padding: '4px 8px' }}
          formatter={(value, name) => [
            fmt(Number(value)),
            name === 'current' ? 'This period' : 'Previous period',
          ]}
        />
        <Line type="monotone" dataKey="current" dot={false} stroke="#2c6ecb" strokeWidth={1.5} />
        <Line type="monotone" dataKey="previous" dot={false} stroke="#c4c4c4" strokeWidth={1} strokeDasharray="3 2" />
      </LineChart>
    </ResponsiveContainer>
  );
}

type KpiCardProps = {
  label: string;
  value: string;
  subLabel: string;
  delta: number;
  deltaType: 'pct' | 'pp' | 'dollar';
  deltaThreshold?: number;
  sparkline: SparkPoint[];
  prevSparkline: SparkPoint[];
  yLabel: string;
  valueFormatter?: (v: number) => string;
  loading: boolean;
};

function KpiCard({ label, value, subLabel, delta, deltaType, deltaThreshold = 0, sparkline, prevSparkline, yLabel, valueFormatter, loading }: KpiCardProps) {
  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
        {loading ? (
          <SkeletonDisplayText size="small" />
        ) : (
          <Text as="p" variant="headingLg" fontWeight="bold">{value}</Text>
        )}
        {loading ? (
          <div style={{ height: 80 }} />
        ) : (
          <KpiSparkline current={sparkline} previous={prevSparkline} yLabel={yLabel} valueFormatter={valueFormatter} />
        )}
        {loading ? (
          <SkeletonBodyText lines={1} />
        ) : (
          <BlockStack gap="100">
            <InlineStack gap="200" blockAlign="center">
              <span style={{ fontSize: 12, color: deltaColor(delta, deltaThreshold), fontWeight: 600 }}>
                {formatDelta(delta, deltaType)}
              </span>
              <Text as="p" variant="bodySm" tone="subdued">vs previous period</Text>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">{subLabel}</Text>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

const STEP_ORDER = [
  'checkout_started',
  'checkout_contact_info_submitted',
  'checkout_address_info_submitted',
  'checkout_shipping_info_submitted',
  'payment_info_submitted',
  'checkout_completed',
];

const STEP_LABELS: Record<string, string> = {
  checkout_started: 'Checkout',
  checkout_contact_info_submitted: 'Contact',
  checkout_address_info_submitted: 'Address',
  checkout_shipping_info_submitted: 'Shipping',
  payment_info_submitted: 'Payment',
  checkout_completed: 'Completed',
};

export default function OverviewPage() {
  const shop = useShop();
  const now = new Date();
  const [range, setRange] = useState<DateRange>({ start: subDays(now, 7), end: now });

  const rangeQuery = `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;
  const { data, error, isLoading } = useSWR(
    shop ? `/api/v2/overview?shop=${shop}&${rangeQuery}` : null,
    fetcher,
    { refreshInterval: 60000 }
  );

  const kpis = data?.kpis;
  const funnel = data?.funnel;
  const alerts = data?.recentAlerts ?? [];

  // Build funnel chart data
  const funnelChartData = funnel?.current?.map((step: { step: string; pct: number }) => {
    const prev = funnel?.previous?.find((p: { step: string; pct: number }) => p.step === step.step);
    return {
      name: STEP_LABELS[step.step] ?? step.step,
      current: step.pct,
      previous: prev?.pct ?? 0,
    };
  }) ?? [];

  return (
    <Page
      title="Overview"
      primaryAction={
        <DateRangeSelector value={range} onChange={setRange} />
      }
    >
      {error && (
        <Banner tone="critical" title="Failed to load overview data">
          <p>Could not fetch data. Please refresh the page.</p>
        </Banner>
      )}

      <Layout>
        {/* KPI Cards */}
        <Layout.Section>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
            <KpiCard
              label="Cart Sessions"
              value={kpis?.cartSessions?.value?.toLocaleString() ?? '—'}
              subLabel={`${kpis?.cartSessions?.value?.toLocaleString() ?? 0} sessions had products in cart`}
              delta={kpis?.cartSessions?.delta ?? 0}
              deltaType="pct"
              deltaThreshold={2}
              sparkline={kpis?.cartSessions?.sparkline ?? []}
              prevSparkline={kpis?.cartSessions?.prevSparkline ?? []}
              yLabel="sessions"
              loading={isLoading}
            />
            <KpiCard
              label="Checkout Rate"
              value={kpis?.checkoutRate?.value != null ? `${kpis.checkoutRate.value.toFixed(1)}%` : '—'}
              subLabel={
                kpis?.checkoutRate
                  ? `${kpis.checkoutRate.numerator} of ${kpis.checkoutRate.denominator} sessions reached checkout`
                  : '—'
              }
              delta={kpis?.checkoutRate?.delta ?? 0}
              deltaType="pp"
              deltaThreshold={1}
              sparkline={kpis?.checkoutRate?.sparkline ?? []}
              prevSparkline={kpis?.checkoutRate?.prevSparkline ?? []}
              yLabel="%"
              valueFormatter={(v) => `${v.toFixed(0)}%`}
              loading={isLoading}
            />
            <KpiCard
              label="CVR"
              value={kpis?.cvr?.value != null ? `${kpis.cvr.value.toFixed(1)}%` : '—'}
              subLabel={
                kpis?.cvr
                  ? `${kpis.cvr.numerator} orders from ${kpis.cvr.denominator} checkout starts`
                  : '—'
              }
              delta={kpis?.cvr?.delta ?? 0}
              deltaType="pp"
              deltaThreshold={1}
              sparkline={kpis?.cvr?.sparkline ?? []}
              prevSparkline={kpis?.cvr?.prevSparkline ?? []}
              yLabel="%"
              valueFormatter={(v) => `${v.toFixed(0)}%`}
              loading={isLoading}
            />
            <KpiCard
              label="Avg Order Value"
              value={kpis?.aov?.value != null ? `$${kpis.aov.value.toFixed(2)}` : '—'}
              subLabel={`across ${kpis?.aov?.orderCount ?? 0} completed orders`}
              delta={kpis?.aov?.delta ?? 0}
              deltaType="dollar"
              sparkline={kpis?.aov?.sparkline ?? []}
              prevSparkline={kpis?.aov?.prevSparkline ?? []}
              yLabel="$"
              valueFormatter={(v) => `$${v.toFixed(0)}`}
              loading={isLoading}
            />
          </div>
        </Layout.Section>

        {/* Checkout Funnel Chart */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Checkout Funnel</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Uptick at Completed = accelerated checkout (Shop Pay / Apple Pay)
                </Text>
              </InlineStack>

              {isLoading ? (
                <SkeletonBodyText lines={6} />
              ) : funnelChartData.length === 0 ? (
                <EmptyState
                  heading="No checkout data in this period"
                  image=""
                >
                  <p>Checkout events appear once customers reach the Shopify checkout.</p>
                </EmptyState>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={funnelChartData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
                    <RechartsTooltip
                      formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name === 'current' ? 'This period' : 'Previous period']}
                    />
                    <Line type="monotone" dataKey="current" stroke="#2c6ecb" strokeWidth={2} dot={{ r: 4 }} />
                    <Line type="monotone" dataKey="previous" stroke="#c4c4c4" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Funnel Tables */}
        <Layout.Section>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Steps table */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Steps</Text>
                {isLoading ? (
                  <SkeletonBodyText lines={6} />
                ) : !funnel?.current?.length ? (
                  <Text as="p" tone="subdued">No data</Text>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e1e3e5' }}>
                          {['Step', 'Sessions', '% of starts', 'Drop from prev'].map((h) => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: '#6d7175', fontWeight: 500 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {funnel.current.map((step: { step: string; sessions: number; pct: number; dropped: number; dropRate: number }, i: number) => {
                          const prev = i > 0 ? funnel.current[i - 1] : null;
                          const dropCount = prev ? Math.max(0, prev.sessions - step.sessions) : 0;
                          const dropPct = prev && prev.sessions > 0
                            ? ((dropCount / prev.sessions) * 100).toFixed(0)
                            : '0';
                          const dropColor = parseFloat(dropPct) > 30 ? '#d72c0d' : parseFloat(dropPct) > 15 ? '#b98900' : '#6d7175';
                          return (
                            <tr key={step.step} style={{ borderBottom: '1px solid #f4f6f8' }}>
                              <td style={{ padding: '8px 8px', fontWeight: 500 }}>{STEP_LABELS[step.step] ?? step.step}</td>
                              <td style={{ padding: '8px 8px' }}>{step.sessions.toLocaleString()}</td>
                              <td style={{ padding: '8px 8px' }}>{step.pct.toFixed(1)}%</td>
                              <td style={{ padding: '8px 8px', color: dropColor }}>
                                {i === 0 ? '—' : `-${dropCount} (-${dropPct}%)`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </BlockStack>
            </Card>

            {/* Drop analysis table */}
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">Where sessions are dropping</Text>
                {isLoading ? (
                  <SkeletonBodyText lines={6} />
                ) : !funnel?.current?.length ? (
                  <Text as="p" tone="subdued">No data</Text>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e1e3e5' }}>
                          {['Step', 'Dropped', 'Drop rate', 'vs last period'].map((h) => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', color: '#6d7175', fontWeight: 500 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {funnel.current.slice(1).map((step: { step: string; sessions: number; dropped: number; dropRate: number; dropRateDelta: number }, i: number) => {
                          const prevStep = funnel.current[i];
                          const dropped = prevStep ? Math.max(0, prevStep.sessions - step.sessions) : 0;
                          const deltaColor = step.dropRateDelta > 0 ? '#d72c0d' : step.dropRateDelta < 0 ? '#008060' : '#6d7175';
                          const deltaSign = step.dropRateDelta >= 0 ? '+' : '';
                          return (
                            <tr key={step.step} style={{ borderBottom: '1px solid #f4f6f8' }}>
                              <td style={{ padding: '8px 8px', fontWeight: 500 }}>{STEP_LABELS[step.step] ?? step.step}</td>
                              <td style={{ padding: '8px 8px' }}>{dropped.toLocaleString()}</td>
                              <td style={{ padding: '8px 8px' }}>{step.dropRate.toFixed(1)}%</td>
                              <td style={{ padding: '8px 8px', color: deltaColor }}>
                                {deltaSign}{step.dropRateDelta.toFixed(1)}pp
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </BlockStack>
            </Card>
          </div>
        </Layout.Section>

        {/* Recent Alerts Strip */}
        {!isLoading && alerts.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">Recent Alerts</Text>
                  <a href="/dashboard/v2/notifications" style={{ fontSize: 13, color: '#2c6ecb', textDecoration: 'none' }}>
                    View all alerts →
                  </a>
                </InlineStack>
                {alerts.map((alert: { id: string; severity: string; title: string; occurredAt: string }) => {
                  const dotColor = alert.severity === 'critical' ? '#d72c0d' : alert.severity === 'warning' ? '#b98900' : '#2c6ecb';
                  const when = new Date(alert.occurredAt);
                  const secondsAgo = Math.floor((Date.now() - when.getTime()) / 1000);
                  const timeLabel =
                    secondsAgo < 3600
                      ? `${Math.round(secondsAgo / 60)}m ago`
                      : secondsAgo < 86400
                      ? `${Math.round(secondsAgo / 3600)}h ago`
                      : when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

                  return (
                    <InlineStack key={alert.id} gap="300" blockAlign="center">
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
                      <Text as="p" variant="bodyMd">{alert.title}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{timeLabel}</Text>
                      <a href="/dashboard/v2/notifications" style={{ fontSize: 13, color: '#2c6ecb', textDecoration: 'none', marginLeft: 'auto' }}>→</a>
                    </InlineStack>
                  );
                })}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
