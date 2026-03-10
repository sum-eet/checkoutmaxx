"use client";

import { Page, Layout, Card, Text, Banner, Button } from "@shopify/polaris";

export default function InstallPage() {
  return (
    <Page narrowWidth>
      <Layout>
        <Layout.Section>
          <Banner tone="success">
            <Text as="p" fontWeight="bold">
              Your store is now being monitored.
            </Text>
          </Banner>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <Text as="h2" variant="headingLg">
              Welcome to CheckoutMaxx
            </Text>
            <Text as="p">
              CheckoutMaxx is now active on your store. We are collecting checkout
              events and will alert you the moment something breaks — with an
              exact action to fix it.
            </Text>
            <Text as="h3" variant="headingMd">
              What happens next
            </Text>
            <Text as="p">
              1. Your checkout is now being monitored in real time.
            </Text>
            <Text as="p">
              2. For the first 48 hours, CheckoutMaxx learns your store&apos;s normal
              checkout patterns (the learning period).
            </Text>
            <Text as="p">
              3. After 48 hours, alerts will activate automatically.
            </Text>
            <Text as="p">
              Configure your notification email and Slack webhook in Settings so
              alerts reach you instantly.
            </Text>
            <Button url="/settings" variant="primary">
              Configure notifications
            </Button>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
