'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import {
  Page, Layout, Card, Text, Badge, InlineStack, BlockStack,
  Box, Button, Select, EmptyState, SkeletonBodyText, Spinner, Banner,
} from '@shopify/polaris';
import { useShop } from '@/hooks/useShop';
import { DateRangeSelector, type DateRange } from '@/components/monitor/DateRangeSelector';
import { deriveSourceV3 } from '@/lib/v3/session-builder';
import type { CartSessionV3, CouponV3 } from '@/lib/v3/session-builder';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function subMs(date: Date, ms: number): Date {
  return new Date(date.getTime() - ms);
}
function getDefaultRange(): DateRange {
  const now = new Date();
  return { start: subMs(now, 24 * 3600 * 1000), end: now };
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
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function formatCents(cents: number | null): string {
  if (cents == null) return '—';
  return '$' + (cents / 100).toFixed(2);
}

function DeltaBadge({ delta, type }: { delta: number | null; type: 'pct' | 'pp' | 'money' }) {
  if (delta == null) return null;
  const isGood = delta >= 0;
  const isNeutral = Math.abs(delta) < 2;
  const color = isNeutral ? '#6d7175' : isGood ? '#008060' : '#d72c0d';
  let label = '';
  if (type === 'pct') label = `${delta >= 0 ? '+' : ''}${delta}%`;
  else if (type === 'pp') label = `${delta >= 0 ? '+' : ''}${delta}pp`;
  else label = `${delta >= 0 ? '+' : ''}$${Math.abs(delta).toFixed(2)}`;
  return <span style={{ fontSize: 11, color, fontWeight: 500, marginLeft: 4 }}>{label}</span>;
}

function KPICard({
  label, value, sub, subDetail, delta, deltaType, onClick, active, color,
}: {
  label: string; value: string | number; sub?: string; subDetail?: string;
  delta?: number | null; deltaType?: 'pct' | 'pp' | 'money';
  onClick?: () => void; active?: boolean; color?: string;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : undefined,
        outline: active ? '2px solid #2c6ecb' : undefined,
        borderRadius: 8, flex: 1, minWidth: 140,
      }}
    >
      <Card>
        <BlockStack gap="100">
          <Text variant="bodySm" as="p" tone="subdued">{label}</Text>
          <InlineStack gap="100" blockAlign="center">
            <Text variant="headingLg" as="p">
              <span style={color ? { color } : undefined}>{String(value)}</span>
            </Text>
            {delta != null && deltaType && <DeltaBadge delta={delta} type={deltaType} />}
          </InlineStack>
          {sub && <Text variant="bodySm" as="p" tone={active ? undefined : 'subdued'}>{sub}</Text>}
          {subDetail && <Text variant="bodySm" as="p" tone="subdued">{subDetail}</Text>}
        </BlockStack>
      </Card>
    </div>
  );
}

function CouponDisplay({ coupons }: { coupons: CouponV3[] }) {
  if (coupons.length === 0) return <span style={{ color: '#6d7175' }}>—</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {coupons.map((c) => {
        const color = c.status === 'applied' ? '#008060' : c.status === 'recovered' ? '#916a00' : '#d72c0d';
        const prefix = c.status === 'applied' ? '✓ ' : c.status === 'recovered' ? '↑ ' : '✗ ';
        const suffix = (c.status === 'applied' || c.status === 'recovered') && c.discountAmount
          ? ` −${formatCents(c.discountAmount)}` : '';
        return (
          <span key={c.code} style={{ fontSize: 12, color, fontWeight: 500 }}>
            {prefix}{c.code}{suffix}
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

// ── Timeline Sheet ─────────────────────────────────────────────────────────

function TimelineSheet({ sessionId, shop, onClose }: { sessionId: string; shop: string; onClose: () => void }) {
  const { data, isLoading } = useSWR(
    `/api/v3/session?shop=${shop}&sessionId=${sessionId}`,
    fetcher,
  );
  const timeline: Array<{
    source: string; eventType: string; occurredAt: string;
    label: string; detail: string | null; sentiment: string;
  }> = data?.timeline ?? [];

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
          <Text as="p" tone="subdued">No events found for this session.</Text>
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

// ── Session Table ──────────────────────────────────────────────────────────

function SessionTable({
  sessions,
  onView,
  loading,
  activeFilter,
  productSearch,
  onClearFilters,
}: {
  sessions: CartSessionV3[];
  onView: (id: string) => void;
  loading: boolean;
  activeFilter: string | null;
  productSearch: string;
  onClearFilters: () => void;
}) {
  if (loading) return <SkeletonBodyText lines={8} />;
  if (sessions.length === 0) {
    return (
      <EmptyState heading={activeFilter || productSearch ? 'No sessions match this filter' : 'No sessions in this period'} image="">
        <Text as="p">
          {activeFilter || productSearch ? 'Try a different filter or wider date range.' : 'Sessions appear once customers visit the store.'}
        </Text>
        {(activeFilter || productSearch) && (
          <Button onClick={onClearFilters}>Clear filters</Button>
        )}
      </EmptyState>
    );
  }

  return (
    <div style={{ overflowX: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e1e3e5' }}>
            {['Time', 'Country / Device', 'Source', 'Products', 'Cart Value', 'Coupons', 'Outcome', ''].map((h) => (
              <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#6d7175', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const cartDisplay = s.cartValueStart != null && s.cartValueEnd != null && Math.abs(s.cartValueEnd - s.cartValueStart) > 0.01
              ? `$${s.cartValueStart.toFixed(2)} → $${s.cartValueEnd.toFixed(2)}`
              : s.cartValueEnd != null ? `$${s.cartValueEnd.toFixed(2)}` : '—';

            const productsStr = s.products.length > 0
              ? s.products.map((p) => `${p.productTitle ?? 'item'} ×${p.quantity}`).join('\n')
              : s.cartItemCount != null && s.cartItemCount > 0
              ? `${s.cartItemCount} item${s.cartItemCount !== 1 ? 's' : ''}`
              : 'Empty cart';

            const source = deriveSourceV3(s.utmSource, s.utmMedium);

            return (
              <tr key={s.sessionId} style={{ borderBottom: '1px solid #f4f6f8' }}>
                <td style={{ padding: '10px 10px', verticalAlign: 'top', minWidth: 100 }}>
                  <div style={{ fontWeight: 500 }}>{formatRelativeTime(s.startTime)}</div>
                  <div style={{ color: '#6d7175', fontSize: 11 }}>{formatAbsTime(s.startTime)}</div>
                  <div style={{ color: '#6d7175', fontSize: 11 }}>{formatDuration(s.duration)}</div>
                </td>
                <td style={{ padding: '10px 10px', verticalAlign: 'top', minWidth: 70 }}>
                  <div>{s.country ?? '—'}</div>
                  <div style={{ color: '#6d7175', fontSize: 11 }}>{s.device ?? '—'}</div>
                </td>
                <td style={{ padding: '10px 10px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  <span style={{
                    display: 'inline-block', padding: '2px 6px', borderRadius: 4,
                    fontSize: 11, fontWeight: 500,
                    background: source !== 'Direct' ? '#e8f0fe' : '#f4f6f8',
                    color: source !== 'Direct' ? '#1a73e8' : '#6d7175',
                  }}>
                    {source}
                  </span>
                  {s.utmCampaign && (
                    <div style={{ fontSize: 11, color: '#6d7175', marginTop: 2 }} title={s.utmCampaign}>
                      {s.utmCampaign.slice(0, 18)}{s.utmCampaign.length > 18 ? '…' : ''}
                    </div>
                  )}
                </td>
                <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                  {productsStr.split('\n').map((line, i) => (
                    <div key={i} style={{ whiteSpace: 'nowrap', color: productsStr === 'Empty cart' ? '#6d7175' : undefined }}>{line}</div>
                  ))}
                </td>
                <td style={{ padding: '10px 10px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  {cartDisplay}
                </td>
                <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                  <CouponDisplay coupons={s.coupons} />
                </td>
                <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                  <div title="This reflects activity within this session only. The customer may have returned and purchased in a separate session.">
                    <OutcomeBadge outcome={s.outcome} />
                  </div>
                </td>
                <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                  <button
                    onClick={() => onView(s.sessionId)}
                    style={{ background: 'none', border: 'none', color: '#2c6ecb', cursor: 'pointer', fontSize: 13, padding: 0 }}
                  >
                    View →
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

export default function CartActivityPage() {
  const shop = useShop();
  const [range, setRange] = useState<DateRange>(getDefaultRange);
  const [activeFilter, setActiveFilter] = useState<'withProducts' | 'withCoupon' | 'checkedOut' | null>(null);
  const [deviceFilter, setDeviceFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const rangeQuery = `start=${range.start.toISOString()}&end=${range.end.toISOString()}`;

  // Overview KPIs
  const { data: kpiData, isLoading: kpiLoading } = useSWR(
    shop ? `/api/v3/overview?shop=${shop}&${rangeQuery}` : null,
    fetcher, { revalidateOnFocus: false },
  );

  // Sessions
  const filterQuery = [
    deviceFilter ? `device=${deviceFilter}` : '',
    countryFilter ? `country=${encodeURIComponent(countryFilter)}` : '',
    sourceFilter ? `source=${encodeURIComponent(sourceFilter)}` : '',
  ].filter(Boolean).join('&');

  const { data: sessionsData, isLoading: sessionsLoading } = useSWR(
    shop ? `/api/v3/sessions?shop=${shop}&${rangeQuery}${filterQuery ? '&' + filterQuery : ''}` : null,
    fetcher, { revalidateOnFocus: false, keepPreviousData: true },
  );

  const kpis = kpiData?.kpis;
  const recentAlerts: Array<{ id: string; title: string; body: string | null; severity: string; firedAt: string }> = kpiData?.recentAlerts ?? [];
  const allSessions: CartSessionV3[] = sessionsData?.sessions ?? [];

  // Client-side filter for KPI card + session filtering
  const filteredSessions = allSessions.filter((s) => {
    if (activeFilter === 'withProducts') return s.products.length > 0 || (s.cartItemCount ?? 0) > 0 || (s.cartValueEnd ?? 0) > 0;
    if (activeFilter === 'withCoupon') return s.coupons.length > 0;
    if (activeFilter === 'checkedOut') return s.outcome === 'checkout' || s.outcome === 'ordered';
    return true;
  });

  const handleKpiClick = useCallback((filter: 'withProducts' | 'withCoupon' | 'checkedOut') => {
    setActiveFilter((prev) => prev === filter ? null : filter);
  }, []);

  const clearFilters = () => {
    setActiveFilter(null);
    setDeviceFilter('');
    setCountryFilter('');
    setSourceFilter('');
  };

  const hasFilters = activeFilter || deviceFilter || countryFilter || sourceFilter;

  const loading = kpiLoading || sessionsLoading;

  return (
    <Page
      title="Cart Activity"
      subtitle="Live cart monitoring"
      primaryAction={<DateRangeSelector value={range} onChange={(r) => { setRange(r); }} />}
    >
      <Layout>

        {/* KPI Cards */}
        <Layout.Section>
          {kpiLoading ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {[1,2,3,4].map((i) => <div key={i} style={{ flex: 1, minWidth: 140 }}><Card><SkeletonBodyText lines={3} /></Card></div>)}
            </div>
          ) : kpis ? (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <KPICard
                label="Carts opened"
                value={kpis.cartsOpened.value}
                sub={`${kpis.cartsOpened.withProducts} with products · ${kpis.cartsOpened.emptyOpens} empty`}
                delta={kpis.cartsOpened.delta}
                deltaType="pct"
              />
              <KPICard
                label="With products"
                value={kpis.withProducts.value}
                sub={`${kpis.withProducts.pct}% of sessions`}
                subDetail={`was ${kpis.withProducts.prevPct}% prev period`}
                delta={kpis.withProducts.delta}
                deltaType="pp"
                onClick={() => handleKpiClick('withProducts')}
                active={activeFilter === 'withProducts'}
              />
              <KPICard
                label="Coupon attempted"
                value={kpis.withCoupon.value}
                sub={`${kpis.withCoupon.pct}% of product carts`}
                subDetail={`was ${kpis.withCoupon.prevPct}% prev period`}
                delta={kpis.withCoupon.delta}
                deltaType="pp"
                onClick={() => handleKpiClick('withCoupon')}
                active={activeFilter === 'withCoupon'}
              />
              <KPICard
                label="Reached checkout"
                value={kpis.reachedCheckout.value}
                sub={`${kpis.reachedCheckout.pct}% of product carts`}
                subDetail={`was ${kpis.reachedCheckout.prevPct}% prev period`}
                delta={kpis.reachedCheckout.delta}
                deltaType="pp"
                onClick={() => handleKpiClick('checkedOut')}
                active={activeFilter === 'checkedOut'}
              />
            </div>
          ) : null}
        </Layout.Section>

        {/* Filter bar */}
        <Layout.Section>
          <Card>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
              <div style={{ minWidth: 120 }}>
                <Select
                  label="Device"
                  options={[
                    { label: 'All devices', value: '' },
                    { label: 'Desktop', value: 'desktop' },
                    { label: 'Mobile', value: 'mobile' },
                  ]}
                  value={deviceFilter}
                  onChange={(v) => setDeviceFilter(v)}
                />
              </div>
              <div style={{ minWidth: 140 }}>
                <Select
                  label="Traffic source"
                  options={[
                    { label: 'All sources', value: '' },
                    { label: 'Direct', value: 'Direct' },
                    { label: 'Paid search', value: 'Paid search' },
                    { label: 'Social', value: 'Social' },
                    { label: 'Email', value: 'Email' },
                  ]}
                  value={sourceFilter}
                  onChange={(v) => setSourceFilter(v)}
                />
              </div>
              {hasFilters && (
                <Button variant="plain" onClick={clearFilters}>Clear all</Button>
              )}
            </div>
          </Card>
        </Layout.Section>

        {/* Scoped counts */}
        {!loading && sessionsData?.scopedCounts && (
          <Layout.Section>
            <Text as="p" variant="bodySm" tone="subdued">
              Showing {filteredSessions.length.toLocaleString()} sessions
              {sessionsData.scopedCounts.checkoutRate > 0 && ` · ${sessionsData.scopedCounts.checkoutRate}% reached checkout`}
              {sessionsData.scopedCounts.completionRate > 0 && ` · ${sessionsData.scopedCounts.completionRate}% completed order`}
            </Text>
          </Layout.Section>
        )}

        {/* Session table */}
        <Layout.Section>
          <Card padding="400">
            <SessionTable
              sessions={filteredSessions}
              onView={setSelectedSession}
              loading={sessionsLoading}
              activeFilter={activeFilter}
              productSearch=""
              onClearFilters={clearFilters}
            />
          </Card>
        </Layout.Section>

        {/* Recent alerts strip */}
        {recentAlerts.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text variant="headingSm" as="h3">Recent alerts</Text>
                  <a href="/dashboard/v3/notifications" style={{ fontSize: 13, color: '#2c6ecb', textDecoration: 'none' }}>View all →</a>
                </InlineStack>
                {recentAlerts.map((alert) => {
                  const dotColor = alert.severity === 'critical' ? '#d72c0d' : alert.severity === 'warning' ? '#b98900' : '#2c6ecb';
                  return (
                    <div key={alert.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, marginTop: 5 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ fontSize: 13, fontWeight: 500 }}>{alert.title}</span>
                        {alert.body && <span style={{ fontSize: 12, color: '#6d7175', marginLeft: 6 }}>{alert.body.slice(0, 80)}{alert.body.length > 80 ? '…' : ''}</span>}
                      </div>
                      <span style={{ fontSize: 11, color: '#6d7175', whiteSpace: 'nowrap' }}>
                        {formatRelativeTime(alert.firedAt)}
                      </span>
                    </div>
                  );
                })}
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

      </Layout>

      {/* Timeline sheet */}
      {selectedSession && shop && (
        <TimelineSheet sessionId={selectedSession} shop={shop} onClose={() => setSelectedSession(null)} />
      )}
    </Page>
  );
}
