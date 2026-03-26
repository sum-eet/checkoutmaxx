'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Card, BlockStack, InlineStack, InlineGrid, Text } from '@shopify/polaris';
import dynamic from 'next/dynamic';

const BarChart            = dynamic(() => import('recharts').then(m => ({ default: m.BarChart })),            { ssr: false });
const Bar                 = dynamic(() => import('recharts').then(m => ({ default: m.Bar })),                 { ssr: false });
const XAxis               = dynamic(() => import('recharts').then(m => ({ default: m.XAxis })),               { ssr: false });
const YAxis               = dynamic(() => import('recharts').then(m => ({ default: m.YAxis })),               { ssr: false });
const Tooltip             = dynamic(() => import('recharts').then(m => ({ default: m.Tooltip })),             { ssr: false });
const ResponsiveContainer = dynamic(() => import('recharts').then(m => ({ default: m.ResponsiveContainer })), { ssr: false });

import { useShop } from '@/hooks/useShop';
import { DateRangePicker, DateRange } from '@/components/couponmaxx/DateRangePicker';
import { LoadingBar } from '@/components/couponmaxx/LoadingBar';

// ── Types ──────────────────────────────────────────────────────────

type FunnelRow = {
  period: string;
  sessions: number;
  added_to_cart: number;
  started_checkout: number;
  completed_checkout: number;
};

type SourceRow = {
  source: string;
  medium: string | null;
  today_atc: number;
  today_checkout: number;
  avg_atc: number;
  avg_checkout: number;
};

type CheckoutStepRow = {
  started: number;
  contact: number;
  address: number;
  shipping: number;
  payment: number;
  completed: number;
};

type LastEventRow = {
  last_event: string;
  session_count: number;
};

type TimingRow = {
  type: string;
  bucket: string;
  count: number;
};

type ConverterRow = {
  converted: boolean;
  session_count: number;
  avg_time_seconds: number;
  avg_items: number;
  avg_cart_value_dollars: number;
  coupon_usage_pct: number;
  coupon_failed_pct: number;
  removal_pct: number;
  paid_traffic_pct: number;
  mobile_pct: number;
};

type CartData = {
  funnelToday: FunnelRow[];
  funnelBySource: SourceRow[];
  checkoutSteps: CheckoutStepRow[];
  lastEvents: LastEventRow[];
  checkoutTiming: TimingRow[];
  converterComparison: ConverterRow[];
  timeDistribution: { bucket: string; sessions: number }[];
};

// ── Helpers ────────────────────────────────────────────────────────

function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }

function getDefaultRange(): DateRange {
  return { start: subDays(new Date(), 7), end: new Date() };
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

function fmtSeconds(s: number) {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  if (m === 0) return `${sec}s`;
  return `${m}m ${sec}s`;
}

const BUCKET_LABELS: Record<string, string> = {
  under_1_min: '< 1 min',
  '1_3_min': '1–3 min',
  '3_5_min': '3–5 min',
  '5_10_min': '5–10 min',
  '10_plus_min': '10+ min',
};

const BUCKET_ORDER = ['under_1_min', '1_3_min', '3_5_min', '5_10_min', '10_plus_min'];

const LAST_EVENT_LABELS: Record<string, string> = {
  cart_coupon_failed: 'Coupon attempt (failed)',
  cart_coupon_applied: 'Coupon attempt (succeeded)',
  cart_item_removed: 'Item removed from cart',
  cart_item_added: 'Item added to cart',
  cart_item_changed: 'Quantity changed',
  cart_page_hidden: 'Left the page',
  cart_viewed: 'Cart viewed, no action',
  cart_fetched: 'Cart viewed, no action',
  returned_from_checkout: 'Returned from checkout',
};

// ── Section 1: Today vs Normal ─────────────────────────────────────

function FunnelSection({ funnelToday, funnelBySource }: { funnelToday: FunnelRow[]; funnelBySource: SourceRow[] }) {
  const today = funnelToday.find(r => r.period === 'today');
  const avg   = funnelToday.find(r => r.period === 'avg_7d');

  if (!today && !avg) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text variant="headingSm" as="h2">Today vs. 7-day average</Text>
          <Text as="p" tone="subdued">No cart activity recorded for today.</Text>
        </BlockStack>
      </Card>
    );
  }

  const hasSessionData = (today?.sessions ?? 0) > 0 || (avg?.sessions ?? 0) > 0;

  type Step = { label: string; today: number; avg: number };
  const steps: Step[] = [];
  if (hasSessionData) {
    steps.push({ label: 'Sessions', today: today?.sessions ?? 0, avg: avg?.sessions ?? 0 });
  }
  steps.push({ label: 'Added to cart',      today: today?.added_to_cart ?? 0,     avg: avg?.added_to_cart ?? 0 });
  steps.push({ label: 'Started checkout',   today: today?.started_checkout ?? 0,  avg: avg?.started_checkout ?? 0 });
  steps.push({ label: 'Completed checkout', today: today?.completed_checkout ?? 0, avg: avg?.completed_checkout ?? 0 });

  function rate(num: number, den: number): number | null {
    if (!den) return null;
    return Math.round((num / den) * 100 * 10) / 10;
  }

  const rates = steps.slice(1).map((step, i) => {
    const tRate = rate(step.today, steps[i].today);
    const aRate = rate(step.avg,   steps[i].avg);
    const ppDiff = tRate !== null && aRate !== null ? Math.round((tRate - aRate) * 10) / 10 : null;
    return { todayRate: tRate, avgRate: aRate, ppDiff };
  });

  const allNormal = rates.every(r => r.ppDiff === null || Math.abs(r.ppDiff) <= 5);

  function changePct(todayVal: number, avgVal: number): number | null {
    if (!avgVal) return null;
    return Math.round(((todayVal - avgVal) / avgVal) * 100 * 10) / 10;
  }

  const problemSources = (funnelBySource ?? []).filter(s => {
    const tRate = s.today_atc > 0 ? (s.today_checkout / s.today_atc) * 100 : 0;
    const aRate = s.avg_atc   > 0 ? (s.avg_checkout   / s.avg_atc)   * 100 : 0;
    return (aRate - tRate) > 10;
  });

  return (
    <Card>
      <BlockStack gap="400">
        <div>
          <Text variant="headingSm" as="h2">Today vs. 7-day average</Text>
          <Text variant="bodySm" tone="subdued" as="p">Funnel performance today compared to your recent baseline</Text>
        </div>

        {/* Funnel row */}
        <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 0 }}>
          {steps.map((step, i) => {
            const pct = changePct(step.today, step.avg);
            const isDown = pct !== null && pct < 0;
            const isBigDrop = pct !== null && pct < -10;

            return (
              <div key={step.label} style={{ display: 'flex', alignItems: 'flex-start' }}>
                {/* Step card */}
                <div style={{
                  border: '1px solid #E5E7EB',
                  borderRadius: 8,
                  padding: '12px 16px',
                  minWidth: 140,
                  background: '#fff',
                }}>
                  <Text variant="bodySm" tone="subdued" as="p">{step.label}</Text>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#202223', margin: '4px 0 2px' }}>
                    {step.today.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 12, color: '#6B7280' }}>7d avg: {step.avg.toLocaleString()}</div>
                  {pct !== null && (
                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color: isBigDrop ? '#D72C0D' : isDown ? '#6B7280' : '#15803D' }}>
                      {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%
                    </div>
                  )}
                </div>

                {/* Arrow + conversion rate between steps */}
                {i < steps.length - 1 && rates[i] && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px 8px', minWidth: 80 }}>
                    <div style={{ fontSize: 18, color: '#9CA3AF' }}>→</div>
                    <div style={{ textAlign: 'center', marginTop: 4 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 600,
                        color: rates[i].ppDiff !== null && rates[i].ppDiff! < -5 ? '#D72C0D' : '#202223',
                      }}>
                        {rates[i].todayRate !== null ? `${rates[i].todayRate}%` : '—'}
                      </div>
                      <div style={{ fontSize: 11, color: '#9CA3AF' }}>
                        avg {rates[i].avgRate !== null ? `${rates[i].avgRate}%` : '—'}
                      </div>
                      {rates[i].ppDiff !== null && (
                        <div style={{
                          fontSize: 11, fontWeight: 500,
                          color: rates[i].ppDiff! < -5 ? '#D72C0D' : rates[i].ppDiff! > 0 ? '#15803D' : '#6B7280',
                        }}>
                          {rates[i].ppDiff! > 0 ? '▲' : '▼'} {Math.abs(rates[i].ppDiff!)}pp
                          {rates[i].ppDiff! < -5 && ' 🔴'}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {allNormal && (
          <div style={{ fontSize: 13, color: '#15803D', background: '#F0FDF4', padding: '8px 12px', borderRadius: 6 }}>
            All funnel steps are within normal range today.
          </div>
        )}

        {/* Problem sources table */}
        {problemSources.length > 0 && (
          <BlockStack gap="200">
            <Text variant="headingSm" as="h3">Sources with significant checkout rate drop today</Text>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                    {['Source / Medium', 'Rate today', '7d avg rate', 'Change'].map((h, j) => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: j === 0 ? 'left' : 'right', fontSize: 12, fontWeight: 500, color: '#6B7280' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {problemSources.slice(0, 5).map(s => {
                    const tRate = s.today_atc > 0 ? Math.round((s.today_checkout / s.today_atc) * 100 * 10) / 10 : 0;
                    const aRate = s.avg_atc   > 0 ? Math.round((s.avg_checkout   / s.avg_atc)   * 100 * 10) / 10 : 0;
                    const diff  = Math.round((tRate - aRate) * 10) / 10;
                    return (
                      <tr key={`${s.source}-${s.medium}`} style={{ borderBottom: '1px solid #F3F4F6' }}>
                        <td style={{ padding: '8px 12px' }}>
                          <div>{s.source}</div>
                          {s.medium && <div style={{ fontSize: 11, color: '#9CA3AF' }}>{s.medium}</div>}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{tRate}%</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right' }}>{aRate}%</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#D72C0D', fontWeight: 600 }}>{diff}pp</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

// ── Section 2: Checkout Step Funnel ───────────────────────────────

function CheckoutStepsSection({ data }: { data: CheckoutStepRow[] }) {
  const row = data?.[0];

  if (!row || Number(row.started) === 0) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text variant="headingSm" as="h2">Checkout step funnel</Text>
          <Text as="p" tone="subdued">Checkout step data requires the checkout pixel extension. Contact support to enable.</Text>
        </BlockStack>
      </Card>
    );
  }

  const steps = [
    { label: 'Started checkout', count: Number(row.started) },
    { label: 'Contact info entered', count: Number(row.contact) },
    { label: 'Address entered', count: Number(row.address) },
    { label: 'Shipping selected', count: Number(row.shipping) },
    { label: 'Payment entered', count: Number(row.payment) },
    { label: 'Completed', count: Number(row.completed) },
  ];

  const started = steps[0].count;

  // Find the step with the largest absolute drop
  let maxDrop = 0;
  let maxDropIdx = -1;
  for (let i = 1; i < steps.length; i++) {
    const drop = steps[i - 1].count - steps[i].count;
    if (drop > maxDrop) { maxDrop = drop; maxDropIdx = i; }
  }

  return (
    <Card>
      <BlockStack gap="300">
        <div>
          <Text variant="headingSm" as="h2">Checkout step funnel</Text>
          <Text variant="bodySm" tone="subdued" as="p">Where customers drop off inside checkout</Text>
        </div>
        <BlockStack gap="200">
          {steps.map((step, i) => {
            const pct       = started > 0 ? Math.round((step.count / started) * 100 * 10) / 10 : 0;
            const drop      = i > 0 ? steps[i - 1].count - step.count : 0;
            const isMaxDrop = i === maxDropIdx;
            const barWidth  = started > 0 ? (step.count / started) * 100 : 0;

            return (
              <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 170, fontSize: 13, color: '#374151', flexShrink: 0 }}>{step.label}</div>
                <div style={{ flex: 1, height: 22, background: '#F3F4F6', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ width: `${barWidth}%`, height: '100%', background: '#202223', borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: 13, color: '#374151', width: 60, textAlign: 'right', flexShrink: 0 }}>
                  {step.count.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: '#6B7280', width: 50, flexShrink: 0 }}>
                  ({pct}%)
                </div>
                <div style={{ fontSize: 12, width: 120, flexShrink: 0, color: isMaxDrop ? '#D72C0D' : '#9CA3AF' }}>
                  {i > 0 && drop > 0 ? `— ${drop.toLocaleString()} dropped${isMaxDrop ? ' 🔴' : ''}` : ''}
                </div>
              </div>
            );
          })}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

// ── Section 3: Last Activity in Abandoned Sessions ─────────────────

function AbandonedLastEventSection({ data }: { data: LastEventRow[] }) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text variant="headingSm" as="h2">Last activity in abandoned sessions</Text>
          <Text as="p" tone="subdued">No abandoned sessions in this period.</Text>
        </BlockStack>
      </Card>
    );
  }

  const total = data.reduce((sum, r) => sum + Number(r.session_count), 0);
  const chartData = data
    .map(r => ({
      label: LAST_EVENT_LABELS[r.last_event] ?? r.last_event,
      count: Number(r.session_count),
      pct: total > 0 ? Math.round((Number(r.session_count) / total) * 100 * 10) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const chartHeight = Math.max(220, chartData.length * 38);

  return (
    <Card>
      <BlockStack gap="300">
        <div>
          <Text variant="headingSm" as="h2">Last activity in abandoned sessions</Text>
          <Text variant="bodySm" tone="subdued" as="p">{total.toLocaleString()} sessions with cart activity that never started checkout</Text>
        </div>
        <div style={{ height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 80, left: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis type="category" dataKey="label" tick={{ fontSize: 12, fill: '#374151' }} width={200} />
              <Tooltip
                formatter={(value, _name, props) => [`${value} sessions (${props.payload.pct}%)`, '']}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="count" fill="#202223" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </BlockStack>
    </Card>
  );
}

// ── Section 4: Checkout Timing ────────────────────────────────────

function CheckoutTimingSection({
  checkoutTiming,
  timeDistribution,
}: {
  checkoutTiming: TimingRow[];
  timeDistribution: { bucket: string; sessions: number }[];
}) {
  const completedData = BUCKET_ORDER.map(b => ({
    bucket: BUCKET_LABELS[b] ?? b,
    count: checkoutTiming
      .filter(r => r.type === 'completed' && r.bucket === b)
      .reduce((s, r) => s + Number(r.count), 0),
  }));

  const abandonedData = BUCKET_ORDER.map(b => ({
    bucket: BUCKET_LABELS[b] ?? b,
    count: checkoutTiming
      .filter(r => r.type === 'abandoned' && r.bucket === b)
      .reduce((s, r) => s + Number(r.count), 0),
  }));

  const hasTimingData    = checkoutTiming.length > 0 && (completedData.some(d => d.count > 0) || abandonedData.some(d => d.count > 0));
  const hasDistribution  = timeDistribution.some(b => b.sessions > 0);

  if (!hasTimingData && !hasDistribution) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text variant="headingSm" as="h2">Checkout timing</Text>
          <Text as="p" tone="subdued">No checkout timing data available.</Text>
        </BlockStack>
      </Card>
    );
  }

  return (
    <Card>
      <BlockStack gap="400">
        <Text variant="headingSm" as="h2">Checkout timing</Text>

        {hasTimingData && (
          <InlineGrid columns={2} gap="400">
            <BlockStack gap="200">
              <div>
                <Text variant="bodySm" as="p" fontWeight="semibold">Time to complete checkout</Text>
                <Text variant="bodySm" tone="subdued" as="p">Sessions that completed</Text>
              </div>
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={completedData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#6B7280' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} width={28} />
                    <Tooltip formatter={(v) => [`${v} sessions`, '']} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="count" fill="#202223" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </BlockStack>

            <BlockStack gap="200">
              <div>
                <Text variant="bodySm" as="p" fontWeight="semibold">Time in checkout before leaving</Text>
                <Text variant="bodySm" tone="subdued" as="p">Sessions that abandoned</Text>
              </div>
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={abandonedData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#6B7280' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} width={28} />
                    <Tooltip formatter={(v) => [`${v} sessions`, '']} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="count" fill="#202223" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </BlockStack>
          </InlineGrid>
        )}

        {hasDistribution && (
          <BlockStack gap="200">
            <div>
              <Text variant="bodySm" as="p" fontWeight="semibold">How long before checking out</Text>
              <Text variant="bodySm" tone="subdued" as="p">Time from first add-to-cart to checkout click, for sessions that reached checkout</Text>
            </div>
            <div style={{ height: 180 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeDistribution} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#6B7280' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} width={32} />
                  <Tooltip formatter={(v) => [`${v} sessions`, '']} contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="sessions" fill="#202223" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </BlockStack>
        )}
      </BlockStack>
    </Card>
  );
}

// ── Section 5: Converters vs Non-Converters ────────────────────────

function ConverterComparisonSection({ data }: { data: ConverterRow[] }) {
  const totalSessions = (data ?? []).reduce((s, r) => s + Number(r.session_count), 0);

  if (!data || data.length < 2 || totalSessions < 5) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text variant="headingSm" as="h2">Converters vs. non-converters</Text>
          <Text as="p" tone="subdued">Not enough sessions to compare.</Text>
        </BlockStack>
      </Card>
    );
  }

  // Supabase returns booleans, but handle string 'true'/'false' just in case
  const isTrue = (v: boolean | string) => v === true || v === 'true';
  const conv    = data.find(r => isTrue(r.converted as boolean | string));
  const nonConv = data.find(r => !isTrue(r.converted as boolean | string));

  if (!conv || !nonConv) {
    return (
      <Card>
        <BlockStack gap="200">
          <Text variant="headingSm" as="h2">Converters vs. non-converters</Text>
          <Text as="p" tone="subdued">Not enough data to compare groups.</Text>
        </BlockStack>
      </Card>
    );
  }

  const rows: { label: string; converter: string; nonConverter: string }[] = [
    { label: 'Sessions',                  converter: Number(conv.session_count).toLocaleString(),                nonConverter: Number(nonConv.session_count).toLocaleString() },
    { label: 'Avg time in cart',          converter: fmtSeconds(Number(conv.avg_time_seconds)),                  nonConverter: fmtSeconds(Number(nonConv.avg_time_seconds)) },
    { label: 'Avg items in cart',         converter: Number(conv.avg_items).toFixed(1),                          nonConverter: Number(nonConv.avg_items).toFixed(1) },
    { label: 'Avg cart value',            converter: `$${Math.round(Number(conv.avg_cart_value_dollars)).toLocaleString()}`,  nonConverter: `$${Math.round(Number(nonConv.avg_cart_value_dollars)).toLocaleString()}` },
    { label: 'Used a coupon',             converter: `${conv.coupon_usage_pct}%`,                                nonConverter: `${nonConv.coupon_usage_pct}%` },
    { label: 'Coupon failed',             converter: `${conv.coupon_failed_pct}%`,                               nonConverter: `${nonConv.coupon_failed_pct}%` },
    { label: 'Had item removed',          converter: `${conv.removal_pct}%`,                                     nonConverter: `${nonConv.removal_pct}%` },
    { label: 'From UTM-tagged traffic',   converter: `${conv.paid_traffic_pct}%`,                                nonConverter: `${nonConv.paid_traffic_pct}%` },
    { label: 'On mobile',                 converter: `${conv.mobile_pct}%`,                                      nonConverter: `${nonConv.mobile_pct}%` },
  ];

  return (
    <Card>
      <BlockStack gap="300">
        <div>
          <Text variant="headingSm" as="h2">Converters vs. non-converters</Text>
          <Text variant="bodySm" tone="subdued" as="p">Sessions that started checkout vs. those that added to cart but never did</Text>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E5E7EB' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left',  fontSize: 12, fontWeight: 500, color: '#6B7280', width: '40%' }}></th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#202223' }}>Started checkout</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#202223' }}>Didn't start</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.label} style={{ borderBottom: '1px solid #F3F4F6' }}>
                  <td style={{ padding: '8px 12px', color: '#6B7280' }}>{row.label}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500, color: '#202223' }}>{row.converter}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: '#374151' }}>{row.nonConverter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </BlockStack>
    </Card>
  );
}

// ── Page ──────────────────────────────────────────────────────────

export default function CartPage() {
  const shop = useShop();
  const [dateRange, setDateRange] = useState<DateRange>(() => getDefaultRange());

  const params = shop
    ? `?shop=${shop}&start=${dateRange.start.toISOString()}&end=${dateRange.end.toISOString()}`
    : null;

  const { data, isLoading } = useSWR<CartData>(
    params ? `/api/couponmaxx/cart${params}` : null,
    fetcher,
  );

  return (
    <BlockStack gap="400">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Text variant="headingLg" as="h1">Cart &amp; Checkout</Text>
          <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0' }}>
            What happens between add-to-cart and purchase
          </p>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} defaultDays={7} />
      </div>

      <LoadingBar loading={isLoading} />

      {data && (
        <BlockStack gap="400">
          <FunnelSection
            funnelToday={data.funnelToday ?? []}
            funnelBySource={data.funnelBySource ?? []}
          />
          <CheckoutStepsSection data={data.checkoutSteps ?? []} />
          <AbandonedLastEventSection data={data.lastEvents ?? []} />
          <CheckoutTimingSection
            checkoutTiming={data.checkoutTiming ?? []}
            timeDistribution={data.timeDistribution ?? []}
          />
          <ConverterComparisonSection data={data.converterComparison ?? []} />
        </BlockStack>
      )}
    </BlockStack>
  );
}
