'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import {
  Page, Layout, Card, Text, InlineStack, BlockStack,
  Select, SkeletonBodyText, EmptyState,
} from '@shopify/polaris';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Cell,
} from 'recharts';
import { useShop } from '@/hooks/useShop';
import { DateRangeSelector, type DateRange } from '@/components/monitor/DateRangeSelector';

const fetcher = (url: string) => fetch(url).then((r) => r.json());
function subDays(d: Date, n: number): Date { return new Date(d.getTime() - n * 86400000); }

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

type ConvBand = { label: string; sessions: number; convRate: number; lowData: boolean };
type RevCoupon = { code: string; sessions: number; convRate: number; avgCart: number; avgDiscount: number; revPerSession: number; vsBaseline: number; lowData: boolean; isBaseline: boolean };

export default function PerformancePage() {
  const shop = useShop();
  const now = new Date();
  const [range, setRange] = useState<DateRange>({ start: subDays(now, 30), end: now });
  const [device, setDevice] = useState('');
  const [source, setSource] = useState('');

  const rangeQuery = `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;
  const filterQuery = [device ? `device=${device}` : '', source ? `source=${encodeURIComponent(source)}` : ''].filter(Boolean).join('&');

  const { data, isLoading } = useSWR(
    shop ? `/api/v3/performance?shop=${shop}&${rangeQuery}${filterQuery ? '&' + filterQuery : ''}` : null,
    fetcher, { revalidateOnFocus: false },
  );

  const handleRangeChange = useCallback((r: DateRange) => setRange(r), []);

  const convBands: ConvBand[] = data?.conversionBands ?? [];
  const revCoupons: RevCoupon[] = data?.revenuePerCoupon ?? [];
  const overallConvRate: number = data?.overallConvRate ?? 0;
  const aov: number = data?.aov ?? 0;
  const completedOrders: number = data?.completedOrders ?? 0;
  const timeIntel = data?.timeIntelligence;
  const cartComp = data?.cartComposition;

  const MIN_ORDERS = 20;
  const hasEnoughData = completedOrders >= MIN_ORDERS;

  // Colour logic for conversion bands
  function bandColor(band: ConvBand): string {
    if (band.lowData) return '#D3D1C7';
    if (band.convRate < overallConvRate) return '#888780';
    if (band.convRate >= overallConvRate + 30) return '#0C447C';
    if (band.convRate >= overallConvRate + 15) return '#185FA5';
    return '#378ADD';
  }

  // Find AOV band for reference line
  const aovBandLabel = convBands.find((b) => {
    const max = b.label.includes('+') ? Infinity : parseInt(b.label.split('–')[1]?.replace('$', '') ?? '99999');
    const min = parseInt(b.label.replace('$', '').split('–')[0].split('+')[0]);
    return aov >= min && aov < max;
  })?.label;

  const loadTimeMs = timeIntel?.loadTimeMedianMs ?? null;
  const loadTimeColor = loadTimeMs == null ? undefined : loadTimeMs > 5000 ? '#d72c0d' : loadTimeMs > 3000 ? '#916a00' : undefined;

  return (
    <Page
      title="Cart Performance"
      subtitle="Strategic view — best for weekly review"
      primaryAction={<DateRangeSelector value={range} onChange={handleRangeChange} />}
    >
      <Layout>

        {/* Filters */}
        <Layout.Section>
          <Card>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 120 }}>
                <Select label="Device"
                  options={[{ label: 'All', value: '' }, { label: 'Desktop', value: 'desktop' }, { label: 'Mobile', value: 'mobile' }]}
                  value={device} onChange={setDevice}
                />
              </div>
              <div style={{ minWidth: 140 }}>
                <Select label="Source"
                  options={[{ label: 'All sources', value: '' }, { label: 'Direct', value: 'Direct' }, { label: 'Paid search', value: 'Paid search' }, { label: 'Social', value: 'Social' }, { label: 'Email', value: 'Email' }]}
                  value={source} onChange={setSource}
                />
              </div>
            </div>
          </Card>
        </Layout.Section>

        {!hasEnoughData && !isLoading && (
          <Layout.Section>
            <Card>
              <Text as="p" tone="subdued">
                {completedOrders}/20 orders needed for reliable insights. Select a wider date range or check back later.
              </Text>
            </Card>
          </Layout.Section>
        )}

        {/* Charts row */}
        <Layout.Section>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>

            {/* Left: Conversion by cart value bands */}
            <div style={{ flex: 1, minWidth: 300 }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Conversion rate by cart value</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Based on {data?.conversionBands?.reduce((s: number, b: ConvBand) => s + b.sessions, 0) ?? 0} sessions
                  </Text>
                  {isLoading ? <SkeletonBodyText lines={6} /> : convBands.length === 0 ? (
                    <EmptyState heading="No data yet" image=""><Text as="p">Sessions will appear once customers visit.</Text></EmptyState>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={convBands} margin={{ top: 10, right: 16, left: 0, bottom: 40 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" />
                          <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                          <Tooltip formatter={(v) => [`${Number(v)}%`, 'Conv rate']} />
                          <ReferenceLine y={overallConvRate} stroke="#378ADD" strokeDasharray="4 4" label={{ value: `Avg ${overallConvRate}%`, fontSize: 11, fill: '#378ADD' }} />
                          <Bar dataKey="convRate" radius={[3, 3, 0, 0]}>
                            {convBands.map((band, i) => (
                              <Cell key={i} fill={bandColor(band)} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      {hasEnoughData && (() => {
                        const highBands = convBands.filter((b) => !b.lowData).sort((a, b) => b.convRate - a.convRate);
                        const highest = highBands[0];
                        const aovBand = convBands.find((b) => b.label === aovBandLabel);
                        if (!highest) return null;
                        return (
                          <Text as="p" variant="bodySm" tone="subdued">
                            {highest.label !== aovBandLabel
                              ? `Sessions over ${highest.label.split('–')[0]} convert at ${highest.convRate}% vs ${overallConvRate}% average.`
                              : `Your avg cart of $${aov.toFixed(2)} is already in your best-converting range (${highest.convRate}%).`
                            }
                          </Text>
                        );
                      })()}
                    </>
                  )}
                </BlockStack>
              </Card>
            </div>

            {/* Right: Revenue per session by code */}
            <div style={{ flex: 1, minWidth: 300 }}>
              <Card>
                <BlockStack gap="200">
                  <Text variant="headingMd" as="h2">Revenue per session by discount code</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Net revenue per session — vs no-discount baseline</Text>
                  {isLoading ? <SkeletonBodyText lines={6} /> : revCoupons.length <= 1 ? (
                    <EmptyState heading="No coupon data yet" image=""><Text as="p">Coupon activity will appear here.</Text></EmptyState>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={Math.max(200, revCoupons.length * 40)}>
                        <BarChart data={revCoupons} layout="vertical" margin={{ top: 5, right: 60, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} />
                          <YAxis type="category" dataKey="code" tick={{ fontSize: 11 }} width={100} />
                          <Tooltip formatter={(v) => [`$${Number(v).toFixed(2)}`, 'Rev/session']} />
                          <Bar dataKey="revPerSession" radius={[0, 3, 3, 0]}>
                            {revCoupons.map((c, i) => {
                              const fill = c.isBaseline ? '#888780'
                                : c.lowData ? '#D3D1C7'
                                : c.vsBaseline > 5 ? '#639922'
                                : c.vsBaseline < -5 ? '#A32D2D'
                                : '#888780';
                              return <Cell key={i} fill={fill} />;
                            })}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Rev/session = (avg cart − avg discount) × conversion rate. A code above baseline earns more net revenue per visitor than no discount.
                      </Text>
                    </>
                  )}
                </BlockStack>
              </Card>
            </div>
          </div>
        </Layout.Section>

        {/* Time Intelligence */}
        <Layout.Section>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <Card>
                <BlockStack gap="100">
                  <Text variant="bodySm" as="p" tone="subdued">Consideration window</Text>
                  <Text variant="headingLg" as="p">{isLoading ? '—' : formatMs(timeIntel?.considerationMedianMs ?? null)}</Text>
                  <Text variant="bodySm" as="p" tone="subdued">Median time from first item → checkout</Text>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <Card>
                <BlockStack gap="100">
                  <Text variant="bodySm" as="p" tone="subdued">Checkout load time</Text>
                  <Text variant="headingLg" as="p">
                    <span style={loadTimeColor ? { color: loadTimeColor } : undefined}>
                      {isLoading ? '—' : formatMs(loadTimeMs)}
                    </span>
                  </Text>
                  <Text variant="bodySm" as="p" tone="subdued">
                    Median time from checkout click to Shopify loading
                    {loadTimeMs != null && loadTimeMs > 3000 ? ' — high, worth investigating' : ''}
                  </Text>
                </BlockStack>
              </Card>
            </div>
            <div style={{ flex: 1, minWidth: 160 }}>
              <Card>
                <BlockStack gap="100">
                  <Text variant="bodySm" as="p" tone="subdued">Return buyer rate</Text>
                  <Text variant="headingLg" as="p">{isLoading ? '—' : `${timeIntel?.returnBuyerRate ?? 0}%`}</Text>
                  <Text variant="bodySm" as="p" tone="subdued">Orders where customer visited more than once before buying</Text>
                </BlockStack>
              </Card>
            </div>
          </div>
        </Layout.Section>

        {/* Cart Composition */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text variant="headingMd" as="h2">Cart composition</Text>
              {isLoading ? <SkeletonBodyText lines={4} /> : !cartComp || cartComp.totalCompleted < MIN_ORDERS ? (
                <Text as="p" tone="subdued">Not enough orders yet to show composition patterns.</Text>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
                    <div>
                      <Text variant="heading2xl" as="p">{cartComp.multiProductPct}%</Text>
                      <Text as="p" variant="bodySm" tone="subdued">of orders came from multi-product carts</Text>
                    </div>
                    <div>
                      <Text variant="heading2xl" as="p">{cartComp.singleProductPct}%</Text>
                      <Text as="p" variant="bodySm" tone="subdued">came from single-product carts</Text>
                    </div>
                  </div>

                  {cartComp.topCombinations.length > 0 && (
                    <BlockStack gap="200">
                      <Text variant="headingSm" as="h3">Most common combinations in completed orders</Text>
                      {cartComp.topCombinations.map((combo: { label: string; count: number; avgCart: number }, i: number) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #f4f6f8', fontSize: 13 }}>
                          <span><strong>{i + 1}.</strong> {combo.label}</span>
                          <span style={{ color: '#6d7175', whiteSpace: 'nowrap', marginLeft: 16 }}>
                            {combo.count} orders · avg ${combo.avgCart.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </BlockStack>
                  )}
                </>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

      </Layout>
    </Page>
  );
}
