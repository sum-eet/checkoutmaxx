"use client";

import { Card, BlockStack, Text, DataTable, EmptyState, SkeletonBodyText } from "@shopify/polaris";
import { FunnelChartNext } from "@shopify/polaris-viz";
import type { FunnelStep } from "@/lib/analytics/checkoutFunnel";

// PRD-3: FunnelCard is free-tier (no gate). Segmentation params are gated server-side via requireFeature("segmentation_filters").

interface FunnelCardProps {
  steps: FunnelStep[] | null;
  loading?: boolean;
  error?: boolean;
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export default function FunnelCard({ steps, loading, error }: FunnelCardProps) {
  if (loading) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Checkout funnel</Text>
          <SkeletonBodyText lines={5} />
        </BlockStack>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Checkout funnel</Text>
          <Text as="p" tone="critical">Failed to load funnel data.</Text>
        </BlockStack>
      </Card>
    );
  }

  if (!steps || steps.every((s) => s.sessions === 0)) {
    return (
      <Card>
        <EmptyState
          heading="We need more data"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <Text as="p">Start a checkout on your store to begin tracking funnel data.</Text>
        </EmptyState>
      </Card>
    );
  }

  const chartData = steps.map((s) => ({
    key: s.label,
    value: s.sessions,
  }));

  const tableRows = steps.map((s) => [
    s.label,
    s.sessions.toLocaleString(),
    pct(s.conversionFromPrev),
    pct(s.conversionFromStart),
  ]);

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Checkout funnel</Text>
        <div style={{ height: 280 }}>
          <FunnelChartNext
            data={[{ data: chartData, name: "Funnel" }]}
          />
        </div>
        <DataTable
          columnContentTypes={["text", "numeric", "numeric", "numeric"]}
          headings={["Step", "Sessions", "% from previous", "% from start"]}
          rows={tableRows}
        />
      </BlockStack>
    </Card>
  );
}
