'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack,
  Button, Select, TextField, EmptyState, SkeletonBodyText, Spinner,
} from '@shopify/polaris';
import { useShop } from '@/hooks/useShop';
import { DateRangeSelector, type DateRange } from '@/components/monitor/DateRangeSelector';
import { deriveSourceV3 } from '@/lib/v3/session-builder';
import type { CartSessionV3, CouponV3 } from '@/lib/v3/session-builder';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function subDays(d: Date, n: number): Date { return new Date(d.getTime() - n * 86400000); }
function getDefaultRange(): DateRange {
  const now = new Date();
  return { start: subDays(now, 7), end: now };
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

function formatAbsTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function CouponDisplay({ coupons }: { coupons: CouponV3[] }) {
  if (coupons.length === 0) return <span style={{ color: '#6d7175' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {coupons.map((c) => {
        const color = c.status === 'applied' ? '#008060' : c.status === 'recovered' ? '#916a00' : '#d72c0d';
        const prefix = c.status === 'applied' ? '✓ ' : c.status === 'recovered' ? '↑ ' : '✗ ';
        return (
          <span key={c.code} style={{ fontSize: 12, color, fontWeight: 500 }}>
            {prefix}{c.code}
          </span>
        );
      })}
    </div>
  );
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  if (outcome === 'ordered') return <Badge tone="success">Ordered</Badge>;
  if (outcome === 'checkout') return <Badge tone="attention">Checkout</Badge>;
  return <Badge tone="info">Abandoned</Badge>;
}

function TimelineSheet({ sessionId, shop, onClose }: { sessionId: string; shop: string; onClose: () => void }) {
  const { data, isLoading } = useSWR(`/api/v3/session?shop=${shop}&sessionId=${sessionId}`, fetcher);
  const timeline: Array<{ source: string; occurredAt: string; label: string; detail: string | null; sentiment: string }> = data?.timeline ?? [];

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 440,
      background: '#fff', borderLeft: '1px solid #e1e3e5',
      zIndex: 1000, display: 'flex', flexDirection: 'column',
      boxShadow: '-4px 0 16px rgba(0,0,0,0.08)',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid #e1e3e5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="headingMd" as="h2">Session Timeline</Text>
        <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6d7175' }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        {isLoading ? <Spinner size="small" /> : timeline.length === 0 ? (
          <Text as="p" tone="subdued">No events found.</Text>
        ) : (
          <div style={{ borderLeft: '2px solid #e1e3e5', paddingLeft: 16 }}>
            {timeline.map((ev, i) => {
              const prevTime = i > 0 ? new Date(timeline[i - 1].occurredAt).getTime() : null;
              const elapsed = prevTime != null ? new Date(ev.occurredAt).getTime() - prevTime : null;
              const sentimentColor = ev.sentiment === 'positive' ? '#008060' : ev.sentiment === 'negative' ? '#d72c0d' : '#202223';
              const sourceBg = ev.source === 'checkout' ? '#e8f0fe' : '#f4f6f8';
              const sourceColor = ev.source === 'checkout' ? '#1a73e8' : '#6d7175';
              return (
                <div key={i} style={{ marginBottom: 14, display: 'flex', gap: 10 }}>
                  <div style={{ minWidth: 72, flexShrink: 0 }}>
                    <div style={{ fontSize: 12, color: '#202223' }}>
                      {new Date(ev.occurredAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true })}
                    </div>
                    {elapsed != null && elapsed > 0 && (
                      <div style={{ fontSize: 11, color: '#6d7175' }}>
                        {elapsed < 60000 ? `+${Math.round(elapsed / 1000)}s` : `+${Math.floor(elapsed / 60000)}m ${Math.round((elapsed % 60000) / 1000)}s`}
                      </div>
                    )}
                  </div>
                  <div style={{ minWidth: 64, flexShrink: 0 }}>
                    <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600, background: sourceBg, color: sourceColor }}>
                      {ev.source === 'checkout' ? 'Checkout' : 'Cart'}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: sentimentColor }}>{ev.label}</div>
                    {ev.detail && <div style={{ fontSize: 12, color: '#6d7175', marginTop: 2 }}>{ev.detail}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function CartSessionsPage() {
  const shop = useShop();
  const [range, setRange] = useState<DateRange>(getDefaultRange);
  const [page, setPage] = useState(1);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [device, setDevice] = useState('');
  const [country, setCountry] = useState('');
  const [source, setSource] = useState('');
  const [minCart, setMinCart] = useState('');
  const [maxCart, setMaxCart] = useState('');
  const [hasCoupon, setHasCoupon] = useState('');

  const rangeQuery = `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;
  const filterQuery = [
    device ? `device=${device}` : '',
    country ? `country=${encodeURIComponent(country)}` : '',
    source ? `source=${encodeURIComponent(source)}` : '',
    minCart ? `minCart=${minCart}` : '',
    maxCart ? `maxCart=${maxCart}` : '',
    hasCoupon ? `hasCoupon=${hasCoupon}` : '',
    search ? `search=${encodeURIComponent(search)}` : '',
    `page=${page}`,
  ].filter(Boolean).join('&');

  const { data, isLoading } = useSWR(
    shop ? `/api/v3/sessions?shop=${shop}&${rangeQuery}&${filterQuery}` : null,
    fetcher, { keepPreviousData: true },
  );

  const sessions: CartSessionV3[] = data?.sessions ?? [];
  const total: number = data?.total ?? 0;
  const scoped = data?.scopedCounts;
  const totalPages = Math.max(1, Math.ceil(total / 25));

  const handleRangeChange = useCallback((r: DateRange) => { setRange(r); setPage(1); }, []);

  const clearFilters = () => {
    setSearch(''); setDevice(''); setCountry(''); setSource('');
    setMinCart(''); setMaxCart(''); setHasCoupon(''); setPage(1);
  };
  const hasFilters = search || device || country || source || minCart || maxCart || hasCoupon;

  return (
    <Page title="Cart Sessions" primaryAction={<DateRangeSelector value={range} onChange={handleRangeChange} />}>
      <Layout>

        {/* Search bar */}
        <Layout.Section>
          <TextField
            label=""
            labelHidden
            placeholder="Search by session ID, product name, or coupon code…"
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            autoComplete="off"
            clearButton
            onClearButtonClick={() => { setSearch(''); setPage(1); }}
          />
        </Layout.Section>

        {/* Filters */}
        <Layout.Section>
          <Card>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ minWidth: 120 }}>
                <Select label="Device"
                  options={[{ label: 'All devices', value: '' }, { label: 'Desktop', value: 'desktop' }, { label: 'Mobile', value: 'mobile' }]}
                  value={device} onChange={(v) => { setDevice(v); setPage(1); }}
                />
              </div>
              <div style={{ minWidth: 140 }}>
                <Select label="Source"
                  options={[
                    { label: 'All sources', value: '' },
                    { label: 'Direct', value: 'Direct' },
                    { label: 'Paid search', value: 'Paid search' },
                    { label: 'Social', value: 'Social' },
                    { label: 'Email', value: 'Email' },
                  ]}
                  value={source} onChange={(v) => { setSource(v); setPage(1); }}
                />
              </div>
              <div style={{ minWidth: 140 }}>
                <Select label="Coupon"
                  options={[
                    { label: 'Any', value: '' },
                    { label: 'Used a coupon', value: 'any' },
                    { label: 'No coupon', value: 'no' },
                    { label: 'Has failed coupon', value: 'failed' },
                    { label: 'Has recovered coupon', value: 'recovered' },
                  ]}
                  value={hasCoupon} onChange={(v) => { setHasCoupon(v); setPage(1); }}
                />
              </div>
              <div style={{ minWidth: 140 }}>
                <Select label="Cart value"
                  options={[
                    { label: 'Any', value: '' },
                    { label: 'Under $50', value: 'max50' },
                    { label: '$50–$100', value: '50-100' },
                    { label: '$100–$150', value: '100-150' },
                    { label: '$150–$200', value: '150-200' },
                    { label: '$200+', value: 'min200' },
                  ]}
                  value={minCart ? (maxCart ? `${minCart}-${maxCart}` : `min${minCart}`) : (maxCart ? `max${maxCart}` : '')}
                  onChange={(v) => {
                    if (!v) { setMinCart(''); setMaxCart(''); }
                    else if (v.startsWith('max')) { setMinCart(''); setMaxCart(v.slice(3)); }
                    else if (v.startsWith('min')) { setMinCart(v.slice(3)); setMaxCart(''); }
                    else { const [mn, mx] = v.split('-'); setMinCart(mn); setMaxCart(mx); }
                    setPage(1);
                  }}
                />
              </div>
              <div style={{ minWidth: 100 }}>
                <TextField label="Country" value={country} onChange={(v) => { setCountry(v); setPage(1); }} placeholder="e.g. US" autoComplete="off" />
              </div>
              {hasFilters && <div style={{ alignSelf: 'flex-end' }}><Button variant="plain" onClick={clearFilters}>Clear all</Button></div>}
            </div>
          </Card>
        </Layout.Section>

        {/* Scoped counts */}
        {!isLoading && scoped && (
          <Layout.Section>
            <Text as="p" variant="bodySm" tone="subdued">
              Showing {scoped.total.toLocaleString()} sessions
              {scoped.checkoutRate > 0 && ` · ${scoped.checkoutRate}% reached checkout`}
              {scoped.completionRate > 0 && ` · ${scoped.completionRate}% completed order`}
            </Text>
          </Layout.Section>
        )}

        {/* Table */}
        <Layout.Section>
          <Card>
            {isLoading ? <SkeletonBodyText lines={10} /> : sessions.length === 0 ? (
              <EmptyState heading="No sessions in this period" image="">
                <Text as="p">{hasFilters ? 'Try a different filter or wider date range.' : 'Sessions appear once customers visit the store.'}</Text>
                {hasFilters && <Button onClick={clearFilters}>Clear filters</Button>}
              </EmptyState>
            ) : (
              <div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '9%' }} />
                    <col style={{ width: '11%' }} />
                    <col style={{ width: '30%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '10%' }} />
                    <col style={{ width: '5%' }} />
                  </colgroup>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e1e3e5' }}>
                      {['Time', 'Location', 'Source', 'Products', 'Value', 'Coupons', 'Outcome', ''].map((h) => (
                        <th key={h} style={{ padding: '8px 8px', textAlign: 'left', color: '#6d7175', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => {
                      const cartDisplay = s.cartValueStart != null && s.cartValueEnd != null && Math.abs(s.cartValueEnd - s.cartValueStart) > 0.01
                        ? `$${s.cartValueStart.toFixed(2)}→$${s.cartValueEnd.toFixed(2)}`
                        : s.cartValueEnd != null ? `$${s.cartValueEnd.toFixed(2)}` : '—';
                      const src = deriveSourceV3(s.utmSource, s.utmMedium);
                      return (
                        <tr key={s.sessionId} style={{ borderBottom: '1px solid #f4f6f8' }}>
                          <td style={{ padding: '8px 8px', verticalAlign: 'top' }}>
                            <div style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{formatRelativeTime(s.startTime)}</div>
                            <div style={{ color: '#6d7175', fontSize: 11 }}>{formatAbsTime(s.startTime)}</div>
                            <div style={{ color: '#6d7175', fontSize: 11 }}>{formatDuration(s.duration)}</div>
                          </td>
                          <td style={{ padding: '8px 8px', verticalAlign: 'top' }}>
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.country ?? '—'}</div>
                            <div style={{ color: '#6d7175', fontSize: 11 }}>{s.device ?? '—'}</div>
                          </td>
                          <td style={{ padding: '8px 8px', verticalAlign: 'top' }}>
                            <span style={{ display: 'inline-block', padding: '2px 5px', borderRadius: 4, fontSize: 11, fontWeight: 500, background: src !== 'Direct' ? '#e8f0fe' : '#f4f6f8', color: src !== 'Direct' ? '#1a73e8' : '#6d7175', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src}</span>
                            {s.utmCampaign && (
                              <div style={{ fontSize: 11, color: '#6d7175', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.utmCampaign}>{s.utmCampaign}</div>
                            )}
                          </td>
                          <td style={{ padding: '8px 8px', verticalAlign: 'top' }}>
                            {s.products.length > 0
                              ? s.products.map((p, i) => (
                                <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.productTitle ?? 'item'} ×{p.quantity}</div>
                              ))
                              : <span style={{ color: '#6d7175' }}>{s.cartItemCount != null && s.cartItemCount > 0 ? `${s.cartItemCount} item${s.cartItemCount !== 1 ? 's' : ''}` : 'Empty cart'}</span>
                            }
                          </td>
                          <td style={{ padding: '8px 8px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{cartDisplay}</td>
                          <td style={{ padding: '8px 8px', verticalAlign: 'top' }}><CouponDisplay coupons={s.coupons} /></td>
                          <td style={{ padding: '8px 8px', verticalAlign: 'top' }}>
                            <div title="This reflects activity within this session only."><OutcomeBadge outcome={s.outcome} /></div>
                          </td>
                          <td style={{ padding: '8px 4px', verticalAlign: 'top' }}>
                            <button onClick={() => setSelectedSession(s.sessionId)} style={{ background: 'none', border: 'none', color: '#2c6ecb', cursor: 'pointer', fontSize: 13, padding: 0, whiteSpace: 'nowrap' }}>View →</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Pagination */}
                <div style={{ padding: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text as="p" variant="bodySm" tone="subdued">Page {page} of {totalPages} ({total.toLocaleString()} sessions)</Text>
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

      {selectedSession && shop && (
        <TimelineSheet sessionId={selectedSession} shop={shop} onClose={() => setSelectedSession(null)} />
      )}
    </Page>
  );
}
