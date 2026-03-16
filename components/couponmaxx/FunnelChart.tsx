'use client';

import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';

type FunnelColumn = {
  key: string;
  label: string;
  value: number;
  daily?: { date: string; value: number }[];
};

type Props = {
  columns: FunnelColumn[];
  loading?: boolean;
};

const LINE_COLORS = ['#0EA5E9', '#8B5CF6', '#F59E0B', '#10B981', '#EF4444', '#F97316'];

const CustomBarTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: { label: string; value: number; pct: number } }> }) => {
  if (!active || !payload?.length) return null;
  const { label, value, pct } = payload[0].payload;
  return (
    <div style={{
      background: '#1F2937', color: '#fff', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 500,
    }}>
      {label}: {value.toLocaleString()}  {Math.round(pct)}%
    </div>
  );
};

export function FunnelChart({ columns, loading }: Props) {
  const [mode, setMode] = useState<'bar' | 'line'>('bar');
  const [visible, setVisible] = useState<Set<string>>(new Set(columns.map((c) => c.key)));

  if (loading) {
    return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9CA3AF', fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  const maxVal = Math.max(...columns.map((c) => c.value), 1);
  const activeColumns = columns.filter((c) => visible.has(c.key));

  const barData = activeColumns.map((c) => ({
    label: c.label,
    value: c.value,
    pct: (c.value / maxVal) * 100,
  }));

  // Build line data by date
  const allDates = Array.from(new Set(
    columns.flatMap((c) => c.daily?.map((d) => d.date) ?? [])
  )).sort();

  const lineData = allDates.map((date) => {
    const point: Record<string, string | number> = { date };
    for (const col of columns) {
      if (visible.has(col.key)) {
        point[col.key] = col.daily?.find((d) => d.date === date)?.value ?? 0;
      }
    }
    return point;
  });

  function fmtDate(d: string) {
    const dt = new Date(d);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>Coupon funnel</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Column selector */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {columns.map((c) => (
              <button
                key={c.key}
                onClick={() => setVisible((prev) => {
                  const next = new Set(prev);
                  if (next.has(c.key)) { if (next.size > 1) next.delete(c.key); }
                  else next.add(c.key);
                  return next;
                })}
                style={{
                  padding: '3px 8px', borderRadius: 4, border: '1px solid #E3E3E3',
                  background: visible.has(c.key) ? '#0EA5E9' : '#fff',
                  color: visible.has(c.key) ? '#fff' : '#374151',
                  fontSize: 11, cursor: 'pointer',
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          {/* Bar / Line toggle */}
          <div style={{ display: 'flex', border: '1px solid #E3E3E3', borderRadius: 6, overflow: 'hidden' }}>
            {(['bar', 'line'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: '4px 10px', border: 'none', cursor: 'pointer', fontSize: 12,
                  background: mode === m ? '#0EA5E9' : '#fff',
                  color: mode === m ? '#fff' : '#374151',
                }}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={280}>
        {mode === 'bar' ? (
          <BarChart data={barData} barCategoryGap="40%" margin={{ top: 20, right: 8, bottom: 8, left: 40 }}>
            <XAxis dataKey="label" tick={{ fontSize: 13, fill: '#6B7280' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickCount={5} />
            <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {barData.map((_, i) => <Cell key={i} fill="#0EA5E9" />)}
            </Bar>
          </BarChart>
        ) : (
          <LineChart data={lineData} margin={{ top: 8, right: 8, bottom: 8, left: 40 }}>
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false} tickCount={5} />
            <Tooltip formatter={(v) => typeof v === 'number' ? v.toLocaleString() : v} />
            <Legend />
            {activeColumns.map((col, i) => (
              <Line
                key={col.key} type="monotone" dataKey={col.key} name={col.label}
                stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={1.5} dot={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
