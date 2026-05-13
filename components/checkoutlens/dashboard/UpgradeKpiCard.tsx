"use client";

import { Card, BlockStack, Text, Button, Box } from "@shopify/polaris";

export interface UpgradeKpiCardProps {
  title: string;
  requiredTier?: "standard" | "plus";
  onUpgrade?: () => void;
}

export function UpgradeKpiCard({ title, requiredTier = "plus", onUpgrade }: UpgradeKpiCardProps) {
  const tierLabel = requiredTier === "plus" ? "Plus" : "Standard";

  // PRD-3: navigate to billing page (replaces TODO(PRD-3) marker)
  function handleUpgrade() {
    console.log("[PRD-3:UpgradeKpiCard] upgrade clicked tier=%s", requiredTier);
    if (onUpgrade) {
      onUpgrade();
    } else if (typeof window !== "undefined") {
      window.top!.location.href = "/checkoutlens/billing";
    }
  }

  return (
    <Card>
      <BlockStack gap="200">
        <Text as="p" tone="subdued">
          {title}
        </Text>
        {/* Same height as KpiCard headingXl so InlineGrid stays aligned */}
        <Box minHeight="44px">
          <Text as="p" variant="headingXl" tone="subdued">
            —
          </Text>
        </Box>
        <Box>
          <Button size="slim" onClick={handleUpgrade}>
            Unlock with {tierLabel}
          </Button>
        </Box>
      </BlockStack>
    </Card>
  );
}
