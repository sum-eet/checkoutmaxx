import { Page, SkeletonPage, SkeletonBodyText, SkeletonDisplayText, Card, BlockStack, InlineGrid } from "@shopify/polaris";

export default function AnalyticsLoading() {
  return (
    <SkeletonPage primaryAction>
      <BlockStack gap="400">
        <InlineGrid columns={3} gap="400">
          <Card>
            <BlockStack gap="200">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={1} />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={1} />
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <SkeletonDisplayText size="small" />
              <SkeletonBodyText lines={1} />
            </BlockStack>
          </Card>
        </InlineGrid>
        <Card>
          <SkeletonBodyText lines={8} />
        </Card>
      </BlockStack>
    </SkeletonPage>
  );
}
