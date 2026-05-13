"use client";

import { Card, BlockStack, Text, InlineStack, Badge, Box, SkeletonDisplayText } from "@shopify/polaris";
import { SparkLineChart } from "@shopify/polaris-viz";

export interface KpiCardProps {
  title: string;
  value: string;
  /** -0.12 = -12%; null = no comparison possible (both periods zero) */
  delta: number | null;
  /** daily data points; < 3 → render empty box */
  sparkline: number[];
  loading?: boolean;
}

export function KpiCard({ title, value, delta, sparkline, loading }: KpiCardProps) {
  // Delta label — cap at ±100%+ per PRD-5 §7
  const deltaLabel =
    delta !== null
      ? delta >= 1
        ? "+100%+"
        : `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`
      : null;

  const deltaTone =
    delta === null
      ? undefined
      : delta > 0
      ? "success"
      : delta < 0
      ? "critical"
      : undefined;

  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" tone="subdued">
          {title}
        </Text>
        {loading ? (
          <SkeletonDisplayText size="medium" />
        ) : (
          <Text as="p" variant="headingXl">
            {value}
          </Text>
        )}
        <InlineStack gap="200" blockAlign="center">
          {deltaLabel !== null && !loading && (
            <Badge tone={deltaTone}>{deltaLabel}</Badge>
          )}
          <Box minWidth="120px" minHeight="32px">
            {!loading && sparkline.length >= 3 ? (
              <SparkLineChart
                data={[
                  {
                    data: sparkline.map((v, i) => ({ key: i, value: v })),
                    name: title,
                  },
                ]}
                accessibilityLabel={`${title} trend sparkline`}
              />
            ) : (
              // Flat empty placeholder — keeps card height consistent
              <Box minHeight="32px" />
            )}
          </Box>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}
