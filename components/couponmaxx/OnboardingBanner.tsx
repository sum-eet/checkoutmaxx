'use client';

import { useState, useEffect } from 'react';
import { Banner, BlockStack, Button, Card, Icon, InlineStack, ProgressBar, Text } from '@shopify/polaris';
import { CheckCircleIcon, AlertCircleIcon } from '@shopify/polaris-icons';

const STORAGE_KEY = 'cm_onboarding_dismissed';

type ExtensionStatus = {
  cartMonitor: boolean;
  checkoutPixel: boolean;
};

type Props = {
  hasData: boolean;
};

export function OnboardingBanner({ hasData }: Props) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [extensions, setExtensions] = useState<ExtensionStatus>({
    cartMonitor: false,
    checkoutPixel: false,
  });

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(STORAGE_KEY) === 'true');
    } catch {
      setDismissed(false);
    }
  }, []);

  // Check extension status via App Bridge
  useEffect(() => {
    async function check() {
      try {
        if (typeof shopify !== 'undefined' && shopify.app?.extensions) {
          const exts = (await shopify.app.extensions()) as unknown as Array<Record<string, unknown>>;
          const cart = exts.find((e) => e['handle'] === 'cart-monitor');
          const pixel = exts.find((e) => e['handle'] === 'checkout-monitor');
          setExtensions({
            cartMonitor: cart?.['status'] === 'active' || cart !== undefined,
            checkoutPixel: pixel?.['status'] === 'active' || pixel !== undefined,
          });
        } else {
          // Fallback: if API not available, assume active to not block
          setExtensions({ cartMonitor: true, checkoutPixel: true });
        }
      } catch {
        setExtensions({ cartMonitor: true, checkoutPixel: true });
      }
    }
    check();
  }, []);

  const handleDismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, 'true'); } catch {}
    setDismissed(true);
  };

  if (dismissed === null || dismissed) return null;

  // If hasData is true, data is flowing — force all checks green
  const cartMonitorActive = hasData ? true : extensions.cartMonitor;
  const checkoutPixelActive = hasData ? true : extensions.checkoutPixel;

  const steps = [
    {
      label: 'Cart monitor',
      done: cartMonitorActive,
      ok: 'Active on your storefront',
      fail: 'Not active — enable the Cart Monitor block in your theme',
    },
    {
      label: 'Checkout pixel',
      done: checkoutPixelActive,
      ok: 'Tracking checkout events',
      fail: 'Not detected — try reinstalling the app',
    },
    {
      label: 'Receiving data',
      done: hasData,
      ok: 'Data is flowing into your dashboard',
      fail: 'Waiting for first customer sessions (usually a few hours)',
    },
  ];

  const doneCount = steps.filter(s => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="100">
            <Text variant="headingMd" as="h2">
              {allDone ? 'Setup complete' : 'Getting started with CouponMaxx'}
            </Text>
            <Text variant="bodySm" tone="subdued" as="p">
              {doneCount} of {steps.length} completed
            </Text>
          </BlockStack>
          {allDone && (
            <Button variant="plain" onClick={handleDismiss}>Dismiss</Button>
          )}
        </InlineStack>

        <ProgressBar progress={(doneCount / steps.length) * 100} tone="primary" size="small" />

        {steps.map((step) => (
          <InlineStack key={step.label} gap="300" blockAlign="start">
            <div style={{ flexShrink: 0, marginTop: 2 }}>
              <Icon
                source={step.done ? CheckCircleIcon : AlertCircleIcon}
                tone={step.done ? 'success' : 'subdued'}
              />
            </div>
            <BlockStack gap="050">
              <Text variant="bodyMd" fontWeight="semibold" as="span">{step.label}</Text>
              <Text variant="bodySm" tone={step.done ? 'subdued' : 'caution'} as="span">
                {step.done ? step.ok : step.fail}
              </Text>
            </BlockStack>
          </InlineStack>
        ))}
      </BlockStack>
    </Card>
  );
}
