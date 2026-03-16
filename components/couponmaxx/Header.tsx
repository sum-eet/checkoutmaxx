'use client';

// CouponMaxx header bar — renders in the page content area (NOT a sidebar)
// Replace the 32×32 blue square with the actual SVG logo mark when available

import { useShop } from '@/hooks/useShop';

const CUSTOM_NAMES: Record<string, string> = {
  'jg2svv-pc.myshopify.com': 'Dr.Water',
};

export function Header() {
  const shop = useShop();
  const storeName = shop
    ? (CUSTOM_NAMES[shop] ?? shop.replace('.myshopify.com', ''))
    : '…';

  return (
    <>
      <style>{`
        @keyframes cmPulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .cm-live-dot { animation: cmPulse 2s infinite; }
      `}</style>
      <div style={{
        width: '100%', height: 56, background: '#FFFFFF',
        borderBottom: '1px solid #E3E3E3',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', boxSizing: 'border-box', flexShrink: 0,
      }}>
        {/* Left: logo + wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* TODO: replace with actual SVG logo */}
          <div style={{ width: 32, height: 32, borderRadius: 6, background: '#0EA5E9', flexShrink: 0 }} />
          <span style={{ fontSize: 15, fontWeight: 600, color: '#111827' }}>CouponMaxx</span>
        </div>

        {/* Center: nav hint */}
        <div style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
          fontSize: 13, color: '#9CA3AF', pointerEvents: 'none',
        }}>
          Use the menu on the left to navigate
        </div>

        {/* Right: Live pill + store name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: '#F0FDF4', border: '1px solid #BBF7D0',
            borderRadius: 20, padding: '4px 10px',
          }}>
            <span className="cm-live-dot" style={{
              width: 8, height: 8, borderRadius: '50%', background: '#22C55E', display: 'block',
            }} />
            <span style={{ fontSize: 12, color: '#15803D', fontWeight: 500 }}>Live</span>
          </div>
          <span style={{ fontSize: 13, color: '#374151', fontWeight: 500 }}>{storeName}</span>
        </div>
      </div>
    </>
  );
}
