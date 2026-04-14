"use client";
import { SkeletonPage, SkeletonBodyText, SkeletonDisplayText, Card, BlockStack } from "@shopify/polaris";

export default function CouponsLoading() {
  return (
    <SkeletonPage primaryAction>
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <SkeletonDisplayText size="small" />
            <SkeletonBodyText lines={6} />
          </BlockStack>
        </Card>
        <Card>
          <SkeletonBodyText lines={6} />
        </Card>
      </BlockStack>
    </SkeletonPage>
  );
}
