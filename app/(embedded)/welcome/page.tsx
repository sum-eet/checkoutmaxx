"use client";

import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Banner,
  Button,
} from "@shopify/polaris";

export default function WelcomePage() {
  return (
    <Page title="Welcome to CouponMaxx">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Banner tone="success">
              <Text as="p">
                Your cart pixel is active. We&apos;re already tracking coupon usage across your store.
              </Text>
            </Banner>

            <InlineGrid columns={3} gap="400">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Broken coupon alerts
                  </Text>
                  <Text as="p" tone="subdued">
                    Get notified the moment a coupon code starts failing so you can fix it before customers give up.
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Coupon analytics
                  </Text>
                  <Text as="p" tone="subdued">
                    See success rates, usage trends, and attributed revenue for every coupon code in one place.
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Code performance tracking
                  </Text>
                  <Text as="p" tone="subdued">
                    Understand which codes drive conversions, which fail silently, and which customers abandon after a failed attempt.
                  </Text>
                </BlockStack>
              </Card>
            </InlineGrid>

            <Banner tone="info">
              <Text as="p">
                Data starts populating as customers visit your cart. Check back in a few hours to see your first sessions.
              </Text>
            </Banner>

            <InlineStack gap="300">
              <Button variant="primary" url="/couponmaxx/analytics">
                View analytics
              </Button>
              <Button url="/couponmaxx/notifications">Configure alerts</Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
