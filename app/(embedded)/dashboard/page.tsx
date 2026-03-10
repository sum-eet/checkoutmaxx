"use client";

import {
  Page,
  Layout,
  Card,
  Text,
  Banner,
  SkeletonBodyText,
} from "@shopify/polaris";

export default function DashboardPage() {
  return (
    <Page title="Monitor">
      <Layout>
        <Layout.Section>
          <Banner tone="success">
            <Text as="p">
              CheckoutMaxx is active — your store is being monitored.
            </Text>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <Text as="h2" variant="headingMd">
              Checkout Funnel
            </Text>
            <Text as="p" tone="subdued">
              Dashboard will display once checkout events start flowing. Go through
              a test checkout on your store to generate data.
            </Text>
            <SkeletonBodyText lines={5} />
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
