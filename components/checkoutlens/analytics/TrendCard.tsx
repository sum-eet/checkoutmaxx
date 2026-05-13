"use client";

// PRD-3: TrendCard is wrapped in FeatureGate with feature="trend_chart"

import { Card, BlockStack, Text, EmptyState, SkeletonBodyText } from "@shopify/polaris";
import { LineChart } from "@shopify/polaris-viz";
import type { TrendBucket } from "@/lib/analytics/checkoutTrend";
import { FeatureGate } from "@/components/billing/FeatureGate";
import { UpgradeCard } from "@/components/billing/UpgradeCard";

interface TrendCardProps {
  buckets: TrendBucket[] | null;
  loading?: boolean;
  error?: boolean;
}

function TrendCardInner({ buckets, loading, error }: TrendCardProps) {
  if (loading) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Trends</Text>
          <SkeletonBodyText lines={5} />
        </BlockStack>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Trends</Text>
          <Text as="p" tone="critical">Failed to load trend data.</Text>
        </BlockStack>
      </Card>
    );
  }

  if (!buckets || buckets.length === 0) {
    return (
      <Card>
        <EmptyState
          heading="We need more data"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <Text as="p">Trend data will appear once checkout sessions are recorded.</Text>
        </EmptyState>
      </Card>
    );
  }

  const lineData = [
    {
      name: "AOV",
      data: buckets.map((b) => ({ key: b.t, value: b.aov })),
    },
    {
      name: "Shipping revenue",
      data: buckets.map((b) => ({ key: b.t, value: b.shippingRev })),
    },
    {
      name: "Conversion rate (%)",
      data: buckets.map((b) => ({ key: b.t, value: +(b.convRate * 100).toFixed(2) })),
    },
  ];

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Trends</Text>
        <div style={{ height: 320 }}>
          <LineChart data={lineData} />
        </div>
      </BlockStack>
    </Card>
  );
}

export default function TrendCard(props: TrendCardProps) {
  return (
    <FeatureGate
      feature="trend_chart"
      fallback={<UpgradeCard requiredTier="standard" feature="trend_chart" />}
    >
      <TrendCardInner {...props} />
    </FeatureGate>
  );
}
