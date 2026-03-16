'use client';

import { useState, useRef, useEffect } from 'react';

export type DateRange = { start: Date; end: Date };

type Preset = { label: string; days: number | null };

const PRESETS: Preset[] = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Last 12 months', days: 365 },
  { label: 'Custom', days: null },
];

function fmt(d: Date) {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function subDays(d: Date, n: number) {
  return new Date(d.getTime() - n * 86400000);
}

type Props = {
  value: DateRange;
  onChange: (range: DateRange) => void;
  defaultDays?: number;
};

export function DateRangePicker({ value, onChange, defaultDays = 30 }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setCustom(false); }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const rangeMs = value.end.getTime() - value.start.getTime();
  const rangeDays = Math.round(rangeMs / 86400000);
  const preset = PRESETS.find((p) => p.days === rangeDays);
  const label = preset ? preset.label : 'Custom';
  const dateStr = `${fmt(value.start)} – ${fmt(value.end)}`;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', background: '#FFFFFF', border: '1px solid #D1D5DB',
          borderRadius: 6, fontSize: 13, color: '#374151', cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        {label}  {dateStr}  ▾
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 100,
          background: '#fff', border: '1px solid #E3E3E3', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: 200, padding: '4px 0',
        }}>
          {PRESETS.filter((p) => p.days !== null).map((p) => {
            const isActive = preset?.label === p.label;
            return (
              <button
                key={p.label}
                onClick={() => {
                  const end = new Date();
                  onChange({ start: subDays(end, p.days!), end });
                  setOpen(false); setCustom(false);
                }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '8px 14px', background: 'none', border: 'none',
                  cursor: 'pointer', fontSize: 13, color: isActive ? '#1D4ED8' : '#374151', textAlign: 'left',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F9FAFB'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
              >
                {p.label}
                {isActive && <span>✓</span>}
              </button>
            );
          })}
          <div style={{ borderTop: '1px solid #F3F4F6', margin: '4px 0' }} />
          <button
            onClick={() => setCustom((c) => !c)}
            style={{
              display: 'flex', width: '100%', padding: '8px 14px', background: 'none', border: 'none',
              cursor: 'pointer', fontSize: 13, color: custom ? '#1D4ED8' : '#374151', textAlign: 'left',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F9FAFB'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
          >
            Custom
          </button>
          {custom && (
            <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
                style={{ padding: '4px 8px', border: '1px solid #D1D5DB', borderRadius: 4, fontSize: 13 }} />
              <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
                style={{ padding: '4px 8px', border: '1px solid #D1D5DB', borderRadius: 4, fontSize: 13 }} />
              <button
                onClick={() => {
                  if (customStart && customEnd) {
                    onChange({ start: new Date(customStart), end: new Date(customEnd + 'T23:59:59') });
                    setOpen(false); setCustom(false);
                  }
                }}
                style={{
                  padding: '6px', background: '#0EA5E9', color: '#fff', border: 'none',
                  borderRadius: 4, cursor: 'pointer', fontSize: 13,
                }}
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
