'use client';

// CouponMaxx V4 layout
// NavMenu renders 4 items in Shopify's NATIVE left sidebar via App Bridge
// No sidebar HTML is rendered here — zero <nav> or <aside> elements
// The parent app/(embedded)/layout.tsx already provides PolarisProvider + AppProvider

import { NavMenu } from '@shopify/app-bridge-react';
import Link from 'next/link';
import { Header } from '@/components/couponmaxx/Header';

export default function CouponMaxxLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Overrides the parent NavMenu for all /couponmaxx/* routes */}
      <NavMenu>
        <Link href="/couponmaxx/analytics" rel="home">Analytics</Link>
        <Link href="/couponmaxx/sessions">Cart Sessions</Link>
        <Link href="/couponmaxx/coupons">Coupons</Link>
        <Link href="/couponmaxx/notifications">Notifications</Link>
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
          {children}
        </div>
      </div>
    </>
  );
}
