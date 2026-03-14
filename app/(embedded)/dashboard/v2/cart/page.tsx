'use client';

import { useState, useCallback } from 'react';
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
  Modal,
  EmptyState,
  Button,
  Select,
  TextField,
  SkeletonBodyText,
  Banner,
  Spinner,
} from '@shopify/polaris';
import { useShop } from '@/hooks/useShop';
import { DateRangeSelector, type DateRange } from '@/components/monitor/DateRangeSelector';
import { formatDuration } from '@/lib/v2/session-summary';
import type { CartSessionV2, CouponSummary } from '@/lib/v2/session-summary';

function subDays(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86400000);
}
const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function formatElapsed(prev: string, curr: string): string {
  const diff = new Date(curr).getTime() - new Date(prev).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `+${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `+${m}m ${rem}s`;
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === 'ordered') return <Badge tone="success">Ordered</Badge>;
  if (outcome === 'checkout') return <Badge tone="warning">Checkout</Badge>;
  return <Badge tone="info">Abandoned</Badge>;
}

function CouponPill({ coupon }: { coupon: CouponSummary }) {
  const bg = coupon.status === 'applied' ? '#d4edda' : coupon.status === 'recovered' ? '#fff3cd' : '#f8d7da';
  const color = coupon.status === 'applied' ? '#155724' : coupon.status === 'recovered' ? '#856404' : '#721c24';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 7px',
      borderRadius: 12,
      fontSize: 11,
      fontWeight: 500,
      background: bg,
      color,
      marginRight: 4,
    }}>
      {coupon.code}
    </span>
  );
}

type TimelineEvent = {
  source: 'cart' | 'checkout';
  eventType: string;
  occurredAt: string;
  label: string;
  detail: string | null;
  sentiment: 'positive' | 'negative' | 'neutral';
};

function TimelineModal({ sessionId, shop, open, onClose }: {
  sessionId: string;
  shop: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data, isLoading, error } = useSWR(
    open && sessionId && shop ? `/api/v2/cart/session?shop=${shop}&sessionId=${sessionId}` : null,
    fetcher
  );

  const session: CartSessionV2 | undefined = data?.session;
  const timeline: TimelineEvent[] = data?.timeline ?? [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={sessionId ? `Session ${sessionId.slice(0, 20)}…` : 'Session'}
      size="large"
    >
      <Modal.Section>
        {isLoading && <Spinner size="small" />}
        {error && <Banner tone="critical" title="Failed to load session" />}
        {session && (
          <BlockStack gap="400">
            {/* Header */}
            <BlockStack gap="100">
              <Text as="p" variant="bodySm" tone="subdued">{session.summary}</Text>
              <InlineStack gap="200" blockAlign="center">
                <OutcomeBadge outcome={session.outcome} />
                {session.cartValueEnd && (
                  <Text as="p" variant="bodyMd">${session.cartValueEnd.toFixed(2)}</Text>
                )}
                {session.country && <Text as="p" tone="subdued">{session.country}</Text>}
                {session.device && <Text as="p" tone="subdued">{session.device}</Text>}
              </InlineStack>
            </BlockStack>

            {/* Products */}
            {session.products.length > 0 && (
              <BlockStack gap="100">
                <Text as="h3" variant="headingSm">Products</Text>
                {session.products.map((p, i) => (
                  <Text key={i} as="p" variant="bodySm">
                    {p.productTitle} ×{p.quantity}  ${((p.price ?? 0) / 100).toFixed(2)}
                  </Text>
                ))}
              </BlockStack>
            )}

            {/* Timeline */}
            <BlockStack gap="100">
              <Text as="h3" variant="headingSm">Full Journey</Text>
              <div style={{ borderLeft: '2px solid #e1e3e5', paddingLeft: 16 }}>
                {timeline.map((ev, i) => {
                  const sentimentColor =
                    ev.sentiment === 'positive' ? '#008060' :
                    ev.sentiment === 'negative' ? '#d72c0d' : '#202223';
                  const sourceBg = ev.source === 'checkout' ? '#e8f0fe' : '#f4f6f8';
                  const sourceColor = ev.source === 'checkout' ? '#1a73e8' : '#6d7175';
                  const prevOccurred = i > 0 ? timeline[i - 1].occurredAt : null;

                  return (
                    <div key={i} style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
                      {/* Time column */}
                      <div style={{ minWidth: 80, flexShrink: 0 }}>
                        <div style={{ fontSize: 12, color: '#202223' }}>
                          {new Date(ev.occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}
                        </div>
                        {prevOccurred && (
                          <div style={{ fontSize: 11, color: '#6d7175' }}>
                            {formatElapsed(prevOccurred, ev.occurredAt)}
                          </div>
                        )}
                      </div>

                      {/* Source badge */}
                      <div style={{ minWidth: 70, flexShrink: 0 }}>
                        <span style={{
                          display: 'inline-block',
                          padding: '2px 7px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          background: sourceBg,
                          color: sourceColor,
                        }}>
                          {ev.source === 'checkout' ? 'Checkout' : 'Cart'}
                        </span>
                      </div>

                      {/* Label + detail */}
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500, color: sentimentColor }}>{ev.label}</div>
                        {ev.detail && (
                          <div style={{ fontSize: 12, color: '#6d7175', marginTop: 2 }}>{ev.detail}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {timeline.length === 0 && <Text as="p" tone="subdued">No events found.</Text>}
              </div>
            </BlockStack>
          </BlockStack>
        )}
      </Modal.Section>
    </Modal>
  );
}

export default function CartSessionsPage() {
  const shop = useShop();
  const now = new Date();
  const [range, setRange] = useState<DateRange>({ start: subDays(now, 7), end: now });
  const [page, setPage] = useState(1);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  // Filters
  const [outcome, setOutcome] = useState('all');
  const [country, setCountry] = useState('');
  const [device, setDevice] = useState('');
  const [minCart, setMinCart] = useState('');
  const [maxCart, setMaxCart] = useState('');
  const [hasCoupon, setHasCoupon] = useState('');
  const [product, setProduct] = useState('');

  const rangeQuery = `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;
  const filterQuery = [
    outcome !== 'all' ? `outcome=${outcome}` : '',
    country ? `country=${encodeURIComponent(country)}` : '',
    device ? `device=${device}` : '',
    minCart ? `minCart=${minCart}` : '',
    maxCart ? `maxCart=${maxCart}` : '',
    hasCoupon ? `hasCoupon=${hasCoupon}` : '',
    product ? `product=${encodeURIComponent(product)}` : '',
    `page=${page}`,
  ].filter(Boolean).join('&');

  const { data, error, isLoading } = useSWR(
    shop ? `/api/v2/cart/sessions?shop=${shop}&${rangeQuery}&${filterQuery}` : null,
    fetcher,
    { keepPreviousData: true }
  );

  const sessions: CartSessionV2[] = data?.sessions ?? [];
  const total: number = data?.total ?? 0;
  const scoped = data?.scopedCounts;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  const handleRangeChange = useCallback((r: DateRange) => {
    setRange(r);
    setPage(1);
  }, []);

  const clearFilters = () => {
    setOutcome('all');
    setCountry('');
    setDevice('');
    setMinCart('');
    setMaxCart('');
    setHasCoupon('');
    setProduct('');
    setPage(1);
  };

  const hasActiveFilters = outcome !== 'all' || country || device || minCart || maxCart || hasCoupon || product;

  return (
    <Page
      title="Cart Sessions"
      primaryAction={<DateRangeSelector value={range} onChange={handleRangeChange} />}
    >
      {error && (
        <Banner tone="critical" title="Failed to load sessions">
          <p>Please refresh the page.</p>
        </Banner>
      )}

      <Layout>
        {/* Filter Bar */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ minWidth: 140 }}>
                  <Select
                    label="Outcome"
                    options={[
                      { label: 'All outcomes', value: 'all' },
                      { label: 'Ordered', value: 'ordered' },
                      { label: 'Reached Checkout', value: 'checkout' },
                      { label: 'Abandoned', value: 'abandoned' },
                    ]}
                    value={outcome}
                    onChange={(v) => { setOutcome(v); setPage(1); }}
                  />
                </div>
                <div style={{ minWidth: 140 }}>
                  <Select
                    label="Device"
                    options={[
                      { label: 'All devices', value: '' },
                      { label: 'Desktop', value: 'desktop' },
                      { label: 'Mobile', value: 'mobile' },
                    ]}
                    value={device}
                    onChange={(v) => { setDevice(v); setPage(1); }}
                  />
                </div>
                <div style={{ minWidth: 140 }}>
                  <Select
                    label="Coupon"
                    options={[
                      { label: 'All', value: '' },
                      { label: 'Used a coupon', value: 'any' },
                      { label: 'No coupon', value: 'no' },
                      { label: 'Has failed coupon', value: 'failed' },
                      { label: 'Has recovered coupon', value: 'recovered' },
                    ]}
                    value={hasCoupon}
                    onChange={(v) => { setHasCoupon(v); setPage(1); }}
                  />
                </div>
                <div style={{ minWidth: 120 }}>
                  <TextField
                    label="Country"
                    value={country}
                    onChange={(v) => { setCountry(v); setPage(1); }}
                    placeholder="e.g. IN"
                    autoComplete="off"
                  />
                </div>
                <div style={{ minWidth: 100 }}>
                  <TextField
                    label="Min cart ($)"
                    value={minCart}
                    onChange={(v) => { setMinCart(v); setPage(1); }}
                    placeholder="0"
                    autoComplete="off"
                    type="number"
                  />
                </div>
                <div style={{ minWidth: 100 }}>
                  <TextField
                    label="Max cart ($)"
                    value={maxCart}
                    onChange={(v) => { setMaxCart(v); setPage(1); }}
                    placeholder="any"
                    autoComplete="off"
                    type="number"
                  />
                </div>
                <div style={{ minWidth: 180 }}>
                  <TextField
                    label="Product"
                    value={product}
                    onChange={(v) => { setProduct(v); setPage(1); }}
                    placeholder="Search product name"
                    autoComplete="off"
                  />
                </div>
              </div>

              {hasActiveFilters && (
                <InlineStack gap="200" blockAlign="center">
                  <Text as="p" variant="bodySm" tone="subdued">Active filters:</Text>
                  {outcome !== 'all' && (
                    <span style={{ background: '#e4e5e7', borderRadius: 12, padding: '2px 8px', fontSize: 12 }}>
                      {outcome} ×
                    </span>
                  )}
                  <Button variant="plain" size="slim" onClick={clearFilters}>Clear all</Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Scoped Counts */}
        {!isLoading && scoped && (
          <Layout.Section>
            <Text as="p" tone="subdued" variant="bodySm">
              Showing {scoped.total.toLocaleString()} sessions  ·  {scoped.checkoutRate.toFixed(1)}% reached checkout  ·  {scoped.completionRate.toFixed(1)}% completed order
            </Text>
          </Layout.Section>
        )}

        {/* Session Table */}
        <Layout.Section>
          <Card>
            {isLoading ? (
              <SkeletonBodyText lines={10} />
            ) : sessions.length === 0 ? (
              <EmptyState
                heading="No sessions in this period"
                image=""
              >
                <p>Cart sessions will appear here once customers visit the store.</p>
              </EmptyState>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e1e3e5' }}>
                      {['Time', 'Country / Device', 'Products', 'Cart Value', 'Coupons', 'Outcome', ''].map((h) => (
                        <th key={h} style={{ padding: '8px 12px', textAlign: 'left', color: '#6d7175', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((sess) => {
                      const productsStr = sess.products.length > 0
                        ? sess.products.map((p) => p.productTitle ?? 'item').join(', ').slice(0, 40) + (sess.products.map((p) => p.productTitle ?? '').join(', ').length > 40 ? '…' : '')
                        : sess.cartValueEnd ? `${sess.products.length} items` : 'Empty cart';

                      const cartDisplay =
                        sess.cartValueStart !== null && sess.cartValueEnd !== null && Math.abs((sess.cartValueEnd ?? 0) - (sess.cartValueStart ?? 0)) > 0.01
                          ? `$${sess.cartValueStart.toFixed(2)} → $${sess.cartValueEnd.toFixed(2)}`
                          : sess.cartValueEnd !== null
                          ? `$${sess.cartValueEnd.toFixed(2)}`
                          : '—';

                      return (
                        <tr key={sess.sessionId} style={{ borderBottom: '1px solid #f4f6f8' }}>
                          <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                            <div style={{ fontWeight: 500 }}>{formatTime(sess.startTime)}</div>
                            <div style={{ color: '#6d7175', fontSize: 12 }}>{formatDuration(sess.duration)}</div>
                          </td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                            <div>{sess.country ?? '—'}</div>
                            <div style={{ color: '#6d7175', fontSize: 12 }}>{sess.device ?? '—'}</div>
                          </td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'top', maxWidth: 200 }}>
                            <span title={sess.products.map((p) => p.productTitle ?? '').join(', ')}>{productsStr}</span>
                          </td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                            {cartDisplay}
                          </td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                            {sess.coupons.length === 0 ? '—' : sess.coupons.map((c) => <CouponPill key={c.code} coupon={c} />)}
                          </td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                            <OutcomeBadge outcome={sess.outcome} />
                          </td>
                          <td style={{ padding: '10px 12px', verticalAlign: 'top' }}>
                            <Button
                              variant="plain"
                              size="slim"
                              onClick={() => setSelectedSession(sess.sessionId)}
                            >
                              View →
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Pagination */}
                <div style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Page {page} of {totalPages} ({total.toLocaleString()} sessions)
                  </Text>
                  <InlineStack gap="200">
                    <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} size="slim">← Prev</Button>
                    <Button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} size="slim">Next →</Button>
                  </InlineStack>
                </div>
              </div>
            )}
          </Card>
        </Layout.Section>
      </Layout>

      {/* Timeline Modal */}
      {selectedSession && shop && (
        <TimelineModal
          sessionId={selectedSession}
          shop={shop}
          open={!!selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      )}
    </Page>
  );
}
