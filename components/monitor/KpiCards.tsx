"use client";
import { Card, Text, Badge, BlockStack, InlineStack } from "@shopify/polaris";

interface Props {
  checkoutsStarted: number;
  completedOrders: number;
  cvr: number;
  cvrDelta: number | null;
  baselineCvr: number | null;
}

export function KpiCards({ checkoutsStarted, completedOrders, cvr, cvrDelta }: Props) {
  const cvrPct = Math.round(cvr * 100);
  const deltaPts = cvrDelta !== null ? Math.round(cvrDelta * 100) : null;
  const deltaTone = deltaPts === null ? undefined : deltaPts >= 0 ? "success" : "critical";
  const deltaLabel =
    deltaPts !== null ? `${deltaPts >= 0 ? "+" : ""}${deltaPts}pts vs baseline` : null;

  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}
    >
      <Card>
        <BlockStack gap="100">
          <Text as="p" tone="subdued" variant="bodySm">
            Checkouts Started
          </Text>
          <Text as="p" variant="headingXl" fontWeight="bold">
            {checkoutsStarted}
          </Text>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="100">
          <Text as="p" tone="subdued" variant="bodySm">
            Completed Orders
          </Text>
          <Text as="p" variant="headingXl" fontWeight="bold">
            {completedOrders}
          </Text>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="200">
          <Text as="p" tone="subdued" variant="bodySm">
            Checkout CVR
          </Text>
          <InlineStack gap="200" blockAlign="center">
            <Text as="p" variant="headingXl" fontWeight="bold">
              {cvrPct}%
            </Text>
            {deltaLabel && <Badge tone={deltaTone}>{deltaLabel}</Badge>}
          </InlineStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="100">
          <Text as="p" tone="subdued" variant="bodySm">
            Revenue at Risk
          </Text>
          <Text as="p" variant="headingXl" fontWeight="bold">
            $0
          </Text>
          <Text as="p" tone="subdued" variant="bodySm">
            All clear
          </Text>
        </BlockStack>
      </Card>
    </div>
  );
}
