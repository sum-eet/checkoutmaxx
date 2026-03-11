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
    <Page title="Welcome to CheckoutMaxx">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Banner tone="success">
              <Text as="p">
                Your checkout pixel is active. We&apos;re already monitoring for issues.
              </Text>
            </Banner>

            <InlineGrid columns={3} gap="400">
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Abandonment spikes
                  </Text>
                  <Text as="p" tone="subdued">
                    We alert you when checkout CVR drops 20%+ below your 7-day baseline.
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Broken discount codes
                  </Text>
                  <Text as="p" tone="subdued">
                    When a promo code fails 3+ times in an hour, you get an alert with the exact
                    code.
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">
                    Payment failures
                  </Text>
                  <Text as="p" tone="subdued">
                    If payment failures spike above 15%, we flag it immediately.
                  </Text>
                </BlockStack>
              </Card>
            </InlineGrid>

            <Banner tone="info">
              <Text as="p">
                Learning period: Alerts activate in ~48 hours once we&apos;ve learned your
                store&apos;s baseline. Live data is available immediately.
              </Text>
            </Banner>

            <InlineStack gap="300">
              <Button variant="primary" url="/dashboard/converted">
                View your dashboard
              </Button>
              <Button url="/settings">Configure alerts</Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
