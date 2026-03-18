'use client';

export default function CouponMaxxLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ui-nav-menu>
        <a href="/couponmaxx/analytics" rel="home">Analytics</a>
        <a href="/couponmaxx/sessions">Cart Sessions</a>
        <a href="/couponmaxx/coupons">Coupons</a>
        <a href="/couponmaxx/notifications">Notifications</a>
      </ui-nav-menu>

      <div style={{
        minHeight: '100vh',
        background: '#F1F1F1',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        <div style={{ padding: '20px 24px' }}>
          <div style={{ maxWidth: 1000, margin: '0 auto' }}>
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
