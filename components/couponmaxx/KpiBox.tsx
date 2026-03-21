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
      onMouseEnter={(e) => { if (!active && onClick) (e.currentTarget as HTMLElement).style.background = '#FAFBFB'; }}
      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = ''; }}
      style={{
        cursor: onClick ? 'pointer' : undefined,
        borderRadius: 'var(--p-border-radius-300)',
        borderTop: active ? '3px solid #2C6ECB' : '3px solid transparent',
        background: active ? '#F4F6F8' : undefined,
        height: '100%',
        minHeight: 110,
        transition: 'all 0.15s ease',
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
