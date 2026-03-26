'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Badge, BlockStack, InlineGrid, Text } from '@shopify/polaris';
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
function getDefaultRange(): DateRange { return { start: subDays(new Date(), 7), end: new Date() }; }
const fetcher = (url: string) => fetch(url).then(r => r.json());

function fmtSeconds(s: number) {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m === 0 ? `${sec}s` : `${m}m ${sec}s`;
}

function r1(n: number) { return Math.round(n * 10) / 10; }

const BUCKET_ORDER = ['under_1_min', '1_3_min', '3_5_min', '5_10_min', '10_plus_min'];
const BUCKET_LABELS: Record<string, string> = {
  under_1_min: '< 1 min', '1_3_min': '1–3 min', '3_5_min': '3–5 min',
  '5_10_min': '5–10 min', '10_plus_min': '10+ min',
};
const BUCKET_MIDPOINTS: Record<string, number> = {
  under_1_min: 30, '1_3_min': 120, '3_5_min': 240, '5_10_min': 450, '10_plus_min': 900,
};

const LAST_EVENT_LABELS: Record<string, string> = {
  cart_item_added:       'Added item to cart',
  cart_item_removed:     'Removed item from cart',
  cart_item_changed:     'Changed quantity',
  cart_coupon_failed:    'Coupon attempt (failed)',
  cart_coupon_applied:   'Coupon applied',
  cart_bulk_updated:     'Multiple items updated',
  cart_atc_clicked:      'Add to cart button clicked',
  returned_from_checkout:'Started checkout, returned',
  no_active_events:      'No cart interaction',
};

const RED_EVENTS = new Set(['cart_coupon_failed', 'returned_from_checkout']);

function estimateMedian(rows: TimingRow[], type: 'completed' | 'abandoned'): string {
  const filtered = rows.filter(r => r.type === type);
  const total = filtered.reduce((s, r) => s + Number(r.count), 0);
  if (!total) return '—';
  const target = total / 2;
  let cumulative = 0;
  for (const b of BUCKET_ORDER) {
    const row = filtered.find(r => r.bucket === b);
    cumulative += row ? Number(row.count) : 0;
    if (cumulative >= target) return fmtSeconds(BUCKET_MIDPOINTS[b] ?? 0);
  }
  return '—';
}

// ── Shared card wrapper ────────────────────────────────────────────

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E1E3E5', borderRadius: 8, padding: 20 }}>
      {children}
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#202223' }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, color: '#6D7175', marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

// ── Section 1: Headline metric ─────────────────────────────────────

function HeadlineSection({ funnelToday }: { funnelToday: FunnelRow[] }) {
  const today = funnelToday.find(r => r.period === 'today');
  const avg   = funnelToday.find(r => r.period === 'avg_7d');

  const atc   = Number(today?.added_to_cart   ?? 0);
  const start = Number(today?.started_checkout ?? 0);
  const done  = Number(today?.completed_checkout ?? 0);

  const todayRate = atc > 0 ? r1((start / atc) * 100) : null;
  const avgAtc    = Number(avg?.added_to_cart   ?? 0);
  const avgStart  = Number(avg?.started_checkout ?? 0);
  const avgRate   = avgAtc > 0 ? r1((avgStart / avgAtc) * 100) : null;
  const ppDiff    = todayRate !== null && avgRate !== null ? r1(todayRate - avgRate) : null;
  const isBad     = ppDiff !== null && ppDiff < -5;

  if (!today && !avg) {
    return (
      <SectionCard>
        <div style={{ fontSize: 14, color: '#6D7175' }}>No cart activity recorded for today.</div>
      </SectionCard>
    );
  }

  return (
    <SectionCard>
      <div style={{ fontSize: 14, color: '#6D7175', marginBottom: 8 }}>Cart-to-checkout rate today</div>
      <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.1, color: isBad ? '#D72C0D' : '#202223' }}>
        {todayRate !== null ? `${todayRate}%` : '—'}
      </div>
      <div style={{ fontSize: 14, color: '#6D7175', marginTop: 10 }}>
        7-day average: {avgRate !== null ? `${avgRate}%` : '—'}
        {ppDiff !== null && (
          <span style={{ marginLeft: 8, color: isBad ? '#D72C0D' : '#6D7175' }}>
            · {ppDiff > 0 ? '▲' : '▼'} {Math.abs(ppDiff)}pp
          </span>
        )}
      </div>
      <div style={{ fontSize: 13, color: '#6D7175', marginTop: 6 }}>
        {atc.toLocaleString()} added to cart &nbsp;→&nbsp; {start.toLocaleString()} started checkout &nbsp;→&nbsp; {done.toLocaleString()} completed
      </div>
    </SectionCard>
  );
}

// ── Section 2: Funnel detail ───────────────────────────────────────

function FunnelSection({ funnelToday, funnelBySource }: { funnelToday: FunnelRow[]; funnelBySource: SourceRow[] }) {
  const today = funnelToday.find(r => r.period === 'today');
  const avg   = funnelToday.find(r => r.period === 'avg_7d');

  if (!today && !avg) return null;

  const hasSessionData = (today?.sessions ?? 0) > 0 || (avg?.sessions ?? 0) > 0;

  type Step = { label: string; today: number; avg: number };
  const steps: Step[] = [];
  if (hasSessionData) steps.push({ label: 'Sessions', today: Number(today?.sessions ?? 0), avg: Number(avg?.sessions ?? 0) });
  steps.push({ label: 'Added to cart',      today: Number(today?.added_to_cart      ?? 0), avg: Number(avg?.added_to_cart      ?? 0) });
  steps.push({ label: 'Started checkout',   today: Number(today?.started_checkout   ?? 0), avg: Number(avg?.started_checkout   ?? 0) });
  steps.push({ label: 'Completed checkout', today: Number(today?.completed_checkout ?? 0), avg: Number(avg?.completed_checkout ?? 0) });

  const rates = steps.slice(1).map((step, i) => {
    const tRate = steps[i].today > 0 ? r1((step.today / steps[i].today) * 100) : null;
    const aRate = steps[i].avg   > 0 ? r1((step.avg   / steps[i].avg)   * 100) : null;
    const ppDiff = tRate !== null && aRate !== null ? r1(tRate - aRate) : null;
    return { tRate, aRate, ppDiff };
  });

  // Find the index with the biggest negative pp drop
  let worstIdx = -1;
  let worstDrop = 0;
  rates.forEach((r, i) => {
    if (r.ppDiff !== null && r.ppDiff < worstDrop) { worstDrop = r.ppDiff; worstIdx = i; }
  });

  const problemSources = (funnelBySource ?? []).filter(s => {
    const tRate = s.today_atc > 0 ? (s.today_checkout / s.today_atc) * 100 : 0;
    const aRate = s.avg_atc   > 0 ? (s.avg_checkout   / s.avg_atc)   * 100 : 0;
    return (aRate - tRate) > 10;
  });

  return (
    <SectionCard>
      <SectionTitle title="Today vs. 7-day average" subtitle="Funnel performance today compared to recent baseline" />

      {/* Funnel columns */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, overflowX: 'auto' }}>
        {steps.map((step, i) => {
          const pct = step.avg > 0 ? r1(((step.today - step.avg) / step.avg) * 100) : null;
          const isDown = pct !== null && pct < 0;

          return (
            <div key={step.label} style={{ display: 'flex', alignItems: 'flex-start' }}>
              {/* Step */}
              <div style={{ minWidth: 140, padding: '0 4px' }}>
                <div style={{ fontSize: 12, color: '#6D7175', marginBottom: 4 }}>{step.label}</div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#202223', lineHeight: 1.1 }}>
                  {step.today.toLocaleString()}
                </div>
                <div style={{ fontSize: 13, color: '#6D7175', marginTop: 3 }}>7d avg: {step.avg.toLocaleString()}</div>
                {pct !== null && (
                  <div style={{ fontSize: 13, marginTop: 2, color: pct < -20 ? '#D72C0D' : '#6D7175' }}>
                    {pct > 0 ? '▲' : '▼'} {Math.abs(pct)}%
                  </div>
                )}
              </div>

              {/* Rate connector */}
              {i < steps.length - 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 12px', minWidth: 88 }}>
                  <div style={{ fontSize: 11, color: '#6D7175', marginBottom: 2 }}>→</div>
                  <div style={{
                    fontSize: 20, fontWeight: 700,
                    color: rates[i].ppDiff !== null && rates[i].ppDiff! < -5 ? '#D72C0D' : '#202223',
                  }}>
                    {rates[i].tRate !== null ? `${rates[i].tRate}%` : '—'}
                  </div>
                  <div style={{ fontSize: 13, color: '#6D7175' }}>
                    avg {rates[i].aRate !== null ? `${rates[i].aRate}%` : '—'}
                  </div>
                  {rates[i].ppDiff !== null && (
                    <div style={{
                      fontSize: 13, fontWeight: 500, marginTop: 2,
                      color: rates[i].ppDiff! < -5 ? '#D72C0D' : rates[i].ppDiff! > 0 ? '#202223' : '#6D7175',
                    }}>
                      {rates[i].ppDiff! > 0 ? '▲' : '▼'} {Math.abs(rates[i].ppDiff!)}pp
                    </div>
                  )}
                  {i === worstIdx && worstDrop < -5 && (
                    <div style={{ marginTop: 4 }}>
                      <Badge tone="critical">Biggest drop</Badge>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Source breakdown — only if problems */}
      {problemSources.length > 0 && (
        <div style={{ marginTop: 20, borderTop: '1px solid #E1E3E5', paddingTop: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#202223', marginBottom: 10 }}>
            Sources with significant checkout rate drop today
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #E1E3E5' }}>
                {['Source / Medium', 'Rate today', '7d avg', 'Change'].map((h, j) => (
                  <th key={h} style={{ padding: '6px 12px', textAlign: j === 0 ? 'left' : 'right', fontSize: 12, fontWeight: 500, color: '#6D7175' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {problemSources.slice(0, 5).map(s => {
                const tRate = s.today_atc > 0 ? r1((s.today_checkout / s.today_atc) * 100) : 0;
                const aRate = s.avg_atc   > 0 ? r1((s.avg_checkout   / s.avg_atc)   * 100) : 0;
                const diff  = r1(tRate - aRate);
                return (
                  <tr key={`${s.source}-${s.medium}`} style={{ background: '#FFF4F4', borderBottom: '1px solid #E1E3E5' }}>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ color: '#202223' }}>{s.source}</span>
                      {s.medium && <span style={{ fontSize: 11, color: '#6D7175', marginLeft: 6 }}>{s.medium}</span>}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>{tRate}%</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#6D7175' }}>{aRate}%</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#D72C0D', fontWeight: 600 }}>{diff}pp</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

// ── Section 3a: Checkout Step Funnel ──────────────────────────────

function CheckoutStepsSection({ data }: { data: CheckoutStepRow[] }) {
  const row = data?.[0];
  if (!row || Number(row.started) === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #E1E3E5', borderRadius: 8, padding: 20, height: '100%' }}>
        <SectionTitle title="Checkout step funnel" />
        <div style={{ fontSize: 13, color: '#6D7175' }}>Checkout step data requires the checkout pixel. Contact support to enable.</div>
      </div>
    );
  }

  const steps = [
    { label: 'Started checkout',   count: Number(row.started)  },
    { label: 'Contact info',       count: Number(row.contact)  },
    { label: 'Address entered',    count: Number(row.address)  },
    { label: 'Shipping selected',  count: Number(row.shipping) },
    { label: 'Payment entered',    count: Number(row.payment)  },
    { label: 'Completed',          count: Number(row.completed)},
  ];
  const started = steps[0].count;

  let maxDrop = 0, maxDropIdx = -1;
  for (let i = 1; i < steps.length; i++) {
    const drop = steps[i - 1].count - steps[i].count;
    if (drop > maxDrop) { maxDrop = drop; maxDropIdx = i; }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #E1E3E5', borderRadius: 8, padding: 20, height: '100%', boxSizing: 'border-box' }}>
      <SectionTitle title="Checkout step funnel" subtitle="Where customers drop off inside checkout" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map((step, i) => {
          const pct       = started > 0 ? r1((step.count / started) * 100) : 0;
          const drop      = i > 0 ? steps[i - 1].count - step.count : 0;
          const isWorst   = i === maxDropIdx;
          const barWidth  = started > 0 ? (step.count / started) * 100 : 0;

          return (
            <div key={step.label}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <div style={{ fontSize: 12, color: '#6D7175', width: 140, flexShrink: 0 }}>{step.label}</div>
                <div style={{ flex: 1, height: 18, background: '#F6F6F7', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${barWidth}%`, height: '100%', background: '#202223', borderRadius: 3 }} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#202223', width: 48, textAlign: 'right', flexShrink: 0 }}>
                  {step.count.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: '#6D7175', width: 38, flexShrink: 0 }}>
                  ({pct}%)
                </div>
                <div style={{ fontSize: 12, width: 90, flexShrink: 0, color: isWorst ? '#D72C0D' : '#6D7175', fontWeight: isWorst ? 600 : 400 }}>
                  {i > 0 && drop > 0 ? `−${drop.toLocaleString()} dropped` : ''}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section 3b: Last Activity in Abandoned Sessions ────────────────

function AbandonedLastEventSection({ data }: { data: LastEventRow[] }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ background: '#fff', border: '1px solid #E1E3E5', borderRadius: 8, padding: 20, height: '100%' }}>
        <SectionTitle title="Last activity before abandoning" />
        <div style={{ fontSize: 13, color: '#6D7175' }}>No abandoned sessions in this period.</div>
      </div>
    );
  }

  const total = data.reduce((s, r) => s + Number(r.session_count), 0);
  const rows = [...data]
    .sort((a, b) => Number(b.session_count) - Number(a.session_count))
    .map(r => ({
      label: LAST_EVENT_LABELS[r.last_event] ?? r.last_event,
      count: Number(r.session_count),
      pct: total > 0 ? r1((Number(r.session_count) / total) * 100) : 0,
      isRed: RED_EVENTS.has(r.last_event),
    }));

  return (
    <div style={{ background: '#fff', border: '1px solid #E1E3E5', borderRadius: 8, padding: 20, height: '100%', boxSizing: 'border-box' }}>
      <SectionTitle
        title="Last activity before abandoning"
        subtitle={`${total.toLocaleString()} sessions that never started checkout`}
      />
      <div>
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '8px 0',
              borderBottom: i < rows.length - 1 ? '1px solid #E1E3E5' : 'none',
            }}
          >
            <div style={{ fontSize: 14, color: '#202223' }}>{row.label}</div>
            <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: row.isRed ? '#D72C0D' : '#202223', textAlign: 'right', minWidth: 36 }}>
                {row.count.toLocaleString()}
              </div>
              <div style={{ fontSize: 13, color: '#6D7175', textAlign: 'right', minWidth: 48 }}>
                ({row.pct}%)
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
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
    count: checkoutTiming.filter(r => r.type === 'completed' && r.bucket === b).reduce((s, r) => s + Number(r.count), 0),
  }));
  const abandonedData = BUCKET_ORDER.map(b => ({
    bucket: BUCKET_LABELS[b] ?? b,
    count: checkoutTiming.filter(r => r.type === 'abandoned' && r.bucket === b).reduce((s, r) => s + Number(r.count), 0),
  }));

  const hasTimingData   = completedData.some(d => d.count > 0) || abandonedData.some(d => d.count > 0);
  const hasDistribution = timeDistribution.some(b => b.sessions > 0);

  if (!hasTimingData && !hasDistribution) {
    return (
      <SectionCard>
        <SectionTitle title="Checkout timing" />
        <div style={{ fontSize: 13, color: '#6D7175' }}>No checkout timing data available.</div>
      </SectionCard>
    );
  }

  const completedMedian = estimateMedian(checkoutTiming, 'completed');
  const abandonedMedian = estimateMedian(checkoutTiming, 'abandoned');

  return (
    <SectionCard>
      <SectionTitle title="Checkout timing" />

      {hasTimingData && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: hasDistribution ? 24 : 0 }}>
          {/* Completed */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#202223', marginBottom: 2 }}>Time to complete checkout</div>
            <div style={{ fontSize: 13, color: '#6D7175', marginBottom: 10 }}>Sessions that completed</div>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={completedData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#6D7175' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6D7175' }} width={28} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => [`${v} sessions`, '']} contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" fill="#202223" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 13, color: '#6D7175', marginTop: 6 }}>Median: <strong style={{ color: '#202223' }}>{completedMedian}</strong></div>
          </div>

          {/* Abandoned */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#202223', marginBottom: 2 }}>Time in checkout before leaving</div>
            <div style={{ fontSize: 13, color: '#6D7175', marginBottom: 10 }}>Sessions that abandoned</div>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={abandonedData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: '#6D7175' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#6D7175' }} width={28} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v) => [`${v} sessions`, '']} contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="count" fill="#D72C0D" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ fontSize: 13, color: '#6D7175', marginTop: 6 }}>Median: <strong style={{ color: '#202223' }}>{abandonedMedian}</strong></div>
          </div>
        </div>
      )}

      {hasDistribution && (
        <div style={{ borderTop: hasTimingData ? '1px solid #E1E3E5' : 'none', paddingTop: hasTimingData ? 20 : 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#202223', marginBottom: 2 }}>Time from add-to-cart to checkout click</div>
          <div style={{ fontSize: 13, color: '#6D7175', marginBottom: 10 }}>Sessions that reached checkout, by time spent in cart first</div>
          <div style={{ height: 160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={timeDistribution} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: '#6D7175' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6D7175' }} width={32} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => [`${v} sessions`, '']} contentStyle={{ fontSize: 12 }} />
                <Bar dataKey="sessions" fill="#202223" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ── Section 5: Converters vs Non-Converters ────────────────────────

function ConverterComparisonSection({ data }: { data: ConverterRow[] }) {
  const totalSessions = (data ?? []).reduce((s, r) => s + Number(r.session_count), 0);
  if (!data || data.length < 2 || totalSessions < 5) {
    return (
      <SectionCard>
        <SectionTitle title="Converters vs. non-converters" />
        <div style={{ fontSize: 13, color: '#6D7175' }}>Not enough sessions to compare.</div>
      </SectionCard>
    );
  }

  const isTrue = (v: boolean | string) => v === true || v === 'true';
  const conv    = data.find(r => isTrue(r.converted as boolean | string));
  const nonConv = data.find(r => !isTrue(r.converted as boolean | string));

  if (!conv || !nonConv) {
    return (
      <SectionCard>
        <SectionTitle title="Converters vs. non-converters" />
        <div style={{ fontSize: 13, color: '#6D7175' }}>Not enough data to compare groups.</div>
      </SectionCard>
    );
  }

  // Difference styling
  function diffColor(absDiff: number, threshold: number): string {
    if (absDiff > threshold) return '#D72C0D';
    if (absDiff < threshold * 0.3) return '#6D7175';
    return '#202223';
  }
  function diffWeight(absDiff: number, threshold: number): number | string {
    return absDiff > threshold ? 700 : 400;
  }

  type Row = { label: string; cVal: string; ncVal: string; diffStr: string; absDiff: number; threshold: number };

  const ppDiff = (a: number, b: number) => r1(a - b);
  const rows: Row[] = [
    {
      label: 'Sessions',
      cVal: Number(conv.session_count).toLocaleString(),
      ncVal: Number(nonConv.session_count).toLocaleString(),
      diffStr: '—',
      absDiff: 0,
      threshold: Infinity,
    },
    {
      label: 'Median time in cart',
      cVal: fmtSeconds(Number(conv.avg_time_seconds)),
      ncVal: fmtSeconds(Number(nonConv.avg_time_seconds)),
      diffStr: (() => {
        const d = Number(conv.avg_time_seconds) - Number(nonConv.avg_time_seconds);
        if (d === 0 || (!conv.avg_time_seconds && !nonConv.avg_time_seconds)) return '—';
        return (d > 0 ? '+' : '') + fmtSeconds(Math.abs(d));
      })(),
      absDiff: Math.abs(Number(conv.avg_time_seconds) - Number(nonConv.avg_time_seconds)),
      threshold: 120, // 2 min difference is significant
    },
    {
      label: 'Avg items in cart',
      cVal: Number(conv.avg_items).toFixed(1),
      ncVal: Number(nonConv.avg_items).toFixed(1),
      diffStr: (() => { const d = r1(Number(conv.avg_items) - Number(nonConv.avg_items)); return (d > 0 ? '+' : '') + d; })(),
      absDiff: Math.abs(r1(Number(conv.avg_items) - Number(nonConv.avg_items))),
      threshold: 1,
    },
    {
      label: 'Avg cart value',
      cVal: `$${Math.round(Number(conv.avg_cart_value_dollars)).toLocaleString()}`,
      ncVal: `$${Math.round(Number(nonConv.avg_cart_value_dollars)).toLocaleString()}`,
      diffStr: (() => { const d = Math.round(Number(conv.avg_cart_value_dollars) - Number(nonConv.avg_cart_value_dollars)); return (d > 0 ? '+' : '') + `$${Math.abs(d).toLocaleString()}`; })(),
      absDiff: Math.abs(Number(conv.avg_cart_value_dollars) - Number(nonConv.avg_cart_value_dollars)),
      threshold: 30,
    },
    {
      label: 'Used a coupon',
      cVal: `${conv.coupon_usage_pct}%`,
      ncVal: `${nonConv.coupon_usage_pct}%`,
      diffStr: (() => { const d = ppDiff(Number(conv.coupon_usage_pct), Number(nonConv.coupon_usage_pct)); return (d > 0 ? '+' : '') + d + 'pp'; })(),
      absDiff: Math.abs(ppDiff(Number(conv.coupon_usage_pct), Number(nonConv.coupon_usage_pct))),
      threshold: 10,
    },
    {
      label: 'Coupon failed',
      cVal: `${conv.coupon_failed_pct}%`,
      ncVal: `${nonConv.coupon_failed_pct}%`,
      diffStr: (() => { const d = ppDiff(Number(conv.coupon_failed_pct), Number(nonConv.coupon_failed_pct)); return (d > 0 ? '+' : '') + d + 'pp'; })(),
      absDiff: Math.abs(ppDiff(Number(conv.coupon_failed_pct), Number(nonConv.coupon_failed_pct))),
      threshold: 10,
    },
    {
      label: 'Had item removed',
      cVal: `${conv.removal_pct}%`,
      ncVal: `${nonConv.removal_pct}%`,
      diffStr: (() => { const d = ppDiff(Number(conv.removal_pct), Number(nonConv.removal_pct)); return (d > 0 ? '+' : '') + d + 'pp'; })(),
      absDiff: Math.abs(ppDiff(Number(conv.removal_pct), Number(nonConv.removal_pct))),
      threshold: 10,
    },
    {
      label: 'From UTM-tagged traffic',
      cVal: `${conv.paid_traffic_pct}%`,
      ncVal: `${nonConv.paid_traffic_pct}%`,
      diffStr: (() => { const d = ppDiff(Number(conv.paid_traffic_pct), Number(nonConv.paid_traffic_pct)); return (d > 0 ? '+' : '') + d + 'pp'; })(),
      absDiff: Math.abs(ppDiff(Number(conv.paid_traffic_pct), Number(nonConv.paid_traffic_pct))),
      threshold: 10,
    },
    {
      label: 'On mobile',
      cVal: `${conv.mobile_pct}%`,
      ncVal: `${nonConv.mobile_pct}%`,
      diffStr: (() => { const d = ppDiff(Number(conv.mobile_pct), Number(nonConv.mobile_pct)); return (d > 0 ? '+' : '') + d + 'pp'; })(),
      absDiff: Math.abs(ppDiff(Number(conv.mobile_pct), Number(nonConv.mobile_pct))),
      threshold: 10,
    },
  ];

  return (
    <SectionCard>
      <SectionTitle
        title="Converters vs. non-converters"
        subtitle="Sessions that started checkout vs. those that added to cart but never did"
      />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #E1E3E5' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left',  fontSize: 12, fontWeight: 500, color: '#6D7175', width: '40%' }}></th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#202223', width: '20%' }}>Started checkout</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#202223', width: '20%' }}>Didn't start</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#202223', width: '20%' }}>Difference</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.label} style={{ borderBottom: '1px solid #E1E3E5' }}>
                <td style={{ padding: '10px 12px', color: '#6D7175' }}>{row.label}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 500, color: '#202223' }}>{row.cVal}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: '#202223' }}>{row.ncVal}</td>
                <td style={{
                  padding: '10px 12px',
                  textAlign: 'right',
                  color: diffColor(row.absDiff, row.threshold),
                  fontWeight: diffWeight(row.absDiff, row.threshold),
                }}>
                  {row.diffStr}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#202223' }}>Cart &amp; Checkout</div>
          <div style={{ fontSize: 13, color: '#6D7175', marginTop: 3 }}>What happens between add-to-cart and purchase</div>
        </div>
        <DateRangePicker value={dateRange} onChange={setDateRange} defaultDays={7} />
      </div>

      <LoadingBar loading={isLoading} />

      {data && (
        <>
          {/* Section 1: Headline */}
          <HeadlineSection funnelToday={data.funnelToday ?? []} />

          {/* Section 2: Funnel detail */}
          <FunnelSection funnelToday={data.funnelToday ?? []} funnelBySource={data.funnelBySource ?? []} />

          {/* Section 3: Two-column detail */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
            <CheckoutStepsSection data={data.checkoutSteps ?? []} />
            <AbandonedLastEventSection data={data.lastEvents ?? []} />
          </div>

          {/* Section 4: Timing */}
          <CheckoutTimingSection
            checkoutTiming={data.checkoutTiming ?? []}
            timeDistribution={data.timeDistribution ?? []}
          />

          {/* Section 5: Comparison */}
          <ConverterComparisonSection data={data.converterComparison ?? []} />
        </>
      )}
    </div>
  );
}
