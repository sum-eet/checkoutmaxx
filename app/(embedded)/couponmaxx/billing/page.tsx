'use client';

import { useState, useEffect, useCallback } from 'react';
import { Banner, BlockStack, Button, Card, InlineStack, Page, Spinner, Text, Badge } from '@shopify/polaris';
import { fetcher } from '@/lib/admin-fetch';

type BillingStatus = {
  plan: 'free' | 'pro';
  status: string | null;
  subscriptionId: string | null;
  trialEndsAt: string | null;
};

export default function BillingPage() {
  const [s, setS] = useState<BillingStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setS(await fetcher('/api/couponmaxx/billing/status'));
      setErr(null);
    } catch (e: any) {
      setErr(e.message ?? 'Failed to load');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function upgrade() {
    setBusy(true);
    const shop = new URLSearchParams(window.location.search).get('shop') ?? '';
    window.top!.location.href = `/api/billing/create?shop=${encodeURIComponent(shop)}`;
  }

  async function cancel() {
    if (!confirm('Cancel Pro subscription? You will return to the Free plan.')) return;
    setBusy(true);
    try {
      await fetcher('/api/billing/cancel', { method: 'POST' });
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!s) {
    return (
      <Page title="Billing">
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Spinner size="small" />
        </div>
      </Page>
    );
  }

  const isPro = s.plan === 'pro' && s.status === 'ACTIVE';

  return (
    <Page title="Billing">
      <BlockStack gap="400">
        {err && <Banner tone="critical" onDismiss={() => setErr(null)}>{err}</Banner>}

        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" align="space-between">
              <Text variant="headingMd" as="h2">Current plan</Text>
              <Badge tone={isPro ? 'success' : 'info'}>{isPro ? 'Pro' : 'Free'}</Badge>
            </InlineStack>
            {s.trialEndsAt && (
              <Text tone="subdued" as="p">
                Trial ends {new Date(s.trialEndsAt).toLocaleDateString()}
              </Text>
            )}
            {isPro ? (
              <Button variant="primary" tone="critical" onClick={cancel} loading={busy}>
                Cancel subscription
              </Button>
            ) : (
              <Button variant="primary" onClick={upgrade} loading={busy}>
                Upgrade to Pro — $49/mo
              </Button>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text variant="headingSm" as="h3">Pro includes</Text>
            <Text as="p" tone="subdued">
              Unlimited sessions · Full coupon tracking · Priority support · 7-day free trial
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
