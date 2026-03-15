'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack,
  Select, SkeletonBodyText, EmptyState, Spinner,
} from '@shopify/polaris';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line, Legend,
} from 'recharts';
import { useShop } from '@/hooks/useShop';
import { DateRangeSelector, type DateRange } from '@/components/monitor/DateRangeSelector';

const fetcher = (url: string) => fetch(url).then((r) => r.json());
function subDays(d: Date, n: number): Date { return new Date(d.getTime() - n * 86400000); }

type CodeRow = {
  code: string; status: 'healthy' | 'degraded' | 'broken';
  attempts: number; successRate: number; avgCart: number;
  recoveries: number; revPerSession: number; vsBaseline: number;
  lowData: boolean; lastSeen: string;
};

type CodeDetail = {
  code: string; status: string; attempts: number; successRate: number;
  prevSuccessRate: number | null; avgCart: number; totalDiscount: number; convRate: number;
  revPerSession?: number;
  trend: Array<{ date: string; attempts: number; successes: number }>;
  productBreakdown: Array<{ products: string; attempts: number; successRate: number }>;
  hasProductRestriction: boolean;
  recoveryDetail: { count: number; avgCartBefore: number; avgCartAfter: number; avgIncrease: number; convRateAfterRecovery: number } | null;
  recentSessions: Array<{ sessionId: string; startTime: string; cartValue: number | null; outcome: string; couponStatus: string }>;
};

function StatusDot({ status }: { status: string }) {
  const color = status === 'healthy' ? '#008060' : status === 'degraded' ? '#916a00' : '#d72c0d';
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color }} />;
}

function formatLastSeen(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return 'Today';
  if (d === 1) return 'Yesterday';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CodeDetailSheet({ code, shop, range, onClose }: {
  code: string; shop: string; range: DateRange; onClose: () => void;
}) {
  const rangeQuery = `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;
  const { data, isLoading } = useSWR<CodeDetail>(
    `/api/v3/discounts/${encodeURIComponent(code)}?shop=${shop}&${rangeQuery}`,
    fetcher,
  );

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
      background: '#fff', borderLeft: '1px solid #e1e3e5',
      zIndex: 1000, display: 'flex', flexDirection: 'column',
      boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e1e3e5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Text variant="headingMd" as="h2" fontWeight="bold">{code}</Text>
          {data && <StatusDot status={data.status} />}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6d7175' }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {isLoading ? <Spinner size="small" /> : !data ? (
          <Text as="p" tone="subdued">No data found.</Text>
        ) : (
          <BlockStack gap="400">

            {/* Trend chart */}
            <div>
              <Text variant="headingSm" as="h3">Attempt trend</Text>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={data.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="attempts" stroke="#888780" dot={false} name="Attempts" />
                  <Line type="monotone" dataKey="successes" stroke="#008060" dot={false} name="Successes" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Summary stats 2x2 */}
            <div>
              <Text variant="headingSm" as="h3">Summary</Text>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                {[
                  ['Success rate', `${data.successRate}%${data.prevSuccessRate != null ? ` (was ${data.prevSuccessRate}%)` : ''}`],
                  ['Avg cart', `$${data.avgCart.toFixed(2)}`],
                  ['Rev/session', `$${(data.revPerSession ?? 0).toFixed(2)}`],
                  ['Total discount given', `$${data.totalDiscount.toFixed(2)}`],
                ].map(([label, value]) => (
                  <div key={label} style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: '#6d7175' }}>{label}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Product restriction warning */}
            {data.hasProductRestriction && (
              <div style={{ background: '#fff3cd', border: '1px solid #ffc107', borderRadius: 8, padding: '10px 14px' }}>
                <Text as="p" variant="bodySm" fontWeight="semibold">Product restriction likely</Text>
                <Text as="p" variant="bodySm">Success rate differs significantly between product groups.</Text>
              </div>
            )}

            {/* Product breakdown */}
            {data.productBreakdown.length > 0 && (
              <div>
                <Text variant="headingSm" as="h3">Success rate by product context</Text>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #e1e3e5' }}>
                      <th style={{ textAlign: 'left', padding: '4px 0', color: '#6d7175', fontWeight: 500 }}>Products</th>
                      <th style={{ textAlign: 'right', padding: '4px 0', color: '#6d7175', fontWeight: 500 }}>Attempts</th>
                      <th style={{ textAlign: 'right', padding: '4px 0', color: '#6d7175', fontWeight: 500 }}>Success</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.productBreakdown.map((pb, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f4f6f8' }}>
                        <td style={{ padding: '6px 0' }}>{pb.products.slice(0, 40)}{pb.products.length > 40 ? '…' : ''}</td>
                        <td style={{ textAlign: 'right', padding: '6px 0' }}>{pb.attempts}</td>
                        <td style={{ textAlign: 'right', padding: '6px 0', color: pb.successRate >= 50 ? '#008060' : '#d72c0d' }}>{pb.successRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Recovery detail */}
            {data.recoveryDetail && (
              <div>
                <Text variant="headingSm" as="h3">{data.recoveryDetail.count} customers unlocked this code by adding items</Text>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                  {[
                    ['Avg cart before', `$${data.recoveryDetail.avgCartBefore.toFixed(2)}`],
                    ['Avg cart after', `$${data.recoveryDetail.avgCartAfter.toFixed(2)}`],
                    ['Avg increase', <span style={{ color: '#008060' }}>+${data.recoveryDetail.avgIncrease.toFixed(2)}</span>],
                    ['Conv rate after', `${data.recoveryDetail.convRateAfterRecovery}%`],
                  ].map(([label, value]) => (
                    <div key={String(label)} style={{ background: '#f9fafb', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, color: '#6d7175' }}>{label}</div>
                      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent sessions */}
            <div>
              <Text variant="headingSm" as="h3">Recent sessions</Text>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e1e3e5' }}>
                    {['Time', 'Cart', 'Outcome', 'Coupon'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '4px 6px', color: '#6d7175', fontWeight: 500 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.recentSessions.map((s) => (
                    <tr key={s.sessionId} style={{ borderBottom: '1px solid #f4f6f8' }}>
                      <td style={{ padding: '6px 6px' }}>{new Date(s.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                      <td style={{ padding: '6px 6px' }}>{s.cartValue != null ? `$${s.cartValue.toFixed(2)}` : '—'}</td>
                      <td style={{ padding: '6px 6px' }}>
                        {s.outcome === 'ordered' ? <Badge tone="success">Ordered</Badge>
                          : s.outcome === 'checkout' ? <Badge tone="attention">Checkout</Badge>
                          : <Badge tone="info">Abandoned</Badge>}
                      </td>
                      <td style={{ padding: '6px 6px', color: s.couponStatus === 'applied' ? '#008060' : s.couponStatus === 'recovered' ? '#916a00' : '#d72c0d', fontWeight: 500 }}>
                        {s.couponStatus === 'applied' ? '✓' : s.couponStatus === 'recovered' ? '↑' : '✗'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

          </BlockStack>
        )}
      </div>
    </div>
  );
}

export default function DiscountsPage() {
  const shop = useShop();
  const now = new Date();
  const [range, setRange] = useState<DateRange>({ start: subDays(now, 30), end: now });
  const [source, setSource] = useState('');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'attempts' | 'successRate' | 'revPerSession' | 'lastSeen'>('attempts');

  const rangeQuery = `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;
  const filterQuery = source ? `source=${encodeURIComponent(source)}` : '';

  const { data, isLoading } = useSWR(
    shop ? `/api/v3/discounts?shop=${shop}&${rangeQuery}${filterQuery ? '&' + filterQuery : ''}` : null,
    fetcher, { revalidateOnFocus: false },
  );

  const kpis = data?.kpis;
  const codes: CodeRow[] = (data?.codes ?? []).sort((a: CodeRow, b: CodeRow) => {
    if (sortBy === 'successRate') return b.successRate - a.successRate;
    if (sortBy === 'revPerSession') return b.revPerSession - a.revPerSession;
    if (sortBy === 'lastSeen') return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
    return b.attempts - a.attempts;
  });
  const chartData: Array<{ code: string; avgCart: number; convRate: number }> = data?.chartData ?? [];
  const attentionColor = kpis?.attentionCount > 0
    ? (kpis?.brokenCodes?.length > 0 ? '#d72c0d' : '#916a00')
    : '#008060';

  return (
    <Page
      title="Discounts"
      subtitle="Code health and coupon intelligence"
      primaryAction={<DateRangeSelector value={range} onChange={useCallback((r: DateRange) => setRange(r), [])} />}
    >
      <Layout>

        {/* KPI Cards */}
        <Layout.Section>
          {isLoading ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[1,2,3,4].map((i) => <div key={i} style={{ flex: 1, minWidth: 140 }}><Card><SkeletonBodyText lines={2} /></Card></div>)}
            </div>
          ) : kpis ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 140 }}><Card>
                <BlockStack gap="100">
                  <Text variant="bodySm" as="p" tone="subdued">Active codes</Text>
                  <Text variant="headingLg" as="p">{kpis.activeCodes}</Text>
                </BlockStack>
              </Card></div>
              <div style={{ flex: 1, minWidth: 180 }}><Card>
                <BlockStack gap="100">
                  <Text variant="bodySm" as="p" tone="subdued">Avg cart with / without coupon</Text>
                  <Text variant="headingLg" as="p">${kpis.avgCartWithCoupon.toFixed(2)} · ${kpis.avgCartWithoutCoupon.toFixed(2)}</Text>
                  <Text variant="bodySm" as="p" tone={kpis.cartLift >= 0 ? 'success' : 'critical'}>
                    {kpis.cartLift >= 0 ? '+' : ''}${kpis.cartLift.toFixed(2)} lift
                  </Text>
                </BlockStack>
              </Card></div>
              <div style={{ flex: 1, minWidth: 140 }}><Card>
                <BlockStack gap="100">
                  <Text variant="bodySm" as="p" tone="subdued">Carts recovered</Text>
                  <Text variant="headingLg" as="p">{kpis.recoveredCarts}</Text>
                  <Text variant="bodySm" as="p" tone="subdued">added items to unlock a code</Text>
                </BlockStack>
              </Card></div>
              <div style={{ flex: 1, minWidth: 160 }}><Card>
                <BlockStack gap="100">
                  <Text variant="bodySm" as="p" tone="subdued">Codes needing attention</Text>
                  <Text variant="headingLg" as="p"><span style={{ color: attentionColor }}>{kpis.attentionCount}</span></Text>
                  {kpis.brokenCodes?.length > 0 && (
                    <Text variant="bodySm" as="p" tone="critical">{kpis.brokenCodes.join(', ')}</Text>
                  )}
                </BlockStack>
              </Card></div>
            </div>
          ) : null}
        </Layout.Section>

        {/* Filter row */}
        <Layout.Section>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ minWidth: 140 }}>
              <Select label="Source"
                options={[{ label: 'All sources', value: '' }, { label: 'Direct', value: 'Direct' }, { label: 'Paid search', value: 'Paid search' }, { label: 'Social', value: 'Social' }, { label: 'Email', value: 'Email' }]}
                value={source} onChange={setSource}
              />
            </div>
            <div style={{ minWidth: 160 }}>
              <Select label="Sort by"
                options={[
                  { label: 'Most attempts', value: 'attempts' },
                  { label: 'Success rate', value: 'successRate' },
                  { label: 'Rev/session', value: 'revPerSession' },
                  { label: 'Last seen', value: 'lastSeen' },
                ]}
                value={sortBy}
                onChange={(v) => setSortBy(v as typeof sortBy)}
              />
            </div>
          </div>
        </Layout.Section>

        {/* Code Health Table */}
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text variant="headingMd" as="h2">All codes</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  <span style={{ marginRight: 10 }}><span style={{ color: '#008060' }}>●</span> Healthy</span>
                  <span style={{ marginRight: 10 }}><span style={{ color: '#916a00' }}>●</span> Degraded</span>
                  <span><span style={{ color: '#d72c0d' }}>●</span> Broken</span>
                </Text>
              </InlineStack>

              {isLoading ? <SkeletonBodyText lines={6} /> : codes.length === 0 ? (
                <EmptyState heading="No discount codes used in this period" image=""><Text as="p">Coupon activity will appear here.</Text></EmptyState>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e1e3e5' }}>
                      <th style={{ width: 24, padding: '8px 4px' }} />
                      {['Code', 'Attempts', 'Success rate', 'Avg cart', 'Recoveries', 'Rev/session', 'Last seen'].map((h) => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 10px', color: '#6d7175', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {codes.map((c) => {
                      const rowBg = c.status === 'broken' ? 'rgba(215,44,13,0.04)'
                        : c.status === 'degraded' ? 'rgba(145,106,0,0.04)' : undefined;
                      const rateColor = c.successRate >= 50 ? '#008060' : c.successRate >= 20 ? '#916a00' : '#d72c0d';
                      return (
                        <tr
                          key={c.code}
                          style={{ borderBottom: '1px solid #f4f6f8', background: rowBg, cursor: 'pointer' }}
                          onClick={() => setSelectedCode(c.code)}
                        >
                          <td style={{ padding: '10px 4px', textAlign: 'center' }}><StatusDot status={c.status} /></td>
                          <td style={{ padding: '10px 10px', fontFamily: 'monospace', fontWeight: 500 }}>{c.code}</td>
                          <td style={{ padding: '10px 10px' }}>{c.attempts}</td>
                          <td style={{ padding: '10px 10px', color: rateColor, fontWeight: 500 }}>{c.successRate}%</td>
                          <td style={{ padding: '10px 10px' }}>${c.avgCart.toFixed(2)}</td>
                          <td style={{ padding: '10px 10px' }}>{c.recoveries > 0 ? `${c.recoveries} unlocked` : '—'}</td>
                          <td style={{ padding: '10px 10px', color: c.lowData ? '#6d7175' : undefined }}>
                            {c.lowData ? <span style={{ color: '#6d7175', fontSize: 11 }}>Low data</span> : `$${c.revPerSession.toFixed(2)}`}
                          </td>
                          <td style={{ padding: '10px 10px', color: '#6d7175' }}>{formatLastSeen(c.lastSeen)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Grouped bar chart */}
        {!isLoading && chartData.length > 1 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <Text variant="headingMd" as="h2">Avg cart value + conversion rate by code</Text>
                <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 50)}>
                  <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="code" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" />
                    <YAxis yAxisId="left" tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="left" dataKey="avgCart" name="Avg cart ($)" fill="#378ADD" />
                    <Bar yAxisId="right" dataKey="convRate" name="Conv rate (%)" fill="#639922" />
                  </BarChart>
                </ResponsiveContainer>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

      </Layout>

      {/* Code detail panel */}
      {selectedCode && shop && (
        <CodeDetailSheet code={selectedCode} shop={shop} range={range} onClose={() => setSelectedCode(null)} />
      )}
    </Page>
  );
}
