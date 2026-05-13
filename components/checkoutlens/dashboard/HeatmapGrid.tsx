"use client";

import { DataTable, EmptyState, Badge, Text, Box } from "@shopify/polaris";
import type { DropOffHeatmap } from "@/lib/analytics/dashboardAggregator";

export interface HeatmapGridProps {
  /** Funnel step keys in order */
  steps: string[];
  segments: Array<"mobile" | "tablet" | "desktop">;
  data: DropOffHeatmap;
  /** True while the parent is loading data */
  loading?: boolean;
}

const STEP_LABELS: Record<string, string> = {
  checkout_started: "Checkout started",
  checkout_contact_info_submitted: "Contact info",
  checkout_shipping_info_submitted: "Shipping info",
  payment_info_submitted: "Payment info",
  checkout_completed: "Order placed",
};

const SEGMENT_LABELS: Record<string, string> = {
  mobile: "Mobile",
  tablet: "Tablet",
  desktop: "Desktop",
};

/** PRD-5 §5 thresholds: <20% success, 20–50% warning, >50% critical */
function dropOffTone(pct: number): "success" | "warning" | "critical" {
  if (pct < 0.2) return "success";
  if (pct <= 0.5) return "warning";
  return "critical";
}

function CellContent({ value }: { value: number | null }) {
  if (value === null) {
    return <Text as="span" tone="subdued">—</Text>;
  }
  const pct = `${(value * 100).toFixed(1)}%`;
  return <Badge tone={dropOffTone(value)}>{pct}</Badge>;
}

export function HeatmapGrid({ steps, segments, data, loading }: HeatmapGridProps) {
  if (!loading && Object.keys(data).length === 0) {
    return (
      <EmptyState heading="Not enough data" image="" />
    );
  }

  // Check if ALL cells are null / 0 (zero-session shop)
  const hasAnyData = steps.some((step) =>
    segments.some((seg) => {
      const cell = data[step]?.[seg];
      return cell !== null && cell !== undefined;
    })
  );

  if (!loading && !hasAnyData) {
    return <EmptyState heading="Not enough data" image="" />;
  }

  const headings = [
    { title: "Funnel step" },
    ...segments.map((seg) => ({ title: SEGMENT_LABELS[seg] })),
  ];

  const rows = steps.map((step) => {
    const stepData = data[step] ?? {};
    return [
      <Text as="span" fontWeight="semibold" key={`step-${step}`}>
        {STEP_LABELS[step] ?? step}
      </Text>,
      ...segments.map((seg) => (
        <CellContent key={`${step}-${seg}`} value={stepData[seg] ?? null} />
      )),
    ];
  });

  return (
    <DataTable
      columnContentTypes={["text", ...segments.map(() => "text" as const)]}
      headings={headings.map((h) => h.title)}
      rows={rows}
    />
  );
}
