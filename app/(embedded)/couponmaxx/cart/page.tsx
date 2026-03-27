'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Badge, BlockStack } from '@shopify/polaris';
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
  period: string;            // 'current' | 'prior'
  sessions: number;
  added_to_cart: number;
  started_checkout: number;
  completed_checkout: number;
};

type SourceRow = {
  source: string;
  medium: string | null;
  current_atc: number;
  current_checkout: number;
  prior_atc: number;
  prior_checkout: number;
};

type CheckoutStepRow = {
  started: number;
  contact: number;
  address: number;
  shipping: number;
  payment: number;
  completed: number;
};

type LastEventRow  = { last_event: string; session_count: number };
type TimingRow     = { type: string; bucket: string; count: number };

type ConverterRow = {
  converted: boolean;
  session_count: number;
  avg_time_seconds: number;       // computed as median in RPC
  avg_items: number;
  avg_cart_value_dollars: number;
  coupon_usage_pct: number;
  coupon_failed_pct: number;
  removal_pct: number;
  paid_traffic_pct: number;
  mobile_pct: number;
};

type CartData = {
  funnelData:          FunnelRow[];
  funnelBySource:      SourceRow[];
  checkoutSteps:       CheckoutStepRow[];
  lastEvents:          LastEventRow[];
  checkoutTiming:      TimingRow[];
  converterComparison: ConverterRow[];
};

// ── Helpers ────────────────────────────────────────────────────────

function subDays(d: Date, n: number) { return new Date(d.getTime() - n * 86400000); }
function getDefaultRange(): DateRange { return { start: subDays(new Date(), 7), end: new Date() }; }
const fetcher = (url: string) => fetch(url).then(r => r.json());

function r1(n: number) { return Math.round(n * 10) / 10; }

function fmtSeconds(s: number) {
  if (!s || s <= 0) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m === 0 ? `${sec}s` : `${m}m ${sec}s`;
}

const BUCKET_ORDER = ['under_1_min', '1_3_min', '3_5_min', '5_10_min', '10_plus_min'];
const BUCKET_LABELS: Record<string, string> = {
  under_1_min: '< 1 min', '1_3_min': '1–3 min', '3_5_min': '3–5 min',
  '5_10_min': '5–10 min', '10_plus_min': '10+ min',
};
const BUCKET_MIDPOINTS: Record<string, number> = {
  under_1_min: 30, '1_3_min': 120, '3_5_min': 240, '5_10_min': 450, '10_plus_min': 900,
};

const EVENT_LABELS: Record<string, string> = {
  cart_item_added:       'Added an item',
  cart_item_removed:     'Removed an item',
  cart_item_changed:     'Changed quantity',
  cart_coupon_failed:    'Coupon failed',
  cart_coupon_applied:   'Applied coupon',
  cart_bulk_updated:     'Updated cart',
  cart_atc_clicked:      'Clicked add to cart',
  returned_from_checkout:'Returned from checkout',
  browsed_cart_only:     'Browsed cart only',
};

const RED_LAST_EVENTS = new Set(['cart_coupon_failed', 'returned_from_checkout']);

function estimateMedian(rows: TimingRow[], type: 'completed' | 'abandoned'): string {
  const filtered = rows.filter(r => r.type === type);
  const total    = filtered.reduce((s, r) => s + Number(r.count), 0);
  if (!total) return '—';
  let cumulative = 0;
  for (const b of BUCKET_ORDER) {
    cumulative += Number(filtered.find(r => r.bucket === b)?.count ?? 0);
    if (cumulative >= total / 2) return fmtSeconds(BUCKET_MIDPOINTS[b] ?? 0);
  }
  return '—';
}

// ── Shared wrappers ────────────────────────────────────────────────

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #E1E3E5', borderRadius: 8, padding: 20, ...style }}>
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

// ── Section 1: Proportional funnel ────────────────────────────────

function FunnelSection({ funnelData, funnelBySource }: { funnelData: FunnelRow[]; funnelBySource: SourceRow[] }) {
  const cur  = funnelData.find(r => r.period === 'current');
  const prior = funnelData.find(r => r.period === 'prior');

  const atc   = Number(cur?.added_to_cart      ?? 0);
  const start = Number(cur?.started_checkout   ?? 0);
  const done  = Number(cur?.completed_checkout ?? 0);

  if (atc === 0) {
    return <Card><div style={{ fontSize: 13, color: '#6D7175' }}>No cart activity in this period.</div></Card>;
  }

  const pAtc   = Number(prior?.added_to_cart      ?? 0);
  const pStart = Number(prior?.started_checkout   ?? 0);
  const pDone  = Number(prior?.completed_checkout ?? 0);

  // [ATC → checkout] and [checkout → completed] rates
  const rates = [
    {
      curRate:  atc   > 0 ? r1((start / atc)   * 100) : null,
      priorRate: pAtc  > 0 ? r1((pStart / pAtc) * 100) : null,
    },
    {
      curRate:  start > 0 ? r1((done  / start) * 100) : null,
      priorRate: pStart > 0 ? r1((pDone / pStart) * 100) : null,
    },
  ];

  const steps = [
    { label: 'Added to cart',      count: atc   },
    { label: 'Started checkout',   count: start },
    { label: 'Completed checkout', count: done  },
  ];

  // Problem sources: checkout rate dropped >10pp vs prior
  const problemSources = (funnelBySource ?? []).filter(s => {
    const curRate  = s.current_atc > 0 ? (s.current_checkout / s.current_atc) * 100 : 0;
    const priorRate = s.prior_atc  > 0 ? (s.prior_checkout   / s.prior_atc)   * 100 : 0;
    return (priorRate - curRate) > 10;
  });

  return (
    <Card>
      <SectionTitle title="Checkout funnel" />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {steps.map((step, i) => {
          const barPct = atc > 0 ? (step.count / atc) * 100 : 0;
          const rate   = rates[i];           // rate FROM this step to next (undefined for last)
          const isBad  = rate && rate.curRate !== null && rate.priorRate !== null
            && r1(rate.curRate - rate.priorRate) < -5;

          return (
            <div key={step.label}>
              {/* Bar row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 155, fontSize: 13, color: '#6D7175', flexShrink: 0 }}>{step.label}</div>
                <div style={{ flex: 1, height: 28, background: '#F6F6F7', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${barPct}%`, height: '100%', background: '#202223', borderRadius: 3, minWidth: step.count > 0 ? 4 : 0 }} />
                </div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#202223', width: 64, textAlign: 'right', flexShrink: 0 }}>
                  {step.count.toLocaleString()}
                </div>
              </div>

              {/* Conversion rate connector (between this bar and next) */}
              {i < steps.length - 1 && rate && (
                <div style={{ paddingLeft: 167, margin: '5px 0 10px', fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: isBad ? '#D72C0D' : '#202223' }}>
                    {rate.curRate !== null ? `${rate.curRate}%` : '—'} →
                  </span>
                  {isBad && rate.priorRate !== null && (
                    <span style={{ fontSize: 12, color: '#D72C0D', marginLeft: 6 }}>
                      (was {rate.priorRate}%)
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Problem source lines */}
      {problemSources.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #E1E3E5', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {problemSources.slice(0, 3).map(s => {
            const curRate  = s.current_atc > 0 ? r1((s.current_checkout / s.current_atc) * 100) : 0;
            const priorRate = s.prior_atc  > 0 ? r1((s.prior_checkout   / s.prior_atc)   * 100) : 0;
            return (
              <div key={`${s.source}-${s.medium}`} style={{ fontSize: 13, color: '#D72C0D' }}>
                {s.source}{s.medium ? ` / ${s.medium}` : ''}: {curRate}% checkout rate (was {priorRate}%)
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Section 2: Checkout step funnel ───────────────────────────────

function CheckoutStepsSection({ data }: { data: CheckoutStepRow[] }) {
  const row = data?.[0];
  if (!row || Number(row.started) === 0) {
    return (
      <Card style={{ height: '100%', boxSizing: 'border-box' }}>
        <SectionTitle title="Checkout step funnel" />
        <div style={{ fontSize: 13, color: '#6D7175' }}>Checkout step data requires the checkout pixel. Contact support to enable.</div>
      </Card>
    );
  }

  const steps = [
    { label: 'Started checkout',  count: Number(row.started)   },
    { label: 'Contact info',      count: Number(row.contact)   },
    { label: 'Address entered',   count: Number(row.address)   },
    { label: 'Shipping selected', count: Number(row.shipping)  },
    { label: 'Payment entered',   count: Number(row.payment)   },
    { label: 'Completed',         count: Number(row.completed) },
  ];
  const started = steps[0].count;

  let maxDrop = 0, maxDropIdx = -1;
  for (let i = 1; i < steps.length; i++) {
    const drop = steps[i - 1].count - steps[i].count;
    if (drop > maxDrop) { maxDrop = drop; maxDropIdx = i; }
  }

  return (
    <Card style={{ height: '100%', boxSizing: 'border-box' }}>
      <SectionTitle title="Checkout step funnel" subtitle="Where customers drop off inside checkout" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((step, i) => {
          const pct      = started > 0 ? r1((step.count / started) * 100) : 0;
          const drop     = i > 0 ? steps[i - 1].count - step.count : 0;
          const isWorst  = i === maxDropIdx;
          const barWidth = started > 0 ? (step.count / started) * 100 : 0;

          return (
            <div key={step.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 135, fontSize: 12, color: '#6D7175', flexShrink: 0 }}>{step.label}</div>
              <div style={{ flex: 1, height: 18, background: '#F6F6F7', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${barWidth}%`, height: '100%', background: '#202223', borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#202223', width: 40, textAlign: 'right', flexShrink: 0 }}>
                {step.count}
              </div>
              <div style={{ fontSize: 12, color: '#6D7175', width: 38, flexShrink: 0 }}>
                {pct}%
              </div>
              <div style={{ fontSize: 12, width: 80, flexShrink: 0, color: isWorst ? '#D72C0D' : '#6D7175', fontWeight: isWorst ? 600 : 400 }}>
                {i > 0 && drop > 0 ? `−${drop}${isWorst ? ' ●' : ''}` : ''}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Section 3: Last activity in abandoned sessions ─────────────────

function AbandonedLastEventSection({ data }: { data: LastEventRow[] }) {
  if (!data || data.length === 0) {
    return (
      <Card style={{ height: '100%', boxSizing: 'border-box' }}>
        <SectionTitle title="Last activity before abandoning" />
        <div style={{ fontSize: 13, color: '#6D7175' }}>No abandoned sessions in this period.</div>
      </Card>
    );
  }

  const total = data.reduce((s, r) => s + Number(r.session_count), 0);
  const rows  = [...data]
    .sort((a, b) => Number(b.session_count) - Number(a.session_count))
    .map(r => ({
      label:  EVENT_LABELS[r.last_event] ?? r.last_event,
      count:  Number(r.session_count),
      pct:    total > 0 ? r1((Number(r.session_count) / total) * 100) : 0,
      isRed:  RED_LAST_EVENTS.has(r.last_event),
    }));

  return (
    <Card style={{ height: '100%', boxSizing: 'border-box' }}>
      <SectionTitle
        title="Last activity before abandoning"
        subtitle={`${total.toLocaleString()} sessions never started checkout`}
      />
      <div>
        {rows.map((row, i) => (
          <div
            key={row.label}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '7px 0',
              borderBottom: i < rows.length - 1 ? '1px solid #E1E3E5' : 'none',
            }}
          >
            <div style={{ fontSize: 14, color: '#202223' }}>{row.label}</div>
            <div style={{ display: 'flex', gap: 14, flexShrink: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: row.isRed ? '#D72C0D' : '#202223', minWidth: 36, textAlign: 'right' }}>
                {row.count.toLocaleString()}
              </div>
              <div style={{ fontSize: 13, color: '#6D7175', minWidth: 44, textAlign: 'right' }}>
                {row.pct}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Section 4: Checkout timing ────────────────────────────────────

function CheckoutTimingSection({ checkoutTiming }: { checkoutTiming: TimingRow[] }) {
  const completedData = BUCKET_ORDER.map(b => ({
    bucket: BUCKET_LABELS[b] ?? b,
    count:  checkoutTiming.filter(r => r.type === 'completed' && r.bucket === b).reduce((s, r) => s + Number(r.count), 0),
  }));
  const abandonedData = BUCKET_ORDER.map(b => ({
    bucket: BUCKET_LABELS[b] ?? b,
    count:  checkoutTiming.filter(r => r.type === 'abandoned' && r.bucket === b).reduce((s, r) => s + Number(r.count), 0),
  }));

  const hasData = completedData.some(d => d.count > 0) || abandonedData.some(d => d.count > 0);
  if (!hasData) {
    return (
      <Card>
        <SectionTitle title="Checkout timing" />
        <div style={{ fontSize: 13, color: '#6D7175' }}>No checkout timing data available.</div>
      </Card>
    );
  }

  const completedMedian = estimateMedian(checkoutTiming, 'completed');
  const abandonedMedian = estimateMedian(checkoutTiming, 'abandoned');

  return (
    <Card>
      <SectionTitle title="Checkout timing" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        {/* Completed — black bars */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#202223', marginBottom: 2 }}>Completed checkouts</div>
          <div style={{ fontSize: 13, color: '#6D7175', marginBottom: 10 }}>Sessions that finished</div>
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
          <div style={{ fontSize: 13, color: '#6D7175', marginTop: 6 }}>
            Median: <strong style={{ color: '#202223' }}>{completedMedian}</strong>
          </div>
        </div>

        {/* Abandoned — red bars */}
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#202223', marginBottom: 2 }}>Abandoned checkouts</div>
          <div style={{ fontSize: 13, color: '#6D7175', marginBottom: 10 }}>Sessions that left</div>
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
          <div style={{ fontSize: 13, color: '#6D7175', marginTop: 6 }}>
            Median: <strong style={{ color: '#202223' }}>{abandonedMedian}</strong>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Section 5: Converters vs non-converters ────────────────────────

function ConverterComparisonSection({ data }: { data: ConverterRow[] }) {
  const total = (data ?? []).reduce((s, r) => s + Number(r.session_count), 0);
  if (!data || data.length < 2 || total < 5) {
    return (
      <Card>
        <SectionTitle title="Converters vs. non-converters" />
        <div style={{ fontSize: 13, color: '#6D7175' }}>Not enough sessions to compare.</div>
      </Card>
    );
  }

  const isTrue  = (v: boolean | string) => v === true || v === 'true';
  const conv    = data.find(r => isTrue(r.converted as boolean | string));
  const nonConv = data.find(r => !isTrue(r.converted as boolean | string));

  if (!conv || !nonConv) {
    return (
      <Card>
        <SectionTitle title="Converters vs. non-converters" />
        <div style={{ fontSize: 13, color: '#6D7175' }}>Not enough data to compare groups.</div>
      </Card>
    );
  }

  type Row = { label: string; cVal: string; ncVal: string; ppDiff: number | null };

  const pp = (a: number, b: number) => r1(a - b);

  const rows: Row[] = [
    { label: 'Sessions',              cVal: Number(conv.session_count).toLocaleString(),                   ncVal: Number(nonConv.session_count).toLocaleString(),            ppDiff: null },
    { label: 'Median time in cart',   cVal: fmtSeconds(Number(conv.avg_time_seconds)),                     ncVal: fmtSeconds(Number(nonConv.avg_time_seconds)),               ppDiff: null },
    { label: 'Avg items',             cVal: Number(conv.avg_items).toFixed(1),                             ncVal: Number(nonConv.avg_items).toFixed(1),                       ppDiff: null },
    { label: 'Avg cart value',        cVal: `$${Math.round(Number(conv.avg_cart_value_dollars)).toLocaleString()}`, ncVal: `$${Math.round(Number(nonConv.avg_cart_value_dollars)).toLocaleString()}`, ppDiff: null },
    { label: 'Used a coupon',         cVal: `${conv.coupon_usage_pct}%`,  ncVal: `${nonConv.coupon_usage_pct}%`,  ppDiff: Math.abs(pp(Number(conv.coupon_usage_pct), Number(nonConv.coupon_usage_pct))) },
    { label: 'Coupon failed',         cVal: `${conv.coupon_failed_pct}%`, ncVal: `${nonConv.coupon_failed_pct}%`, ppDiff: Math.abs(pp(Number(conv.coupon_failed_pct), Number(nonConv.coupon_failed_pct))) },
    { label: 'Had item removed',      cVal: `${conv.removal_pct}%`,       ncVal: `${nonConv.removal_pct}%`,       ppDiff: Math.abs(pp(Number(conv.removal_pct), Number(nonConv.removal_pct))) },
    { label: 'From UTM-tagged traffic',cVal: `${conv.paid_traffic_pct}%`, ncVal: `${nonConv.paid_traffic_pct}%`,  ppDiff: Math.abs(pp(Number(conv.paid_traffic_pct), Number(nonConv.paid_traffic_pct))) },
    { label: 'On mobile',             cVal: `${conv.mobile_pct}%`,        ncVal: `${nonConv.mobile_pct}%`,        ppDiff: Math.abs(pp(Number(conv.mobile_pct), Number(nonConv.mobile_pct))) },
  ];

  return (
    <Card>
      <SectionTitle
        title="Converters vs. non-converters"
        subtitle="Sessions that started checkout vs. those that added to cart but never did"
      />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #E1E3E5' }}>
            <th style={{ padding: '8px 12px', textAlign: 'left',  fontSize: 12, fontWeight: 500, color: '#6D7175', width: '40%' }}></th>
            <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#202223', width: '30%' }}>Checked out</th>
            <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#202223', width: '30%' }}>Didn&apos;t</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const isBig = row.ppDiff !== null && row.ppDiff > 10;
            return (
              <tr
                key={row.label}
                style={{
                  borderBottom: '1px solid #E1E3E5',
                  borderLeft: isBig ? '3px solid #D72C0D' : '3px solid transparent',
                  background: isBig ? '#FFF4F4' : undefined,
                }}
              >
                <td style={{ padding: '10px 12px', color: '#6D7175' }}>
                  {row.label}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 500, color: '#202223' }}>{row.cVal}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: '#202223' }}>
                  {row.ncVal}
                  {isBig && (
                    <span style={{ marginLeft: 8, display: 'inline-block' }}>
                      <Badge tone="critical">{`+${row.ppDiff!}pp`}</Badge>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
          <FunnelSection funnelData={data.funnelData ?? []} funnelBySource={data.funnelBySource ?? []} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
            <CheckoutStepsSection data={data.checkoutSteps ?? []} />
            <AbandonedLastEventSection data={data.lastEvents ?? []} />
          </div>

          <CheckoutTimingSection checkoutTiming={data.checkoutTiming ?? []} />

          <ConverterComparisonSection data={data.converterComparison ?? []} />
        </>
      )}
    </div>
  );
}
