"use client";

import { InlineGrid, Card, BlockStack, Text, SkeletonDisplayText } from "@shopify/polaris";
import type { KpiPeriod } from "@/lib/analytics/kpis";

interface KpiRowProps {
  current: KpiPeriod | null;
  previous: KpiPeriod | null;
  loading?: boolean;
}

function delta(curr: number, prev: number): { sign: "+" | "−" | ""; value: string; tone: "success" | "critical" | "subdued" } {
  if (prev === 0 && curr === 0) return { sign: "", value: "", tone: "subdued" };
  if (prev === 0) return { sign: "+", value: "∞", tone: "success" };
  const pct = ((curr - prev) / prev) * 100;
  const abs = Math.abs(pct).toFixed(1);
  if (pct > 0) return { sign: "+", value: `${abs}%`, tone: "success" };
  if (pct < 0) return { sign: "−", value: `${abs}%`, tone: "critical" };
  return { sign: "", value: "0%", tone: "subdued" };
}

interface KpiCardProps {
  title: string;
  value: string;
  change: ReturnType<typeof delta>;
  loading?: boolean;
}

function KpiCard({ title, value, change, loading }: KpiCardProps) {
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{title}</Text>
        {loading ? (
          <SkeletonDisplayText size="small" />
        ) : (
          <>
            <Text as="p" variant="headingXl">{value}</Text>
            {change.value && (
              <Text as="p" variant="bodySm" tone={change.tone}>
                {change.sign}{change.value} vs prev period
              </Text>
            )}
          </>
        )}
      </BlockStack>
    </Card>
  );
}

export default function KpiRow({ current, previous, loading }: KpiRowProps) {
  const c = current ?? { convRate: 0, aov: 0, shippingRev: 0, attempts: 0 };
  const p = previous ?? { convRate: 0, aov: 0, shippingRev: 0, attempts: 0 };

  return (
    <InlineGrid columns={{ xs: 1, sm: 2, lg: 4 }} gap="400">
      <KpiCard
        title="Conversion rate"
        value={`${(c.convRate * 100).toFixed(1)}%`}
        change={delta(c.convRate, p.convRate)}
        loading={loading}
      />
      <KpiCard
        title="Avg. order value"
        value={`$${c.aov.toFixed(2)}`}
        change={delta(c.aov, p.aov)}
        loading={loading}
      />
      <KpiCard
        title="Shipping revenue"
        value={`$${c.shippingRev.toFixed(2)}`}
        change={delta(c.shippingRev, p.shippingRev)}
        loading={loading}
      />
      <KpiCard
        title="Checkout attempts"
        value={c.attempts.toLocaleString()}
        change={delta(c.attempts, p.attempts)}
        loading={loading}
      />
    </InlineGrid>
  );
}
