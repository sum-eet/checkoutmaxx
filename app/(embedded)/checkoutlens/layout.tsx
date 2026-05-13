"use client";

// Checkout Lens embedded app layout.
// NavMenu wired per README conventions using App Bridge web components.
export default function CheckoutLensLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ui-nav-menu>
        <a href="/checkoutlens" rel="home">Analytics</a>
        <a href="/checkoutlens/recovery">Recovery</a>
      </ui-nav-menu>
      {children}
    </>
  );
}
