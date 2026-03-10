"use client";

import {
  Page,
  Layout,
  Card,
  TextField,
  Button,
  SettingToggle,
  Text,
  Banner,
  BlockStack,
  InlineStack,
  Divider,
} from "@shopify/polaris";
import { useState } from "react";

export default function SettingsPage() {
  const [alertEmail, setAlertEmail] = useState("");
  const [slackWebhook, setSlackWebhook] = useState("");
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [abandonmentEnabled, setAbandonmentEnabled] = useState(true);
  const [discountEnabled, setDiscountEnabled] = useState(true);
  const [extensionEnabled, setExtensionEnabled] = useState(true);
  const [paymentEnabled, setPaymentEnabled] = useState(true);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  return (
    <Page title="Settings">
      <Layout>
        {saved && (
          <Layout.Section>
            <Banner tone="success">
              <Text as="p">Settings saved successfully.</Text>
            </Banner>
          </Layout.Section>
        )}

        {/* Notifications */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Notifications
              </Text>

              <BlockStack gap="300">
                <TextField
                  label="Alert email"
                  type="email"
                  value={alertEmail}
                  onChange={setAlertEmail}
                  placeholder="you@yourstore.com"
                  autoComplete="email"
                  helpText="Alerts will be sent here when issues are detected."
                />
                <SettingToggle
                  enabled={emailEnabled}
                  action={{
                    content: emailEnabled ? "Disable" : "Enable",
                    onAction: () => setEmailEnabled(!emailEnabled),
                  }}
                >
                  <Text as="p">Email alerts are {emailEnabled ? "enabled" : "disabled"}.</Text>
                </SettingToggle>
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <TextField
                  label="Slack webhook URL"
                  value={slackWebhook}
                  onChange={setSlackWebhook}
                  placeholder="https://hooks.slack.com/services/..."
                  autoComplete="off"
                  helpText="Create an Incoming Webhook in your Slack app settings."
                />
                <InlineStack gap="200">
                  <SettingToggle
                    enabled={slackEnabled}
                    action={{
                      content: slackEnabled ? "Disable" : "Enable",
                      onAction: () => setSlackEnabled(!slackEnabled),
                    }}
                  >
                    <Text as="p">Slack alerts are {slackEnabled ? "enabled" : "disabled"}.</Text>
                  </SettingToggle>
                </InlineStack>
              </BlockStack>

              <Button variant="primary" onClick={handleSave}>
                Save notification settings
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Alert toggles */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Alert Types
              </Text>
              <Text as="p" tone="subdued">
                Toggle which conditions trigger an alert.
              </Text>

              <SettingToggle
                enabled={abandonmentEnabled}
                action={{
                  content: abandonmentEnabled ? "Disable" : "Enable",
                  onAction: () => setAbandonmentEnabled(!abandonmentEnabled),
                }}
              >
                <Text as="p" fontWeight="semibold">Abandonment spike</Text>
                <Text as="p" tone="subdued">
                  Alert when checkout CVR drops more than 20% below your 7-day baseline.
                </Text>
              </SettingToggle>

              <SettingToggle
                enabled={discountEnabled}
                action={{
                  content: discountEnabled ? "Disable" : "Enable",
                  onAction: () => setDiscountEnabled(!discountEnabled),
                }}
              >
                <Text as="p" fontWeight="semibold">Failed discount codes</Text>
                <Text as="p" tone="subdued">
                  Alert when a discount code fails 3+ times in one hour.
                </Text>
              </SettingToggle>

              <SettingToggle
                enabled={extensionEnabled}
                action={{
                  content: extensionEnabled ? "Disable" : "Enable",
                  onAction: () => setExtensionEnabled(!extensionEnabled),
                }}
              >
                <Text as="p" fontWeight="semibold">Checkout extension errors</Text>
                <Text as="p" tone="subdued">
                  Alert immediately when a checkout UI extension throws an error.
                </Text>
              </SettingToggle>

              <SettingToggle
                enabled={paymentEnabled}
                action={{
                  content: paymentEnabled ? "Disable" : "Enable",
                  onAction: () => setPaymentEnabled(!paymentEnabled),
                }}
              >
                <Text as="p" fontWeight="semibold">Payment failure spike</Text>
                <Text as="p" tone="subdued">
                  Alert when more than 15% of payment attempts fail in 30 minutes.
                </Text>
              </SettingToggle>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Pixel health */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Pixel Health
              </Text>
              <Text as="p">
                Status: <Text as="span" tone="success" fontWeight="semibold">Connected</Text>
              </Text>
              <Text as="p" tone="subdued">
                The CheckoutMaxx pixel is active on your store and sending events.
                Go through a test checkout to confirm events are flowing.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
