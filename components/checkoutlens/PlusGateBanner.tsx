"use client";

import { Banner, BlockStack, Text, Button } from "@shopify/polaris";

export function PlusGateBanner() {
  return (
    <Banner tone="info" title="Coupon Recovery is a Shopify Plus feature">
      <BlockStack gap="200">
        <Text as="p">
          Recover lost checkouts by auto-issuing personalised discount codes to shoppers who hit
          failed coupons. Available on Shopify Plus stores.
        </Text>
        <Button url="https://www.shopify.com/plus" external>
          Learn about Shopify Plus
        </Button>
      </BlockStack>
    </Banner>
  );
}
