'use client';

// CouponMaxx V4 layout
// NavMenu renders 4 items in Shopify's NATIVE left sidebar via App Bridge
// Uses <a> tags (not Next.js Link) — App Bridge requires native anchors
// Parent layout skips its own NavMenu + LiveBanner on /couponmaxx/* routes

import { NavMenu } from '@shopify/app-bridge-react';
import { Header } from '@/components/couponmaxx/Header';

export default function CouponMaxxLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <NavMenu>
        <a href="/couponmaxx/analytics" rel="home">Analytics</a>
        <a href="/couponmaxx/sessions">Cart Sessions</a>
        <a href="/couponmaxx/coupons">Coupons</a>
        <a href="/couponmaxx/notifications">Notifications</a>
      </NavMenu>

      <div style={{
        minHeight: '100vh',
        background: '#F1F1F1',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <Header />
        <div style={{ flex: 1, padding: '20px 24px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
