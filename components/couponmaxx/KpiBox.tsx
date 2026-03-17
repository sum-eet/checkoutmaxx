'use client';

import { Card, Text, BlockStack } from '@shopify/polaris';

type KpiBoxProps = {
  label: string;
  value: string | number;
  sub1?: string;
  sub2?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
};

export function KpiBox({ label, value, sub1, sub2, active, onClick }: KpiBoxProps) {
  return (
    <div
      onClick={onClick}
      style={{
        flex: 1,
        minWidth: 130,
        cursor: onClick ? 'pointer' : undefined,
        outline: active ? '1.5px solid #0EA5E9' : undefined,
        borderRadius: 8,
        background: active ? '#F0F9FF' : undefined,
      }}
    >
      <Card>
        <BlockStack gap="100">
          <Text variant="bodySm" tone="subdued" as="p">{label}</Text>
          <Text variant="headingXl" as="p">{String(value)}</Text>
          {sub1 && <Text variant="bodySm" tone="subdued" as="p">{sub1}</Text>}
          {sub2 && <Text variant="bodySm" tone="subdued" as="span">{sub2}</Text>}
        </BlockStack>
      </Card>
    </div>
  );
}
