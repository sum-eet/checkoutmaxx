'use client';

import {
  LineChart, Line, XAxis, YAxis, Tooltip, Area,
  AreaChart, ResponsiveContainer, Legend,
} from 'recharts';

type DataPoint = { date: string; value: number };
type ComparePoint = { date: string; value: number };

type Props = {
  data: DataPoint[];
  compareData?: ComparePoint[];
  height?: number;
  formatY?: (v: number) => string;
  formatTooltip?: (v: number, date: string) => string;
  color?: string;
};

export function LineChartInCard({
  data,
  compareData,
  height = 140,
  formatY = (v) => String(v),
  formatTooltip,
  color = '#0EA5E9',
}: Props) {
  if (!data || data.length === 0) return null;

  // Build unified data for compare overlay
  const merged = data.map((d, i) => ({
    date: d.date,
    value: d.value,
    compare: compareData?.[i]?.value ?? null,
  }));

  const maxVal = Math.max(...data.map((d) => d.value), ...(compareData?.map((d) => d.value) ?? []));

  // Show ~8 x-axis labels
  const step = Math.max(1, Math.ceil(data.length / 8));
  const ticks = data.filter((_, i) => i % step === 0).map((d) => d.date);

  function fmtDate(d: string) {
    const dt = new Date(d);
    return `${dt.getMonth() + 1}/${dt.getDate()}`;
  }

  const CustomTooltip = ({ active, payload, label }: {
    active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string;
  }) => {
    if (!active || !payload?.length) return null;
    return (
      <div style={{
        background: '#fff', border: '1px solid #E3E3E3', borderRadius: 6,
        padding: '6px 10px', fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}>
        <div style={{ color: '#6B7280', marginBottom: 2 }}>{label ? fmtDate(label) : ''}</div>
        {payload.map((p, i) => (
          <div key={i} style={{ color: i === 0 ? color : '#9CA3AF' }}>
            {formatTooltip ? formatTooltip(p.value, label ?? '') : formatY(p.value)}
            {i === 1 ? ' (prev)' : ''}
          </div>
        ))}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={merged} margin={{ top: 8, right: 8, bottom: 8, left: 40 }}>
        <defs>
          <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={color} stopOpacity={0.08} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date" ticks={ticks} tickFormatter={fmtDate}
          tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false}
        />
        <YAxis
          tickFormatter={formatY} domain={[0, maxVal ? maxVal * 1.1 : 10]}
          tick={{ fontSize: 11, fill: '#9CA3AF' }} axisLine={false} tickLine={false}
          width={38} tickCount={5}
        />
        <Tooltip content={<CustomTooltip />} />
        {compareData && (
          <Line
            type="monotone" dataKey="compare" stroke="#9CA3AF" strokeWidth={1.5}
            strokeDasharray="4 4" dot={false} name="Previous"
          />
        )}
        <Area
          type="monotone" dataKey="value" stroke={color} strokeWidth={1.5}
          fill={`url(#grad-${color.replace('#', '')})`} dot={false} name="Value"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
