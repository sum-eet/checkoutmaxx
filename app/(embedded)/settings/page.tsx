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
  InlineGrid,
  Divider,
  RangeSlider,
  Spinner,
  Box,
} from "@shopify/polaris";
import { useState, useEffect } from "react";
import useSWR from "swr";
import { useShop } from "@/hooks/useShop";

interface Settings {
  alertEmail: string;
  slackWebhookUrl: string;
  alertEmailEnabled: boolean;
  alertSlackEnabled: boolean;
  alertAbandonmentEnabled: boolean;
  alertDiscountEnabled: boolean;
  alertExtensionEnabled: boolean;
  alertPaymentEnabled: boolean;
  abandonmentThreshold: number;
  discountFailureMin: number;
  paymentFailureRate: number;
}

const DEFAULTS: Settings = {
  alertEmail: "",
  slackWebhookUrl: "",
  alertEmailEnabled: true,
  alertSlackEnabled: false,
  alertAbandonmentEnabled: true,
  alertDiscountEnabled: true,
  alertExtensionEnabled: true,
  alertPaymentEnabled: true,
  abandonmentThreshold: 0.2,
  discountFailureMin: 3,
  paymentFailureRate: 0.15,
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type KpiData = { checkoutsStarted: number };
type AlertsData = { active: unknown[]; history: unknown[] } | unknown[];
type StatusData = { state: string };

export default function SettingsPage() {
  const shop = useShop();
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [testingSlack, setTestingSlack] = useState(false);
  const [slackTestResult, setSlackTestResult] = useState<"ok" | "fail" | null>(null);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const baseUrl = shop ? `/api/metrics?shop=${shop}` : null;
  const alertsUrl = shop ? `/api/alerts?shop=${shop}` : null;

  const { data: kpiData } = useSWR<KpiData>(
    baseUrl
      ? `${baseUrl}&metric=kpi&start=${thirtyDaysAgo.toISOString()}&end=${now.toISOString()}`
      : null,
    fetcher
  );

  const { data: alertsActiveRaw } = useSWR<unknown[]>(
    alertsUrl ? `${alertsUrl}&tab=active` : null,
    fetcher
  );

  const { data: alertsHistoryRaw } = useSWR<unknown[]>(
    alertsUrl ? `${alertsUrl}&tab=history` : null,
    fetcher
  );

  const { data: statusData } = useSWR<StatusData>(
    baseUrl ? `${baseUrl}&metric=status` : null,
    fetcher
  );

  const issuesCaught = (Array.isArray(alertsActiveRaw) ? alertsActiveRaw.length : 0) +
    (Array.isArray(alertsHistoryRaw) ? alertsHistoryRaw.length : 0);
  const alertsResolved = Array.isArray(alertsHistoryRaw)
    ? alertsHistoryRaw.filter((a) => (a as { resolvedAt?: string | null }).resolvedAt).length
    : 0;

  useEffect(() => {
    if (!shop) return;
    fetch(`/api/settings?shop=${shop}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setSettings(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [shop]);

  function set<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  async function handleSave() {
    if (!shop) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop, ...settings }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Page title="Settings">
        <Layout>
          <Layout.Section>
            <Card>
              <InlineStack align="center">
                <Spinner size="large" />
              </InlineStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
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
        {error && (
          <Layout.Section>
            <Banner tone="critical">
              <Text as="p">{error}</Text>
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
                  value={settings.alertEmail}
                  onChange={(v) => set("alertEmail", v)}
                  placeholder="you@yourstore.com"
                  autoComplete="email"
                  helpText="Alerts will be sent here when issues are detected."
                />
                <SettingToggle
                  enabled={settings.alertEmailEnabled}
                  action={{
                    content: settings.alertEmailEnabled ? "Disable" : "Enable",
                    onAction: () => set("alertEmailEnabled", !settings.alertEmailEnabled),
                  }}
                >
                  <Text as="p">
                    Email alerts are {settings.alertEmailEnabled ? "enabled" : "disabled"}.
                  </Text>
                </SettingToggle>
              </BlockStack>

              <Divider />

              <BlockStack gap="300">
                <TextField
                  label="Slack webhook URL"
                  value={settings.slackWebhookUrl}
                  onChange={(v) => { set("slackWebhookUrl", v); setSlackTestResult(null); }}
                  placeholder="https://hooks.slack.com/services/..."
                  autoComplete="off"
                  helpText="Create an Incoming Webhook in your Slack app settings."
                  connectedRight={
                    <Button
                      loading={testingSlack}
                      disabled={!settings.slackWebhookUrl}
                      onClick={async () => {
                        setTestingSlack(true);
                        setSlackTestResult(null);
                        try {
                          const res = await fetch("/api/settings/test-slack", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ shop, webhookUrl: settings.slackWebhookUrl }),
                          });
                          setSlackTestResult(res.ok ? "ok" : "fail");
                        } catch {
                          setSlackTestResult("fail");
                        } finally {
                          setTestingSlack(false);
                        }
                      }}
                    >
                      Test
                    </Button>
                  }
                />
                {slackTestResult === "ok" && (
                  <Text as="p" tone="success">Test message sent successfully.</Text>
                )}
                {slackTestResult === "fail" && (
                  <Text as="p" tone="critical">Test failed. Check your webhook URL.</Text>
                )}
                <SettingToggle
                  enabled={settings.alertSlackEnabled}
                  action={{
                    content: settings.alertSlackEnabled ? "Disable" : "Enable",
                    onAction: () => set("alertSlackEnabled", !settings.alertSlackEnabled),
                  }}
                >
                  <Text as="p">
                    Slack alerts are {settings.alertSlackEnabled ? "enabled" : "disabled"}.
                  </Text>
                </SettingToggle>
              </BlockStack>

              <Button variant="primary" onClick={handleSave} loading={saving}>
                Save notification settings
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Alert Types */}
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
                enabled={settings.alertAbandonmentEnabled}
                action={{
                  content: settings.alertAbandonmentEnabled ? "Disable" : "Enable",
                  onAction: () =>
                    set("alertAbandonmentEnabled", !settings.alertAbandonmentEnabled),
                }}
              >
                <Text as="p" fontWeight="semibold">
                  Abandonment spike
                </Text>
                <Text as="p" tone="subdued">
                  Alert when checkout CVR drops more than {Math.round(settings.abandonmentThreshold * 100)}% below your baseline.
                </Text>
              </SettingToggle>

              <SettingToggle
                enabled={settings.alertDiscountEnabled}
                action={{
                  content: settings.alertDiscountEnabled ? "Disable" : "Enable",
                  onAction: () => set("alertDiscountEnabled", !settings.alertDiscountEnabled),
                }}
              >
                <Text as="p" fontWeight="semibold">
                  Failed discount codes
                </Text>
                <Text as="p" tone="subdued">
                  Alert when a discount code fails {settings.discountFailureMin}+ times in one hour.
                </Text>
              </SettingToggle>

              <SettingToggle
                enabled={settings.alertExtensionEnabled}
                action={{
                  content: settings.alertExtensionEnabled ? "Disable" : "Enable",
                  onAction: () =>
                    set("alertExtensionEnabled", !settings.alertExtensionEnabled),
                }}
              >
                <Text as="p" fontWeight="semibold">
                  Checkout extension errors
                </Text>
                <Text as="p" tone="subdued">
                  Alert immediately when a checkout UI extension throws an error.
                </Text>
              </SettingToggle>

              <SettingToggle
                enabled={settings.alertPaymentEnabled}
                action={{
                  content: settings.alertPaymentEnabled ? "Disable" : "Enable",
                  onAction: () => set("alertPaymentEnabled", !settings.alertPaymentEnabled),
                }}
              >
                <Text as="p" fontWeight="semibold">
                  Payment failure spike
                </Text>
                <Text as="p" tone="subdued">
                  Alert when more than {Math.round(settings.paymentFailureRate * 100)}% of payment attempts fail in 30 minutes.
                </Text>
              </SettingToggle>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Alert Sensitivity */}
        <Layout.Section>
          <Card>
            <BlockStack gap="500">
              <Text as="h2" variant="headingMd">
                Alert Sensitivity
              </Text>

              <RangeSlider
                label={`Abandonment threshold: ${Math.round(settings.abandonmentThreshold * 100)}%`}
                min={10}
                max={50}
                step={5}
                value={Math.round(settings.abandonmentThreshold * 100)}
                onChange={(v) => set("abandonmentThreshold", (v as number) / 100)}
                helpText="Alert me when checkout CVR drops more than this % below my baseline."
                output
              />

              <RangeSlider
                label={`Discount failure count: ${settings.discountFailureMin}`}
                min={1}
                max={10}
                step={1}
                value={settings.discountFailureMin}
                onChange={(v) => set("discountFailureMin", v as number)}
                helpText="Alert me after a discount code fails this many times in one hour."
                output
              />

              <RangeSlider
                label={`Payment failure rate: ${Math.round(settings.paymentFailureRate * 100)}%`}
                min={5}
                max={30}
                step={5}
                value={Math.round(settings.paymentFailureRate * 100)}
                onChange={(v) => set("paymentFailureRate", (v as number) / 100)}
                helpText="Alert me when this % of payment attempts don't complete."
                output
              />

              <Button variant="primary" onClick={handleSave} loading={saving}>
                Save alert settings
              </Button>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Pixel Health */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Pixel Health
              </Text>
              <Text as="p">
                Status:{" "}
                <Text as="span" tone="success" fontWeight="semibold">
                  Connected
                </Text>
              </Text>
              <Text as="p" tone="subdued">
                The CheckoutMaxx pixel is active on your store and sending events. Go through a
                test checkout to confirm events are flowing.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Impact */}
        <Layout.Section>
          <Box background="bg-surface-secondary" padding="600" borderRadius="300">
            <BlockStack gap="400">
              <Text as="h2" variant="headingLg">
                CheckoutMaxx is monitoring your store
              </Text>
              <InlineGrid columns={4} gap="400">
                {[
                  {
                    label: "CHECKOUTS MONITORED",
                    value: kpiData ? kpiData.checkoutsStarted.toLocaleString() : "—",
                  },
                  {
                    label: "ISSUES CAUGHT",
                    value: String(issuesCaught),
                  },
                  {
                    label: "ALERTS RESOLVED",
                    value: String(alertsResolved),
                  },
                  {
                    label: "STATUS",
                    value: statusData ? statusData.state.replace("_", " ") : "—",
                  },
                ].map(({ label, value }) => (
                  <BlockStack key={label} gap="100">
                    <Text as="p" variant="bodySm" tone="subdued">
                      {label}
                    </Text>
                    <Text as="p" variant="heading2xl">
                      {value}
                    </Text>
                  </BlockStack>
                ))}
              </InlineGrid>
              <Divider />
              <Text as="p" tone="subdued" variant="bodySm">
                Monitoring checkout events in real time. Alerts fire when patterns deviate from your
                baseline.
              </Text>
            </BlockStack>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
