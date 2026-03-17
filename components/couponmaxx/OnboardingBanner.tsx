'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'cm_onboarding_dismissed';

type Step = {
  title: string;
  description: string;
  cta: string;
  href: string;
};

const STEPS: Step[] = [
  {
    title: 'Pixel is tracking',
    description: 'Your cart pixel is active and capturing coupon events in real time.',
    cta: 'View sessions',
    href: '/couponmaxx/sessions',
  },
  {
    title: 'Review your coupon codes',
    description: 'See which codes are broken, degraded, or healthy in the Coupons tab.',
    cta: 'View coupons',
    href: '/couponmaxx/coupons',
  },
  {
    title: 'Set up alerts',
    description: 'Get notified when a coupon code breaks or customer activity spikes.',
    cta: 'Configure alerts',
    href: '/couponmaxx/notifications',
  },
];

export function OnboardingBanner() {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {}
    setDismissed(true);
  };

  // Don't render until we know the dismissed state (avoids flash)
  if (dismissed === null || dismissed) return null;

  return (
    <div style={{
      background: '#EFF6FF',
      border: '1px solid #BFDBFE',
      borderRadius: 8,
      padding: '16px 20px',
      position: 'relative',
    }}>
      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        aria-label="Dismiss setup guide"
        style={{
          position: 'absolute', top: 12, right: 12,
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#6B7280', fontSize: 16, lineHeight: 1, padding: 4,
        }}
      >
        ×
      </button>

      <div style={{ fontSize: 13, fontWeight: 600, color: '#1D4ED8', marginBottom: 12 }}>
        Get started with CouponMaxx
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {STEPS.map((step, i) => (
          <div key={i} style={{
            background: '#FFFFFF',
            border: '1px solid #BFDBFE',
            borderRadius: 6,
            padding: '12px 14px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                width: 20, height: 20, borderRadius: '50%',
                background: '#1D4ED8', color: '#FFFFFF',
                fontSize: 11, fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                {i + 1}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{step.title}</span>
            </div>
            <p style={{ fontSize: 12, color: '#6B7280', margin: '0 0 8px', lineHeight: 1.5 }}>
              {step.description}
            </p>
            <a
              href={step.href}
              style={{
                fontSize: 12, color: '#1D4ED8', fontWeight: 500,
                textDecoration: 'none',
              }}
            >
              {step.cta} →
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}
