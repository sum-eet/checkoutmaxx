'use client';

import { useState, useRef, useEffect } from 'react';
import { LineChartInCard } from './LineChartInCard';

type Dropdown = {
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
};

type DataPoint = { date: string; value: number };

type Props = {
  title: string;
  titleDropdowns?: Dropdown[];
  definition: string;
  bigNumber: string;
  data: DataPoint[];
  compareData?: DataPoint[];
  formatY?: (v: number) => string;
  formatTooltip?: (v: number, date: string) => string;
  color?: string;
  emptyMessage?: string;
  loading?: boolean;
  error?: boolean;
};

function TitleDropdown({ dropdown }: { dropdown: Dropdown }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const selected = dropdown.options.find((o) => o.value === dropdown.value)?.label ?? dropdown.value;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
          fontSize: 14, fontWeight: 500, color: '#1A1A1A', display: 'inline-flex', alignItems: 'center', gap: 2,
        }}
      >
        {selected} <span style={{ fontSize: 10 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 200,
          background: '#fff', border: '1px solid #E3E3E3', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: 160, padding: '4px 0',
        }}>
          {dropdown.options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { dropdown.onChange(opt.value); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '8px 14px', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 13, color: opt.value === dropdown.value ? '#1D4ED8' : '#374151',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F9FAFB'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
            >
              {opt.label}
              {opt.value === dropdown.value && <span style={{ fontSize: 12 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export function MetricCard({
  title, titleDropdowns, definition, bigNumber, data, compareData,
  formatY, formatTooltip, color = '#0EA5E9', emptyMessage, loading, error,
}: Props) {
  const empty = !loading && !error && (!data || data.length === 0 || data.every((d) => d.value === 0));

  return (
    <div style={{
      background: '#FFFFFF', border: '1px solid #E3E3E3', borderRadius: 8,
      padding: 20, display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      {/* Title row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 14, fontWeight: 500, color: '#1A1A1A' }}>
          {titleDropdowns ? (
            titleDropdowns.map((dd, i) => (
              <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {i === 0 && <span>{title}</span>}
                <TitleDropdown dropdown={dd} />
              </span>
            ))
          ) : (
            <span>{title}</span>
          )}
        </div>
        <button style={{
          background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF',
          fontSize: 14, padding: '2px 6px', borderRadius: 4,
        }}>···</button>
      </div>

      {/* Definition */}
      <div style={{ fontSize: 13, color: '#6B7280', marginBottom: 8 }}>{definition}</div>

      {/* Big number */}
      {loading ? (
        <div style={{ fontSize: 32, fontWeight: 700, color: '#E5E7EB', marginBottom: 8 }}>—</div>
      ) : error ? (
        <div style={{ fontSize: 13, color: '#EF4444' }}>Failed to load</div>
      ) : empty ? (
        <div style={{ fontSize: 13, color: '#9CA3AF', marginTop: 8 }}>
          {emptyMessage ?? 'No data in this period'}
        </div>
      ) : (
        <>
          <div style={{ fontSize: 32, fontWeight: 700, color: '#111827', marginBottom: 8 }}>{bigNumber}</div>
          <LineChartInCard
            data={data} compareData={compareData}
            height={140} formatY={formatY} formatTooltip={formatTooltip} color={color}
          />
        </>
      )}
    </div>
  );
}
