'use client';

import { Page, Card, BlockStack, Text } from '@shopify/polaris';

export default function BillingPage() {
  console.log('[CMX billing/page] render — free plan, no UI controls');
  return (
    <Page title="Billing">
      <Card>
        <BlockStack gap="200">
          <Text variant="headingMd" as="h2">CouponMaxx is free</Text>
          <Text tone="subdued" as="p">
            No subscription, no charges. All features included.
          </Text>
        </BlockStack>
      </Card>
    </Page>
  );
}
