"use client";

// Checkout Lens embedded app layout.
// NavMenu wired per README conventions using App Bridge web components.
// PRD-4: SetupGuide mounted above children — polls onboarding state.
import { SetupGuide } from "@/components/checkoutlens/onboarding/SetupGuide";

export default function CheckoutLensLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ui-nav-menu>
        <a href="/checkoutlens" rel="home">Analytics</a>
        <a href="/checkoutlens/recovery">Recovery</a>
        <a href="/checkoutlens/billing">Billing</a>
      </ui-nav-menu>
      {/* PRD-4: persistent setup guide — hidden when allComplete or session-dismissed */}
      <SetupGuide />
      {children}
    </>
  );
}
