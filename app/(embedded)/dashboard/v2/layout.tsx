'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const NAV_ITEMS = [
  { label: 'Overview', href: '/dashboard/v2/overview' },
  { label: 'Cart Sessions', href: '/dashboard/v2/cart' },
  { label: 'Cart Performance', href: '/dashboard/v2/performance' },
  { label: 'Discounts', href: '/dashboard/v2/discounts' },
  { label: 'Notifications', href: '/dashboard/v2/notifications' },
];

export default function V2Layout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={{ display: 'flex', minHeight: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      {/* Sidebar */}
      <nav style={{
        width: 220,
        flexShrink: 0,
        background: '#f6f6f7',
        borderRight: '1px solid #e1e3e5',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 0',
      }}>
        {/* Header */}
        <div style={{
          padding: '0 16px 16px',
          borderBottom: '1px solid #e1e3e5',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#202223' }}>CheckoutMaxx</span>
          <span style={{
            fontSize: 10,
            background: '#e4e5e7',
            color: '#6d7175',
            borderRadius: 4,
            padding: '2px 5px',
            fontWeight: 500,
          }}>
            V2
          </span>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: '0 8px' }}>
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'block',
                  padding: '8px 12px',
                  borderRadius: 6,
                  marginBottom: 2,
                  fontSize: 14,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? '#202223' : '#6d7175',
                  background: isActive ? '#e4e5e7' : 'transparent',
                  textDecoration: 'none',
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Settings at bottom */}
        <div style={{ padding: '8px 8px 0', borderTop: '1px solid #e1e3e5', marginTop: 8 }}>
          <Link
            href="/settings"
            style={{
              display: 'block',
              padding: '8px 12px',
              borderRadius: 6,
              fontSize: 14,
              color: '#6d7175',
              textDecoration: 'none',
            }}
          >
            Settings
          </Link>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        {children}
      </main>
    </div>
  );
}
