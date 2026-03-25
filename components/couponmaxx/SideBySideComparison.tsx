'use client';

import { ReactNode } from 'react';

export type ComparisonRow = {
  label: string;
  leftValue: string;
  rightValue: string;
};

interface SideBySideComparisonProps {
  leftLabel: string;
  rightLabel: string;
  leftIcon: ReactNode;
  rightIcon: ReactNode;
  rows: ComparisonRow[];
  showAmberBanner?: boolean;
  amberMessage?: string;
}

export function SideBySideComparison({
  leftLabel, rightLabel,
  leftIcon, rightIcon,
  rows,
  showAmberBanner, amberMessage,
}: SideBySideComparisonProps) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { label: leftLabel, icon: leftIcon, side: 'left' },
          { label: rightLabel, icon: rightIcon, side: 'right' },
        ].map(({ label, icon, side }) => (
          <div
            key={side}
            style={{
              background: '#fff',
              border: '1px solid #E5E7EB',
              borderRadius: 8,
              overflow: 'hidden',
            }}
          >
            {/* Card header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '12px 16px',
              borderBottom: '1px solid #F3F4F6',
              background: '#FAFAFA',
            }}>
              <span style={{ color: '#6B7280', display: 'flex', alignItems: 'center' }}>{icon}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{label}</span>
            </div>
            {/* Metric rows */}
            <div style={{ padding: '4px 0' }}>
              {rows.map((row) => (
                <div
                  key={row.label}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '8px 16px',
                    borderBottom: '1px solid #F9FAFB',
                  }}
                >
                  <span style={{ fontSize: 13, color: '#6B7280' }}>{row.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#111827' }}>
                    {side === 'left' ? row.leftValue : row.rightValue}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {showAmberBanner && amberMessage && (
        <div style={{
          marginTop: 10,
          padding: '8px 14px',
          background: '#FFFBEB',
          border: '1px solid #FCD34D',
          borderRadius: 6,
          fontSize: 13,
          color: '#92400E',
        }}>
          {amberMessage}
        </div>
      )}
    </div>
  );
}
