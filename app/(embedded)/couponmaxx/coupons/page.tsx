'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Spinner } from '@shopify/polaris';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';

import { useShop } from '@/hooks/useShop';
import { DateRangePicker, DateRange } from '@/components/couponmaxx/DateRangePicker';
import { KpiBox } from '@/components/couponmaxx/KpiBox';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CouponStatus = 'healthy' | 'degraded' | 'broken' | 'low_data';

type Boxes = {
  codesTracked: number;
  brokenCount: number;
  degradedCount: number;
  healthyCount: number;
  couponSuccessRate: number;
  couponSuccessRateDelta: number;
  aovWithCoupon: number;
  aovWithoutCoupon: number;
  abandonedAfterFail: number;
  abandonedAfterFailPct: number;
  abandonedCartValue: number;
};

type CodeTableRow = {
  code: string;
  status: CouponStatus;
  attempts: number;
  successRate: number;
  avgCart: number;
  avgCartFail: number;
  recoveries: number;
  handoffRate: number;
  lastSeen: string;
};

type SuccessRateChartRow = {
  code: string;
  attempts: number;
  successRate: number;
  status: CouponStatus;
};

type ZombieCode = {
  code: string;
  attempts: number;
  firstSeen: string;
  lastSeen: string;
};

type CouponsResponse = {
  boxes: Boxes;
  velocityChart: {
    codes: string[];
    daily: Array<Record<string, string | number>>;
  };
  successRateChart: SuccessRateChartRow[];
  codes: CodeTableRow[];
  zombieCodes: ZombieCode[];
};

// Code detail panel types
type TrendPoint = { date: string; attempts: number; successes: number };
type ProductBreakdown = { products: string; attempts: number; successRate: number; note: string };
type RecoveryDetail = {
  count: number;
  avgCartBefore: number;
  avgCartAfter: number;
  avgIncrease: number;
  convRateAfterRecovery: number;
};
type ContinuedCode = { code: string; count: number };
type RecentSession = {
  sessionId: string;
  startTime: string;
  cartValue: number | null;
  outcome: string;
  couponStatus: string;
};

type CodeDetailResponse = {
  code: string;
  status: CouponStatus;
  attempts: number;
  successRate: number;
  prevSuccessRate: number | null;
  avgCart: number;
  avgCartFail: number;
  totalDiscount: number;
  handoffRate: number;
  trend: TrendPoint[];
  productBreakdown: ProductBreakdown[];
  hasProductRestriction: boolean;
  recoveryDetail: RecoveryDetail | null;
  cannibalization: {
    savedSessions: number;
    continuedAfterFail: number;
    continuedCodes: ContinuedCode[];
  };
  recentSessions: RecentSession[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function subDays(d: Date, n: number) {
  return new Date(d.getTime() - n * 86400000);
}

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(`API error ${r.status}`);
  return r.json();
});

const LINE_COLORS = ['#0EA5E9', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444'];

const STATUS_BORDER: Record<CouponStatus, string> = {
  healthy: '#22C55E',
  degraded: '#F59E0B',
  broken: '#EF4444',
  low_data: '#D1D5DB',
};

const STATUS_LABEL: Record<CouponStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  broken: 'Broken',
  low_data: 'Low data',
};

const STATUS_COLOR: Record<CouponStatus, string> = {
  healthy: '#15803D',
  degraded: '#B45309',
  broken: '#B91C1C',
  low_data: '#9CA3AF',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString();
  if (d.toDateString() === today) return 'Today';
  if (d.toDateString() === yesterday) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtShortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtMoney(n: number): string {
  return '$' + Math.round(n).toLocaleString();
}

function barColor(sr: number, status: CouponStatus): string {
  if (status === 'low_data') return '#D1D5DB';
  if (sr >= 50) return '#0EA5E9';
  if (sr >= 20) return '#F59E0B';
  return '#EF4444';
}

// ---------------------------------------------------------------------------
// Code Detail Panel
// ---------------------------------------------------------------------------

function CodeDetailPanel({
  code,
  shop,
  start,
  end,
  onClose,
}: {
  code: string;
  shop: string;
  start: Date;
  end: Date;
  onClose: () => void;
}) {
  const url = `/api/couponmaxx/coupons/${encodeURIComponent(code)}?shop=${encodeURIComponent(shop)}&start=${start.toISOString()}&end=${end.toISOString()}`;
  const { data, error, isLoading } = useSWR<CodeDetailResponse>(url, fetcher);

  const dateRangeLabel = `${fmtShortDate(start.toISOString())} – ${fmtShortDate(end.toISOString())}`;

  return (
    <>
      {/* Dark overlay */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 40,
          background: 'rgba(0,0,0,0.35)',
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 480,
          height: '100vh',
          zIndex: 50,
          background: '#FFFFFF',
          borderLeft: '1px solid #E3E3E3',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 16,
            right: 16,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#6B7280',
            fontSize: 20,
            lineHeight: 1,
            padding: 4,
          }}
        >
          ×
        </button>

        <div style={{ padding: '24px 24px 32px' }}>
          {isLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
              <Spinner size="small" />
            </div>
          )}

          {error && (
            <div style={{ color: '#B91C1C', fontSize: 13, paddingTop: 20 }}>
              Failed to load code details.
            </div>
          )}

          {data && (
            <>
              {/* Header */}
              <div style={{ marginBottom: 20, paddingRight: 32 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 600, color: '#111827', marginBottom: 6 }}>
                  {data.code}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: STATUS_BORDER[data.status],
                    display: 'inline-block',
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 13, color: STATUS_COLOR[data.status], fontWeight: 500 }}>
                    {STATUS_LABEL[data.status]}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#9CA3AF' }}>
                  {data.attempts} attempts in {dateRangeLabel}
                </div>
              </div>

              <div style={{ borderTop: '1px solid #F3F4F6', marginBottom: 20 }} />

              {/* Section 1 — Velocity trend */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 4 }}>Velocity trend</div>
                <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 10 }}>
                  Daily attempts vs successes
                </div>
                {data.trend.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#9CA3AF' }}>No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height={140}>
                    <LineChart data={data.trend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => {
                        const d = new Date(v);
                        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                      }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip
                        formatter={(value, name) => [value, name === 'attempts' ? 'Attempts' : 'Successes']}
                        labelFormatter={(label) => {
                          const d = new Date(label);
                          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        }}
                      />
                      <Line type="monotone" dataKey="attempts" stroke="#9CA3AF" dot={false} strokeWidth={1.5} name="attempts" />
                      <Line type="monotone" dataKey="successes" stroke="#22C55E" dot={false} strokeWidth={1.5} name="successes" />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Section 2 — Stats grid */}
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 10 }}>Stats</div>
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 8,
                }}>
                  {[
                    { label: 'Success rate', value: `${data.successRate.toFixed(1)}%` },
                    { label: 'Prev. success rate', value: data.prevSuccessRate != null ? `${data.prevSuccessRate.toFixed(1)}%` : '—' },
                    { label: 'Avg cart (success)', value: fmtMoney(data.avgCart) },
                    { label: 'Avg cart (failed)', value: fmtMoney(data.avgCartFail) },
                    { label: 'Handoff rate', value: `${data.handoffRate.toFixed(1)}%` },
                    { label: 'Total discount', value: fmtMoney(data.totalDiscount) },
                  ].map(({ label, value }) => (
                    <div key={label} style={{
                      background: '#F9FAFB', borderRadius: 6, padding: '10px 12px',
                      border: '1px solid #E3E3E3',
                    }}>
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Section 3 — Code interactions */}
              {(data.cannibalization.savedSessions > 0 || data.cannibalization.continuedAfterFail > 0) && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 10 }}>Code interactions</div>
                  {data.cannibalization.savedSessions > 0 && (
                    <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>
                      This code saved <strong>{data.cannibalization.savedSessions}</strong> sessions
                    </div>
                  )}
                  {data.cannibalization.continuedAfterFail > 0 && (
                    <div style={{ fontSize: 13, color: '#374151', marginBottom: 6 }}>
                      <strong>{data.cannibalization.continuedAfterFail}</strong> sessions continued after this code failed
                    </div>
                  )}
                  {data.cannibalization.continuedCodes.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {data.cannibalization.continuedCodes.map((c) => (
                        <span key={c.code} style={{
                          fontSize: 12, background: '#EFF6FF', color: '#1D4ED8',
                          padding: '2px 8px', borderRadius: 4, fontFamily: 'monospace',
                        }}>
                          {c.count} converted with {c.code}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Section 4 — Success rate by product */}
              {data.productBreakdown.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 10 }}>
                    Success rate by product
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {['Product', 'Attempts', 'Success rate', 'Note'].map((h) => (
                          <th key={h} style={{
                            textAlign: 'left', padding: '4px 8px',
                            borderBottom: '1px solid #E3E3E3', color: '#9CA3AF',
                            fontWeight: 500, fontSize: 11,
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.productBreakdown.map((p) => (
                        <tr key={p.products}>
                          <td style={{ padding: '6px 8px', color: '#374151', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.products}</td>
                          <td style={{ padding: '6px 8px', color: '#374151' }}>{p.attempts}</td>
                          <td style={{ padding: '6px 8px', color: '#374151' }}>{p.successRate.toFixed(1)}%</td>
                          <td style={{ padding: '6px 8px', color: '#B45309', fontSize: 11 }}>{p.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Section 5 — Recovery detail */}
              {data.recoveryDetail && (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 10 }}>
                    {data.recoveryDetail.count} customer{data.recoveryDetail.count !== 1 ? 's' : ''} unlocked this code by adding items
                  </div>
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr',
                    gap: 8,
                  }}>
                    {[
                      { label: 'Avg cart before', value: fmtMoney(data.recoveryDetail.avgCartBefore) },
                      { label: 'Avg cart after', value: fmtMoney(data.recoveryDetail.avgCartAfter) },
                      { label: 'Avg increase', value: fmtMoney(data.recoveryDetail.avgIncrease) },
                      { label: 'Conv. rate after recovery', value: `${data.recoveryDetail.convRateAfterRecovery.toFixed(1)}%` },
                    ].map(({ label, value }) => (
                      <div key={label} style={{
                        background: '#F0FDF4', border: '1px solid #BBF7D0',
                        borderRadius: 6, padding: '10px 12px',
                      }}>
                        <div style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 2 }}>{label}</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 6 — Recent sessions */}
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 10 }}>
                  Recent sessions (last {data.recentSessions.length})
                </div>
                {data.recentSessions.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#9CA3AF' }}>No sessions found.</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {['Time', 'Cart value', 'Outcome', 'Coupon status'].map((h) => (
                          <th key={h} style={{
                            textAlign: 'left', padding: '4px 8px',
                            borderBottom: '1px solid #E3E3E3', color: '#9CA3AF',
                            fontWeight: 500, fontSize: 11,
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentSessions.map((s) => (
                        <tr key={s.sessionId} style={{ borderBottom: '1px solid #F3F4F6' }}>
                          <td style={{ padding: '6px 8px', color: '#374151' }}>{fmtDate(s.startTime)}</td>
                          <td style={{ padding: '6px 8px', color: '#374151' }}>
                            {s.cartValue != null ? fmtMoney(s.cartValue) : '—'}
                          </td>
                          <td style={{ padding: '6px 8px', color: '#374151', textTransform: 'capitalize' }}>{s.outcome}</td>
                          <td style={{ padding: '6px 8px' }}>
                            <span style={{
                              fontSize: 11,
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: s.couponStatus === 'applied' || s.couponStatus === 'recovered'
                                ? '#DCFCE7' : s.couponStatus === 'failed' ? '#FEE2E2' : '#F3F4F6',
                              color: s.couponStatus === 'applied' || s.couponStatus === 'recovered'
                                ? '#15803D' : s.couponStatus === 'failed' ? '#B91C1C' : '#6B7280',
                            }}>
                              {s.couponStatus}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Custom recharts label for success rate bar chart
// ---------------------------------------------------------------------------

function BarLabel(props: { x?: number; y?: number; width?: number; height?: number; value?: number; status?: CouponStatus }) {
  const { x = 0, y = 0, width = 0, height = 0, value = 0, status = 'healthy' } = props;
  const color = status === 'low_data' ? '#9CA3AF' : value >= 50 ? '#0EA5E9' : value >= 20 ? '#F59E0B' : '#EF4444';
  return (
    <text
      x={x + width + 6}
      y={y + height / 2}
      fill={color}
      fontSize={11}
      fontWeight={600}
      dominantBaseline="central"
    >
      {`${value}%`}
    </text>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function CouponsPage() {
  const shop = useShop();

  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const end = new Date();
    const start = subDays(end, 30);
    return { start, end };
  });

  const [statusFilter, setStatusFilter] = useState<'all' | 'healthy' | 'degraded' | 'broken' | 'low_data'>('all');
  const [sortBy, setSortBy] = useState<'attempts' | 'successRate' | 'avgCart' | 'lastSeen'>('attempts');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set());
  const [zombieOpen, setZombieOpen] = useState(false);

  const apiUrl = shop
    ? `/api/couponmaxx/coupons?shop=${encodeURIComponent(shop)}&start=${dateRange.start.toISOString()}&end=${dateRange.end.toISOString()}`
    : null;

  const { data, error, isLoading } = useSWR<CouponsResponse>(apiUrl, fetcher);

  // Derived table data
  const filteredCodes = (() => {
    if (!data) return [];
    let rows = [...data.codes];
    if (statusFilter !== 'all') rows = rows.filter((r) => r.status === statusFilter);
    if (sortBy === 'attempts') rows.sort((a, b) => b.attempts - a.attempts);
    else if (sortBy === 'successRate') rows.sort((a, b) => b.successRate - a.successRate);
    else if (sortBy === 'avgCart') rows.sort((a, b) => b.avgCart - a.avgCart);
    else if (sortBy === 'lastSeen') rows.sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
    return rows;
  })();

  const card = {
    background: '#FFFFFF',
    border: '1px solid #E3E3E3',
    borderRadius: 8,
    padding: 20,
  };

  const pillBtn = (active: boolean) => ({
    padding: '5px 12px',
    fontSize: 12,
    border: '1px solid #E3E3E3',
    borderRadius: 20,
    cursor: 'pointer' as const,
    background: active ? '#111827' : '#FFFFFF',
    color: active ? '#FFFFFF' : '#374151',
    fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{ background: '#F1F1F1', minHeight: '100vh', padding: 24 }}>
      {/* Page header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', margin: 0 }}>Coupons</h1>
        <p style={{ fontSize: 13, color: '#6B7280', margin: '4px 0 0' }}>
          Track every code, find what's failing, understand what's driving revenue.
        </p>
      </div>

      {/* Date range picker */}
      <div style={{ marginBottom: 20 }}>
        <DateRangePicker value={dateRange} onChange={setDateRange} defaultDays={30} />
      </div>

      {/* Loading / Error */}
      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
          <Spinner size="small" />
        </div>
      )}

      {error && !isLoading && (
        <div style={{ color: '#B91C1C', fontSize: 13 }}>Failed to load coupon data.</div>
      )}

      {data && (
        <>
          {/* KPI Boxes */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            {/* Box 1 — Codes Tracked */}
            <KpiBox
              label="Codes Tracked"
              value={data.boxes.codesTracked}
              sub2={
                <span>
                  <span style={{ color: '#B91C1C' }}>{data.boxes.brokenCount} broken</span>
                  <span style={{ color: '#D1D5DB' }}> · </span>
                  <span style={{ color: '#B45309' }}>{data.boxes.degradedCount} degraded</span>
                  <span style={{ color: '#D1D5DB' }}> · </span>
                  <span style={{ color: '#15803D' }}>{data.boxes.healthyCount} healthy</span>
                </span>
              }
            />

            {/* Box 2 — Coupon Success Rate */}
            <KpiBox
              label="Coupon Success Rate"
              value={`${data.boxes.couponSuccessRate.toFixed(1)}%`}
              sub1={(() => {
                const delta = data.boxes.couponSuccessRateDelta;
                const sign = delta >= 0 ? '+' : '';
                return `${sign}${delta.toFixed(1)}pp vs previous period`;
              })()}
              sub2={
                data.boxes.couponSuccessRateDelta !== 0 ? (
                  <span style={{
                    color: data.boxes.couponSuccessRateDelta >= 0 ? '#15803D' : '#B91C1C',
                    fontSize: 13,
                  }}>
                    {data.boxes.couponSuccessRateDelta >= 0 ? '▲' : '▼'}
                  </span>
                ) : undefined
              }
            />

            {/* Box 3 — Checkout AOV */}
            <KpiBox
              label="Checkout AOV"
              value={`$${Math.round(data.boxes.aovWithCoupon)} with coupon`}
              sub2={(() => {
                const diff = data.boxes.aovWithCoupon - data.boxes.aovWithoutCoupon;
                const sign = diff >= 0 ? '+' : '-';
                const color = diff >= 0 ? '#15803D' : '#B91C1C';
                return (
                  <span>
                    ${Math.round(data.boxes.aovWithoutCoupon)} without
                    {' · '}
                    <span style={{ color }}>{sign}${Math.round(Math.abs(diff))} difference</span>
                  </span>
                );
              })()}
            />

            {/* Box 4 — Abandoned After Coupon Failure */}
            <KpiBox
              label="Abandoned After Coupon Failure"
              value={data.boxes.abandonedAfterFail}
              sub1={`${data.boxes.abandonedAfterFailPct}% of failed coupon sessions abandoned immediately`}
              sub2={`$${Math.round(data.boxes.abandonedCartValue).toLocaleString()} in cart value left behind`}
            />
          </div>

          {/* Charts row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {/* Left — Code Velocity */}
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 2 }}>Code velocity</div>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 12 }}>Daily attempt volume by code</div>
              {data.velocityChart.daily.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9CA3AF', paddingTop: 60, textAlign: 'center' }}>No data</div>
              ) : (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={data.velocityChart.daily} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(v) => {
                          const d = new Date(v);
                          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        }}
                      />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip
                        labelFormatter={(label) => {
                          const d = new Date(label);
                          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        }}
                      />
                      <Legend
                        onClick={(e) => {
                          const key = e.dataKey as string;
                          setHiddenLines((prev) => {
                            const next = new Set(prev);
                            if (next.has(key)) next.delete(key);
                            else next.add(key);
                            return next;
                          });
                        }}
                        formatter={(value) => (
                          <span style={{ fontSize: 11, color: '#374151', cursor: 'pointer' }}>{value}</span>
                        )}
                      />
                      {data.velocityChart.codes.map((code, i) => (
                        <Line
                          key={code}
                          type="monotone"
                          dataKey={code}
                          stroke={LINE_COLORS[i % LINE_COLORS.length]}
                          dot={false}
                          strokeWidth={1.5}
                          hide={hiddenLines.has(code)}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </>
              )}
            </div>

            {/* Right — Success Rate by Code */}
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#111827', marginBottom: 2 }}>Success rate by code</div>
              <div style={{ fontSize: 12, color: '#9CA3AF', marginBottom: 12 }}>Sorted by attempt volume</div>
              {data.successRateChart.length === 0 ? (
                <div style={{ fontSize: 12, color: '#9CA3AF', paddingTop: 60, textAlign: 'center' }}>No data</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart
                    layout="vertical"
                    data={data.successRateChart}
                    margin={{ top: 0, right: 60, bottom: 0, left: 8 }}
                  >
                    <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <YAxis
                      type="category"
                      dataKey="code"
                      tick={{ fontSize: 10, fontFamily: 'monospace' }}
                      width={80}
                      tickFormatter={(v) => v}
                    />
                    <Tooltip
                      formatter={(value) => [`${value}%`, 'Success rate']}
                      labelFormatter={(label) => label}
                    />
                    <Bar dataKey="successRate" radius={[0, 3, 3, 0]} label={(props) => {
                      const idx = props.index as number | undefined;
                      const row = idx !== undefined ? (data.successRateChart[idx] ?? null) : null;
                      return (
                        <BarLabel
                          x={typeof props.x === 'number' ? props.x : 0}
                          y={typeof props.y === 'number' ? props.y : 0}
                          width={typeof props.width === 'number' ? props.width : 0}
                          height={typeof props.height === 'number' ? props.height : 0}
                          value={typeof props.value === 'number' ? props.value : 0}
                          status={row?.status ?? 'low_data'}
                        />
                      );
                    }}>
                      {data.successRateChart.map((entry) => (
                        <Cell key={entry.code} fill={barColor(entry.successRate, entry.status)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Zombie codes — conditional, collapsible */}
          {data.zombieCodes.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div
                onClick={() => setZombieOpen((o) => !o)}
                style={{
                  background: '#FFFBEB',
                  border: '1px solid #FDE68A',
                  borderRadius: zombieOpen ? '8px 8px 0 0' : 8,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 500, color: '#92400E' }}>
                  ⚠ {data.zombieCodes.length} code{data.zombieCodes.length !== 1 ? 's' : ''} tried that don't exist in your store
                </span>
                <span style={{
                  fontSize: 14, color: '#92400E',
                  transform: zombieOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                  display: 'inline-block',
                }}>
                  ▾
                </span>
              </div>
              {zombieOpen && (
                <div style={{
                  background: '#FFFBEB',
                  border: '1px solid #FDE68A',
                  borderTop: 'none',
                  borderRadius: '0 0 8px 8px',
                  padding: '0 16px 16px',
                }}>
                  <p style={{ fontSize: 12, color: '#92400E', margin: '0 0 12px', lineHeight: 1.5 }}>
                    These codes were entered by customers but never applied successfully. They may be old codes, typos, or codes from other sources.
                  </p>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        {['Code', 'Attempts', 'First seen', 'Last seen'].map((h) => (
                          <th key={h} style={{
                            textAlign: 'left', padding: '4px 8px',
                            borderBottom: '1px solid #FDE68A', color: '#92400E',
                            fontWeight: 500, fontSize: 11,
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.zombieCodes.map((z) => (
                        <tr key={z.code}>
                          <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontWeight: 600, color: '#111827' }}>{z.code}</td>
                          <td style={{ padding: '6px 8px', color: '#374151' }}>{z.attempts}</td>
                          <td style={{ padding: '6px 8px', color: '#374151' }}>{fmtShortDate(z.firstSeen)}</td>
                          <td style={{ padding: '6px 8px', color: '#374151' }}>{fmtShortDate(z.lastSeen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Code table */}
          <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
            {/* Table header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #E3E3E3' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>All codes</div>
                  <div style={{ fontSize: 12, color: '#9CA3AF', marginTop: 2 }}>
                    {data.codes.length} code{data.codes.length !== 1 ? 's' : ''} tracked in this period
                  </div>
                </div>
                {/* Sort */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: '#6B7280' }}>Sort:</span>
                  {(['attempts', 'successRate', 'avgCart', 'lastSeen'] as const).map((s) => {
                    const labels: Record<string, string> = {
                      attempts: 'Attempts',
                      successRate: 'Success rate',
                      avgCart: 'Avg cart',
                      lastSeen: 'Last seen',
                    };
                    return (
                      <button key={s} onClick={() => setSortBy(s)} style={pillBtn(sortBy === s)}>
                        {labels[s]}
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Status filter */}
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                {(['all', 'healthy', 'degraded', 'broken', 'low_data'] as const).map((s) => {
                  const labels: Record<string, string> = {
                    all: 'All',
                    healthy: 'Healthy',
                    degraded: 'Degraded',
                    broken: 'Broken',
                    low_data: 'Low data',
                  };
                  return (
                    <button key={s} onClick={() => setStatusFilter(s)} style={pillBtn(statusFilter === s)}>
                      {labels[s]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Table */}
            {filteredCodes.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', fontSize: 13, color: '#9CA3AF' }}>
                No codes match the current filter.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: 5 }} />
                    <col style={{ width: 160 }} />
                    <col style={{ width: 80 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 100 }} />
                    <col style={{ width: 90 }} />
                  </colgroup>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #E3E3E3' }}>
                      <th style={{ padding: 0 }} />
                      {['Code', 'Attempts', 'Success rate', 'Avg cart (Success)', 'Avg cart (Failed)', 'Recoveries', 'Handoff rate', 'Last seen'].map((h) => (
                        <th key={h} style={{
                          textAlign: 'left', padding: '10px 12px',
                          fontSize: 11, fontWeight: 500, color: '#9CA3AF',
                        }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCodes.map((row) => (
                      <tr
                        key={row.code}
                        onClick={() => setSelectedCode(row.code)}
                        style={{
                          borderBottom: '1px solid #F3F4F6',
                          cursor: 'pointer',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F9FAFB'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
                      >
                        {/* Status indicator */}
                        <td style={{
                          padding: 0,
                          width: 5,
                          background: STATUS_BORDER[row.status],
                        }} />
                        {/* Code */}
                        <td style={{
                          padding: '10px 12px',
                          fontFamily: 'monospace',
                          fontSize: 13,
                          fontWeight: row.status === 'broken' || row.status === 'degraded' ? 700 : 400,
                          color: '#111827',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {row.code}
                        </td>
                        {/* Attempts */}
                        <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151' }}>
                          {row.attempts}
                        </td>
                        {/* Success rate */}
                        <td style={{ padding: '10px 12px', fontSize: 13, color: STATUS_COLOR[row.status], fontWeight: 600 }}>
                          {row.successRate.toFixed(1)}%
                        </td>
                        {/* Avg cart success */}
                        <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151' }}>
                          ${Math.round(row.avgCart)}
                        </td>
                        {/* Avg cart fail */}
                        <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151' }}>
                          ${Math.round(row.avgCartFail)}
                        </td>
                        {/* Recoveries */}
                        <td style={{ padding: '10px 12px', fontSize: 13 }}>
                          {row.recoveries > 0 ? (
                            <span style={{ color: '#1D4ED8' }}>{row.recoveries} unlocked</span>
                          ) : '—'}
                        </td>
                        {/* Handoff rate */}
                        <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151' }}>
                          {row.handoffRate.toFixed(1)}%
                        </td>
                        {/* Last seen */}
                        <td style={{ padding: '10px 12px', fontSize: 13, color: '#374151' }}>
                          {fmtDate(row.lastSeen)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Code detail panel */}
      {selectedCode && shop && (
        <CodeDetailPanel
          code={selectedCode}
          shop={shop}
          start={dateRange.start}
          end={dateRange.end}
          onClose={() => setSelectedCode(null)}
        />
      )}
    </div>
  );
}
