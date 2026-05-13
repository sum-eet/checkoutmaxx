"use client";

import { Card, BlockStack, Text, Button, Box } from "@shopify/polaris";

export interface UpgradeKpiCardProps {
  title: string;
  requiredTier: "standard" | "plus";
}

export function UpgradeKpiCard({ title, requiredTier }: UpgradeKpiCardProps) {
  const tierLabel = requiredTier === "plus" ? "Plus" : "Standard";

  // TODO(PRD-3): navigate to billing page via App Bridge router or upgrade modal
  function handleUpgrade() {
    console.log("[PRD-5:UpgradeKpiCard] upgrade clicked tier=%s", requiredTier);
    // Placeholder — billing nav wired in PRD-3
    if (typeof window !== "undefined") {
      (window as any).shopify?.toast?.show(`Upgrade to ${tierLabel} to unlock this feature`);
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
