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

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString();
}

function sentVia(email: boolean, slack: boolean) {
  if (email && slack) return "Email + Slack";
  if (email) return "Email";
  if (slack) return "Slack";
  return "—";
}

export default function AlertsPage() {
  const shop = useShop();
  const [selected, setSelected] = useState(0);
  const [resolving, setResolving] = useState<string | null>(null);

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
        <Layout.Section>
          <Card>
            <Tabs tabs={tabs} selected={selected} onSelect={setSelected}>
              <div style={{ paddingTop: 16 }}>
                {selected === 0 && (
                  <>
                    {activeAlerts.length === 0 ? (
                      <EmptyState heading="No active alerts" image="">
                        <Text as="p" tone="subdued">
                          Your checkout is running smoothly. Alerts will appear here when issues
                          are detected.
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
                                {sentVia(alert.sentEmail, alert.sentSlack)}
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
                    {historyAlerts.length === 0 ? (
                      <Text as="p" tone="subdued">
                        No alert history yet.
                      </Text>
                    ) : (
                      <IndexTable
                        resourceName={{ singular: "alert", plural: "alerts" }}
                        itemCount={historyAlerts.length}
                        headings={[
                          { title: "Alert" },
                          { title: "Fired" },
                          { title: "Resolved" },
                          { title: "Sent via" },
                          { title: "ROI Saved" },
                        ]}
                        selectable={false}
                      >
                        {historyAlerts.map((alert, i) => (
                          <IndexTable.Row key={alert.id} id={alert.id} position={i}>
                            <IndexTable.Cell>
                              <Text as="span" fontWeight="semibold">
                                {alert.title}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" tone="subdued">
                                {timeAgo(alert.firedAt)}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              {alert.resolvedAt ? (
                                <Badge tone="success">Resolved</Badge>
                              ) : (
                                <Badge tone="attention">Open</Badge>
                              )}
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span">
                                {sentVia(alert.sentEmail, alert.sentSlack)}
                              </Text>
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
