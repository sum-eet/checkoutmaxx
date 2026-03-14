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
  Badge,
  EmptyState,
  Banner,
  SkeletonBodyText,
  Button,
  Modal,
  Spinner,
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
  Legend,
} from 'recharts';

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86400000);
}
const fetcher = (url: string) => fetch(url).then((r) => r.json());

type DiscountCode = {
  code: string;
  status: 'healthy' | 'degraded' | 'broken';
  attempts: number;
  successRate: number;
  avgCartDollars: number | null;
  recoveries: number;
  revPerSession: number | null;
  lastSeen: string;
  isLowData: boolean;
};

function StatusDot({ status }: { status: string }) {
  const color = status === 'healthy' ? '#108043' : status === 'degraded' ? '#b98900' : '#d82c0d';
  return <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />;
}

function formatLastSeen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CodeDetailPanel({ code, shop, start, end, onClose }: {
  code: string;
  shop: string;
  start: string;
  end: string;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useSWR(
    `/api/v2/discounts/${encodeURIComponent(code)}?shop=${shop}&start=${start}&end=${end}`,
    fetcher
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={code}
      size="large"
    >
      <Modal.Section>
        {isLoading && <Spinner size="small" />}
        {error && <Banner tone="critical" title="Failed to load code details" />}
        {data && (
          <BlockStack gap="500">
            {/* Status + header */}
            <InlineStack gap="200" blockAlign="center">
              <StatusDot status={data.status} />
              <Text as="p" variant="bodyMd">{data.status}</Text>
              <Text as="p" tone="subdued">·  {data.attempts} attempts</Text>
            </InlineStack>

            {/* Trend chart */}
            {data.trend?.length > 0 && (
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Attempt trend</Text>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={data.trend} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <RechartsTooltip />
                    <Legend />
                    <Line type="monotone" dataKey="attempts" stroke="#c4c4c4" strokeWidth={2} dot={false} name="Attempts" />
                    <Line type="monotone" dataKey="successes" stroke="#108043" strokeWidth={2} dot={false} name="Successes" />
                  </LineChart>
                </ResponsiveContainer>
              </BlockStack>
            )}

            {/* Summary stats */}
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm">Summary</Text>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { label: 'Success rate', value: `${data.summary?.successRate?.toFixed(1) ?? 0}%`, sub: `was ${data.summary?.successRatePrev?.toFixed(1) ?? 0}% last period` },
                  { label: 'Avg cart with this code', value: `$${data.summary?.avgCartDollars?.toFixed(2) ?? '—'}`, sub: `store avg $${data.summary?.storeAvgCartDollars?.toFixed(2) ?? '—'}` },
                  { label: 'Rev/session', value: `$${data.summary?.revPerSession?.toFixed(2) ?? '—'}`, sub: `baseline $${data.summary?.baselineRevPerSession?.toFixed(2) ?? '—'}` },
                  { label: 'Total discount given', value: `$${data.summary?.totalDiscountGiven?.toFixed(2) ?? '—'}`, sub: `across ${data.summary?.totalDiscountOrders ?? 0} orders` },
                ].map(({ label, value, sub }) => (
                  <div key={label} style={{ background: '#f6f6f7', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 12, color: '#6d7175' }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0' }}>{value}</div>
                    <div style={{ fontSize: 11, color: '#6d7175' }}>{sub}</div>
                  </div>
                ))}
              </div>
            </BlockStack>

            {/* Recovery detail */}
            {data.recovery && (
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">{data.recovery.count} customers unlocked this code by adding items</Text>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, fontSize: 13 }}>
                  <div>
                    <div style={{ color: '#6d7175', fontSize: 12 }}>Avg cart before</div>
                    <div style={{ fontWeight: 600 }}>${data.recovery.avgCartBeforeDollars?.toFixed(2) ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ color: '#6d7175', fontSize: 12 }}>Avg cart after</div>
                    <div style={{ fontWeight: 600 }}>${data.recovery.avgCartAfterDollars?.toFixed(2) ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ color: '#6d7175', fontSize: 12 }}>Avg increase</div>
                    <div style={{ fontWeight: 600, color: '#008060' }}>+${data.recovery.avgCartIncreaseDollars?.toFixed(2) ?? '—'}</div>
                  </div>
                  <div>
                    <div style={{ color: '#6d7175', fontSize: 12 }}>Avg items added</div>
                    <div style={{ fontWeight: 600 }}>{data.recovery.avgItemsAdded?.toFixed(1) ?? '—'}</div>
                  </div>
                </div>
              </BlockStack>
            )}

            {/* Recent sessions */}
            {data.recentSessions?.length > 0 && (
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Recent sessions</Text>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #e1e3e5' }}>
                        {['Time', 'Cart value', 'Outcome', 'Coupon result'].map((h) => (
                          <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: '#6d7175', fontWeight: 500 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentSessions.map((s: { sessionId: string; occurredAt: string; cartValueDollars: number | null; outcome: string; couponStatus: string }) => (
                        <tr key={s.sessionId} style={{ borderBottom: '1px solid #f4f6f8' }}>
                          <td style={{ padding: '6px 10px' }}>{new Date(s.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</td>
                          <td style={{ padding: '6px 10px' }}>{s.cartValueDollars != null ? `$${s.cartValueDollars.toFixed(2)}` : '—'}</td>
                          <td style={{ padding: '6px 10px' }}>
                            {s.outcome === 'ordered' ? <Badge tone="success">Ordered</Badge> : s.outcome === 'checkout' ? <Badge tone="warning">Checkout</Badge> : <Badge>Abandoned</Badge>}
                          </td>
                          <td style={{ padding: '6px 10px' }}>
                            {s.couponStatus === 'applied' ? <Badge tone="success">Applied</Badge> : s.couponStatus === 'recovered' ? <Badge tone="warning">Recovered</Badge> : <Badge tone="critical">Failed</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </BlockStack>
            )}
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}

export default function DiscountsPage() {
  const shop = useShop();
  const now = new Date();
  const [range, setRange] = useState<DateRange>({ start: subDays(now, 30), end: now });
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const rangeQuery = `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;
  const { data, error, isLoading } = useSWR(
    shop ? `/api/v2/discounts?shop=${shop}&${rangeQuery}` : null,
    fetcher,
    { refreshInterval: 120000 }
  );

  const summary = data?.summary;
  const codes: DiscountCode[] = data?.codes ?? [];

  return (
    <Page
      title="Discounts"
      primaryAction={<DateRangeSelector value={range} onChange={setRange} />}
    >
      {error && (
        <Banner tone="critical" title="Failed to load discount data">
          <p>Please refresh the page.</p>
        </Banner>
      )}

      <Layout>
        {/* Summary strip */}
        {!isLoading && summary && (
          <Layout.Section>
            <Text as="p" tone="subdued" variant="bodySm">
              {summary.active} codes active  ·  {summary.healthy} healthy  ·  {summary.needsAttention} need attention
            </Text>
          </Layout.Section>
        )}

        {/* Codes Table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">Discount Codes</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  <span style={{ marginRight: 12 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#108043', display: 'inline-block', marginRight: 4 }} />Healthy</span>
                  <span style={{ marginRight: 12 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#b98900', display: 'inline-block', marginRight: 4 }} />Degraded</span>
                  <span><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#d82c0d', display: 'inline-block', marginRight: 4 }} />Broken</span>
                </Text>
              </InlineStack>

              {isLoading ? (
                <SkeletonBodyText lines={6} />
              ) : codes.length === 0 ? (
                <EmptyState heading="No discount codes used in this period" image="">
                  <p>Coupon attempts will appear here once customers try discount codes.</p>
                </EmptyState>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e1e3e5' }}>
                        {['', 'Code', 'Attempts', 'Success rate', 'Avg cart', 'Recoveries', 'Rev/session', 'Last seen'].map((h) => (
                          <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#6d7175', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {codes.map((code) => {
                        const statusColor = code.status === 'healthy' ? '#108043' : code.status === 'degraded' ? '#b98900' : '#d82c0d';
                        return (
                          <tr
                            key={code.code}
                            style={{ borderBottom: '1px solid #f4f6f8', cursor: 'pointer' }}
                            onClick={() => setSelectedCode(code.code)}
                          >
                            <td style={{ padding: '10px 12px' }}>
                              <StatusDot status={code.status} />
                            </td>
                            <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 600 }}>{code.code}</td>
                            <td style={{ padding: '10px 12px' }}>{code.attempts}</td>
                            <td style={{ padding: '10px 12px', color: statusColor, fontWeight: 500 }}>
                              {code.successRate.toFixed(1)}%
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {code.avgCartDollars != null ? `$${code.avgCartDollars.toFixed(2)}` : '—'}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {code.recoveries > 0 ? `${code.recoveries} unlocked` : '—'}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {code.isLowData ? <span style={{ color: '#6d7175', fontSize: 12 }}>Low data</span> : code.revPerSession != null ? `$${code.revPerSession.toFixed(2)}` : '—'}
                            </td>
                            <td style={{ padding: '10px 12px', color: '#6d7175' }}>{formatLastSeen(code.lastSeen)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {selectedCode && shop && (
        <CodeDetailPanel
          code={selectedCode}
          shop={shop}
          start={range.start.toISOString()}
          end={range.end.toISOString()}
          onClose={() => setSelectedCode(null)}
        />
      )}
    </Page>
  );
}
