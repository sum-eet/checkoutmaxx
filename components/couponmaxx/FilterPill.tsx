'use client';

import { useState, useRef, useEffect } from 'react';

type FilterPillProps = {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  icon?: React.ReactNode;
};

export function FilterPill({ label, value, options, onChange, icon }: FilterPillProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = !!value;
  const displayLabel = active ? (options.find((o) => o.value === value)?.label ?? label) : label;

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', border: active ? '1px solid #BFDBFE' : '1px solid #D1D5DB',
          borderRadius: 6, background: active ? '#EFF6FF' : '#FFFFFF',
          color: active ? '#1D4ED8' : '#374151', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {icon && <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>}
        {displayLabel}
        {active && (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            style={{ marginLeft: 2, fontSize: 14, lineHeight: 1, color: '#1D4ED8', fontWeight: 700 }}
          >×</span>
        )}
        {!active && <span style={{ fontSize: 10, marginLeft: 2 }}>▾</span>}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100,
          background: '#fff', border: '1px solid #E3E3E3', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)', minWidth: 180, padding: '4px 0',
        }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%', padding: '8px 14px', background: 'none', border: 'none',
                cursor: 'pointer', fontSize: 13, color: '#374151', textAlign: 'left',
                gap: 8,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#F9FAFB'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none'; }}
            >
              <span>{opt.label}</span>
              {opt.value === value && <span style={{ color: '#1D4ED8', fontSize: 13 }}>✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
