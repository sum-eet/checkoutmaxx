'use client';

import { useState, useEffect } from 'react';
import { BlockStack, Button, Card, InlineGrid, InlineStack, Text } from '@shopify/polaris';

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
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text variant="headingSm" fontWeight="semibold" as="h2">
            Get started with CouponMaxx
          </Text>
          <Button variant="plain" onClick={handleDismiss}>Dismiss</Button>
        </InlineStack>

        <InlineGrid columns={3} gap="300">
          {STEPS.map((step, i) => (
            <Card key={i}>
              <BlockStack gap="100">
                <InlineStack gap="200" blockAlign="center">
                  <span style={{
                    width: 20, height: 20, borderRadius: '50%',
                    background: '#1D4ED8', color: '#FFFFFF',
                    fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {i + 1}
                  </span>
                  <Text variant="bodyMd" fontWeight="semibold" as="span">{step.title}</Text>
                </InlineStack>
                <Text variant="bodySm" tone="subdued" as="p">{step.description}</Text>
                <a
                  href={step.href}
                  style={{ fontSize: 12, color: '#1D4ED8', fontWeight: 500, textDecoration: 'none' }}
                >
                  {step.cta} →
                </a>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>
      </BlockStack>
    </Card>
  );
}
