"use client";

import {
  Card,
  BlockStack,
  Text,
  IndexTable,
  EmptyState,
  SkeletonBodyText,
  Pagination,
  InlineStack,
} from "@shopify/polaris";
import type { FailedDiscountRow } from "@/lib/analytics/failedDiscounts";

interface FailedDiscountsCardProps {
  rows: FailedDiscountRow[] | null;
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  error?: boolean;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function FailedDiscountsCard({
  rows,
  total,
  page,
  onPageChange,
  loading,
  error,
}: FailedDiscountsCardProps) {
  if (loading) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Failed discounts</Text>
          <SkeletonBodyText lines={4} />
        </BlockStack>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <BlockStack gap="300">
          <Text as="h2" variant="headingMd">Failed discounts</Text>
          <Text as="p" tone="critical">Failed to load discount data.</Text>
        </BlockStack>
      </Card>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <Card>
        <EmptyState
          heading="We need more data"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <Text as="p">No failed discount codes recorded for this period.</Text>
        </EmptyState>
      </Card>
    );
  }

  const rowMarkup = rows.map((row, index) => (
    <IndexTable.Row id={row.code} key={row.code} position={index}>
      <IndexTable.Cell>
        <Text as="span" fontWeight="semibold">{row.code}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{row.attempts.toLocaleString()}</IndexTable.Cell>
      <IndexTable.Cell>{row.uniqueSessions.toLocaleString()}</IndexTable.Cell>
      <IndexTable.Cell>{formatDate(row.lastSeen)}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" tone="subdued">{row.sampleReason ?? "—"}</Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const pageSize = 25;
  const hasPrev = page > 1;
  const hasNext = page * pageSize < total;

  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">Failed discounts</Text>
        <IndexTable
          resourceName={{ singular: "discount code", plural: "discount codes" }}
          itemCount={rows.length}
          headings={[
            { title: "Code" },
            { title: "Attempts" },
            { title: "Unique sessions" },
            { title: "Last seen" },
            { title: "Sample fail reason" },
          ]}
          selectable={false}
        >
          {rowMarkup}
        </IndexTable>
        {(hasPrev || hasNext) && (
          <InlineStack align="center">
            <Pagination
              hasPrevious={hasPrev}
              hasNext={hasNext}
              onPrevious={() => onPageChange(page - 1)}
              onNext={() => onPageChange(page + 1)}
            />
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}
