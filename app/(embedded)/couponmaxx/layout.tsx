'use client';

export default function CouponMaxxLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ui-nav-menu>
        <a href="/couponmaxx/analytics" rel="home">Analytics</a>
        <a href="/couponmaxx/notifications">Notifications</a>
        <a href="/couponmaxx/settings">Settings</a>
      </ui-nav-menu>

      <div style={{ padding: '20px 24px' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          {children}
        </div>
      </div>
    </>
  );
}
