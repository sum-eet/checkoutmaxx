'use client';

import { Card, Text, SkeletonDisplayText, Select, BlockStack, InlineStack } from '@shopify/polaris';
import { LineChartInCard } from './LineChartInCard';

type Dropdown = {
  value: string;
  options: { label: string; value: string }[];
  onChange: (v: string) => void;
};

type DataPoint = { date: string; value: number };

type Props = {
  title: string;
  titleDropdowns?: Dropdown[];
  definition: string;
  bigNumber: string;
  data: DataPoint[];
  compareData?: DataPoint[];
  formatY?: (v: number) => string;
  formatTooltip?: (v: number, date: string) => string;
  color?: string;
  emptyMessage?: string;
  loading?: boolean;
  error?: boolean;
};

export function MetricCard({
  title, titleDropdowns, definition, bigNumber, data, compareData,
  formatY, formatTooltip, color = '#0EA5E9', emptyMessage, loading, error,
}: Props) {
  const empty = !loading && !error && (!data || data.length === 0 || data.every((d) => d.value === 0));

  return (
    <Card>
      <BlockStack gap="100">
        {/* Title row with optional dropdowns */}
        <InlineStack gap="200" blockAlign="center" wrap>
          <Text variant="bodyMd" fontWeight="semibold" as="span">{title}</Text>
          {titleDropdowns?.map((dd, i) => (
            <Select
              key={i}
              label=""
              labelHidden
              options={dd.options}
              value={dd.value}
              onChange={dd.onChange}
            />
          ))}
        </InlineStack>

        {/* Definition */}
        <Text variant="bodySm" tone="subdued" as="p">{definition}</Text>

        {/* Big number / skeleton / error / empty */}
        {loading ? (
          <SkeletonDisplayText size="large" />
        ) : error ? (
          <Text variant="bodySm" tone="critical" as="p">Failed to load</Text>
        ) : empty ? (
          <Text variant="bodySm" tone="subdued" as="p">{emptyMessage ?? 'No data in this period'}</Text>
        ) : (
          <>
            <Text variant="heading2xl" as="p">{bigNumber}</Text>
            <LineChartInCard
              data={data} compareData={compareData}
              height={140} formatY={formatY} formatTooltip={formatTooltip} color={color}
            />
          </>
        )}
      </BlockStack>
    </Card>
  );
}
