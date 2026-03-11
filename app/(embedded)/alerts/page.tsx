"use client";

import {
  Page,
  Layout,
  Card,
  Tabs,
  EmptyState,
  IndexTable,
  Text,
  Badge,
  BlockStack,
  Button,
  InlineStack,
  Banner,
  InlineGrid,
  ButtonGroup,
} from "@shopify/polaris";
import { useState } from "react";
import useSWR from "swr";
import { useShop } from "@/hooks/useShop";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type ActiveAlert = {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  body: string;
  actionUrl: string | null;
  actionLabel: string | null;
  sentEmail: boolean;
  sentSlack: boolean;
  firedAt: string;
};

type HistoryAlert = {
  id: string;
  alertType: string;
  title: string;
  sentEmail: boolean;
  sentSlack: boolean;
  firedAt: string;
  resolvedAt: string | null;
  roiEstimatedUsd: number | null;
};

const FILTER_TYPES = ["All", "Discount", "Abandonment", "Payment", "Extension"] as const;
type FilterType = (typeof FILTER_TYPES)[number];

function matchesFilter(alertType: string, filter: FilterType): boolean {
  if (filter === "All") return true;
  if (filter === "Discount") return alertType.toLowerCase().includes("discount");
  if (filter === "Abandonment") return alertType.toLowerCase().includes("abandonment");
  if (filter === "Payment") return alertType.toLowerCase().includes("payment");
  if (filter === "Extension") return alertType.toLowerCase().includes("extension");
  return true;
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function AlertsPage() {
  const shop = useShop();
  const [selected, setSelected] = useState(0);
  const [resolving, setResolving] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<FilterType>("All");

  const { data: activeAlerts = [], mutate: mutateActive } = useSWR<ActiveAlert[]>(
    shop ? `/api/alerts?shop=${shop}&tab=active` : null,
    fetcher,
    { refreshInterval: 60000 }
  );

  const { data: historyAlerts = [] } = useSWR<HistoryAlert[]>(
    shop && selected === 1 ? `/api/alerts?shop=${shop}&tab=history` : null,
    fetcher
  );

  async function resolve(id: string) {
    setResolving(id);
    await fetch(`/api/alerts/${id}`, { method: "PATCH" });
    await mutateActive();
    setResolving(null);
  }

  const totalAlerts = historyAlerts.length + activeAlerts.length;
  const resolvedCount = historyAlerts.filter((a) => a.resolvedAt).length;
  const unresolvedCount = activeAlerts.length;

  const filteredHistory = historyAlerts.filter((a) =>
    matchesFilter(a.alertType, historyFilter)
  );

  const tabs = [
    {
      id: "active",
      content: activeAlerts.length > 0 ? `Active (${activeAlerts.length})` : "Active",
    },
    { id: "history", content: "History" },
  ];

  return (
    <Page title="Alerts">
      <Layout>
        {/* KPI stat cards */}
        <Layout.Section>
          <InlineGrid columns={4} gap="400">
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="headingMd" tone="subdued">
                  Total Alerts
                </Text>
                <Text as="p" variant="heading2xl">
                  {totalAlerts}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="headingMd" tone="subdued">
                  Resolved
                </Text>
                <Text as="p" variant="heading2xl">
                  {resolvedCount}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="headingMd" tone="subdued">
                  Unresolved
                </Text>
                <Text as="p" variant="heading2xl">
                  {unresolvedCount}
                </Text>
              </BlockStack>
            </Card>
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="headingMd" tone="subdued">
                  Avg Response
                </Text>
                <Text as="p" variant="heading2xl">
                  {"< 30min"}
                </Text>
              </BlockStack>
            </Card>
          </InlineGrid>
        </Layout.Section>

        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={selected} onSelect={setSelected}>
              <div style={{ paddingTop: 16 }}>
                {selected === 0 && (
                  <>
                    {activeAlerts.length === 0 ? (
                      <EmptyState heading="No active alerts" image="">
                        <Text as="p" tone="subdued">
                          Your checkout is running smoothly. Alerts will appear here when
                          issues are detected.
                        </Text>
                      </EmptyState>
                    ) : (
                      <BlockStack gap="400">
                        {activeAlerts.map((alert) => (
                          <Banner key={alert.id} tone="critical" title={alert.title}>
                            <BlockStack gap="300">
                              <Text as="p">{alert.body}</Text>
                              <InlineStack gap="200">
                                {alert.actionUrl && alert.actionLabel && (
                                  <Button
                                    variant="primary"
                                    url={alert.actionUrl}
                                    target="_blank"
                                  >
                                    {alert.actionLabel}
                                  </Button>
                                )}
                                <Button
                                  loading={resolving === alert.id}
                                  onClick={() => resolve(alert.id)}
                                >
                                  Mark resolved
                                </Button>
                              </InlineStack>
                              <Text as="p" tone="subdued" variant="bodySm">
                                Fired {timeAgo(alert.firedAt)} · Sent via{" "}
                                {alert.sentEmail && alert.sentSlack
                                  ? "Email + Slack"
                                  : alert.sentEmail
                                  ? "Email"
                                  : alert.sentSlack
                                  ? "Slack"
                                  : "—"}
                              </Text>
                            </BlockStack>
                          </Banner>
                        ))}
                      </BlockStack>
                    )}
                  </>
                )}

                {selected === 1 && (
                  <>
                    <BlockStack gap="400">
                      {/* Filter pills */}
                      <ButtonGroup variant="segmented">
                        {FILTER_TYPES.map((f) => (
                          <Button
                            key={f}
                            pressed={historyFilter === f}
                            onClick={() => setHistoryFilter(f)}
                          >
                            {f}
                          </Button>
                        ))}
                      </ButtonGroup>

                      {filteredHistory.length === 0 ? (
                        <Text as="p" tone="subdued">
                          No alert history yet.
                        </Text>
                      ) : (
                        <IndexTable
                          resourceName={{ singular: "alert", plural: "alerts" }}
                          itemCount={filteredHistory.length}
                          headings={[
                            { title: "When" },
                            { title: "Type" },
                            { title: "Channels" },
                            { title: "Status" },
                            { title: "ROI Saved" },
                          ]}
                          selectable={false}
                        >
                          {filteredHistory.map((alert, i) => (
                            <IndexTable.Row key={alert.id} id={alert.id} position={i}>
                              <IndexTable.Cell>
                                <Text as="span" tone="subdued">
                                  {timeAgo(alert.firedAt)}
                                </Text>
                              </IndexTable.Cell>
                              <IndexTable.Cell>
                                <Text as="span" fontWeight="semibold">
                                  {alert.title}
                                </Text>
                              </IndexTable.Cell>
                              <IndexTable.Cell>
                                <InlineStack gap="100">
                                  {alert.sentEmail && (
                                    <Badge tone="info">Email</Badge>
                                  )}
                                  {alert.sentSlack && (
                                    <Badge tone="attention">Slack</Badge>
                                  )}
                                  {!alert.sentEmail && !alert.sentSlack && (
                                    <Text as="span" tone="subdued">—</Text>
                                  )}
                                </InlineStack>
                              </IndexTable.Cell>
                              <IndexTable.Cell>
                                {alert.resolvedAt ? (
                                  <Badge tone="success">Resolved</Badge>
                                ) : (
                                  <InlineStack gap="200" blockAlign="center">
                                    <Badge tone="attention">Open</Badge>
                                    <Button
                                      variant="plain"
                                      size="slim"
                                      loading={resolving === alert.id}
                                      onClick={() => resolve(alert.id)}
                                    >
                                      Resolve
                                    </Button>
                                  </InlineStack>
                                )}
                              </IndexTable.Cell>
                              <IndexTable.Cell>
                                <Text as="span">
                                  {alert.roiEstimatedUsd
                                    ? `$${alert.roiEstimatedUsd.toFixed(0)}`
                                    : "—"}
                                </Text>
                              </IndexTable.Cell>
                            </IndexTable.Row>
                          ))}
                        </IndexTable>
                      )}
                    </BlockStack>
                  </>
                )}
              </div>
            </Tabs>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
