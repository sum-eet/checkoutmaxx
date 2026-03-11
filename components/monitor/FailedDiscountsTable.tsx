"use client";
import { Card, Text, IndexTable, Badge, BlockStack } from "@shopify/polaris";

type FailedDiscount = {
  code: string;
  count: number;
  lastSeen: string;
  errorMessage: string | null;
};

interface Props {
  discounts: FailedDiscount[];
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function FailedDiscountsTable({ discounts }: Props) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Failed Discount Codes
        </Text>
        {discounts.length === 0 ? (
          <Text as="p" tone="subdued">
            No failed discount codes in this time range.
          </Text>
        ) : (
          <IndexTable
            resourceName={{ singular: "code", plural: "codes" }}
            itemCount={discounts.length}
            headings={[
              { title: "Code" },
              { title: "Failures" },
              { title: "Last seen" },
            ]}
            selectable={false}
          >
            {discounts.map((d, i) => (
              <IndexTable.Row key={d.code} id={d.code} position={i}>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="semibold">
                    {d.code}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={d.count >= 3 ? "critical" : "warning"}>
                    {String(d.count)}×
                  </Badge>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" tone="subdued">
                    {timeAgo(d.lastSeen)}
                  </Text>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </BlockStack>
    </Card>
  );
}
